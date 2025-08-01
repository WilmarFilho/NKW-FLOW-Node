const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const eventClientsByUser = {};

async function buscarDadosContato(numero, instance) {
    try {
        const fotoURL = await axios.post(`http://localhost:8081/chat/fetchProfilePictureUrl/${instance}`, {
            number: numero,
        }, {
            headers: {
                apikey: process.env.EVOLUTION_API_KEY
            }
        });

        const { profilePictureUrl } = fotoURL.data;

        return { profilePictureUrl };
    } catch (err) {
        console.error(`Erro ao buscar foto do número ${numero}:`, err.message);
        return null;
    }
}


// 📡 Conexão SSE global para cada usuário
router.get('/:user_id', (req, res) => {
    const { user_id } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!eventClientsByUser[user_id]) eventClientsByUser[user_id] = [];
    eventClientsByUser[user_id].push(res);

    console.log(`👤 Conectado para eventos: user_id=${user_id}`);

    req.on('close', () => {
        eventClientsByUser[user_id] = eventClientsByUser[user_id].filter(c => c !== res);
    });
});

// 📬 Webhook que o N8N chama
router.post('/dispatch', async (req, res) => {
    const { connection, event, data } = req.body;

    // Se connection.update = connectiong significa que o front solicitou a criação da instancia e a mesma está aguardando ser efetivada
    // Se connection.update = open significa que o front escaneou o qr code e a conexão foi efetivada

    // message.upsert:
    // Usuário recebeu mensagem 
    // Usuário mandou mensagem pelo WhatsApp Web ou Celular Conectado

    // send.message
    // Usuário mandou mensagem pela plataformaF

    console.log(req.body)

    try {
        // Se for conexão aberta, atualiza no banco
        if (event === 'connection.update' && data.state === 'open' && data.wuid) {
            await supabase
                .from('connections')
                .update({
                    numero: data.wuid.split('@')[0],
                    status: true
                })
                .eq('nome', connection); // Busca pelo nome da connection já que o evento de connectio.update não tem o id da connection
        }

        // Busca dados da conexão (com user_id)
        const { data: fullConnection, error } = await supabase
            .from('connections')
            .select(`
        *,
        user:users(id, nome, email),
        agente:agents(id, tipo_de_agente, prompt_do_agente)
      `)
            .eq('nome', connection) // Busca pelo nome da connection já que o evento de connectio.update não tem o id da connection
            .single();

        if (error || !fullConnection) {
            return res.status(200).send('Conexão não encontrada');
        }

        const userId = fullConnection.user.id;
        if (!userId) return res.status(400).send('Usuário da conexão não encontrado');

        // Monta evento para o front
        const enrichedEvent = {
            event,
            connection: fullConnection,
            state: data.state,
        };

        if (event === 'messages.upsert') {
            const contatoNumero = data.key.remoteJid.replaceAll('@s.whatsapp.net', '');
            const connectionId = fullConnection.id;
            let chatId = null;

            // 1. Verifica se já existe chat
            const { data: chatExistente, error: chatError } = await supabase
                .from('chats')
                .select('id, contato_nome, contato_numero')
                .eq('contato_numero', contatoNumero)
                .eq('connection_id', connectionId)
                .maybeSingle();

            if (chatError) {
                console.error('Erro ao buscar chat existente:', chatError.message);
            }

            // 2. Se existir, pega o id
            if (chatExistente) {

                if (chatExistente.contato_nome === chatExistente.contato_numero && !data.key.fromMe) {
                    await supabase
                        .from('chats')
                        .update({ contato_nome: data.pushName })
                        .eq('id', chatExistente.id);
                }

                chatId = chatExistente.id;
            }
            else {
                // 3. Senão, cria novo chat

                const { profilePictureUrl } = await buscarDadosContato(contatoNumero, connection);

                // Verifica se a primeira mensagem foi enviada pelo contato ou pelo cliente
                const isContatoIniciou = !data.key.fromMe;
                const nomeInicial = isContatoIniciou
                    ? (data.pushName)
                    : contatoNumero;

                const { data: novoChat, error: insertChatError } = await supabase
                    .from('chats')
                    .insert({
                        contato_nome: nomeInicial, //Se for a primeira mensagem do chat e for minha cria o chat com o contatoNumero no nome, Se a primeira mensagem for do contato coloca o pushName
                        contato_numero: contatoNumero,
                        connection_id: connectionId,
                        ia_ativa: true,
                        foto_perfil: profilePictureUrl
                    })
                    .select()
                    .single();

                if (insertChatError) {
                    console.error('Erro ao criar novo chat:', insertChatError.message);
                    return res.status(500).send('Erro ao criar chat');
                }

                chatId = novoChat.id;
            }

            const remetente = data.key.fromMe ? 'cliente' : 'humano'; // Verifica quem se foi o usuário que disparou a mensagem no whatsApp Web

            // 4. Cria a mensagem
            const novaMensagem = {
                chat_id: chatId,
                remetente: remetente,
                mensagem: data.message.conversation
            };

            const { data: msgCriada, error: msgError } = await supabase
                .from('messages')
                .insert(novaMensagem)
                .select()
                .single();

            if (msgError) {
                console.error('Erro ao criar mensagem:', msgError.message);
                return res.status(500).send('Erro ao salvar mensagem');
            }

            enrichedEvent.message = msgCriada;

        }

        if (event === 'send.message') {
            const contatoNumero = data.key.remoteJid.replaceAll('@s.whatsapp.net', '');
            const connectionId = fullConnection.id;

            // Busca o chat que foi enviado a mensagem
            const { data: chatExistente, error: chatError } = await supabase
                .from('chats')
                .select('id')
                .eq('contato_numero', contatoNumero)
                .eq('connection_id', connectionId)
                .maybeSingle();

            if (chatError) {
                console.error('Erro ao buscar chat existente:', chatError.message);
            }

            const chatId = chatExistente.id;

            // 4. Cria a mensagem
            const novaMensagem = {
                chat_id: chatId,
                remetente: 'cliente',
                mensagem: data.message.conversation
            };

            const { data: msgCriada, error: msgError } = await supabase
                .from('messages')
                .insert(novaMensagem)
                .select()
                .single();

            if (msgError) {
                console.error('Erro ao criar mensagem:', msgError.message);
                return res.status(500).send('Erro ao salvar mensagem');
            }

            enrichedEvent.message = msgCriada;

        }

        // Envia evento via SSE
        if (eventClientsByUser[userId]) {
            for (const client of eventClientsByUser[userId]) {
                client.write(`data: ${JSON.stringify(enrichedEvent)}\n\n`);
            }

            console.log(`📡 Evento enviado: ${event} → user_id=${userId}`);
        }

        // Se for desconexão, apaga a conexão
        if (event === 'connection.update' && data.state === 'close') {
            await supabase.from('connections').delete().eq('nome', connection);
        }

        res.status(200).send('ok, enviado');

    } catch (err) {
        console.error('Erro no /dispatch:', err.message);
        res.status(500).send('Erro interno');
    }
});

module.exports = {
    router,
    eventClientsByUser
};
