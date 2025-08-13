const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const eventClientsByUser = {};

async function buscarDadosContato(numero, instance) {
    try {
        const { data } = await axios.post(`http://localhost:8081/chat/fetchProfilePictureUrl/${instance}`, {
            number: numero,
        }, {
            headers: { apikey: process.env.EVOLUTION_API_KEY }
        });
        return { profilePictureUrl: data.profilePictureUrl };
    } catch (err) {
        console.error(`Erro ao buscar foto do número ${numero}:`, err.message);
        return null;
    }
}

async function extrairMensagemComMedia(data, connectionId, remetente, tipoMedia, campoMensagem, mimeDefault) {
    try {
        const response = await axios.post(
            `http://localhost:8081/chat/getBase64FromMediaMessage/${connectionId}`,
            { message: data },
            { headers: { apikey: process.env.EVOLUTION_API_KEY } }
        );

        const base64 = response?.data?.base64 || null;
        let mensagem = null;
        let mimetype = mimeDefault;

        switch (tipoMedia) {
            case 'image':
                mensagem = data.message.imageMessage?.caption || '';
                mimetype = 'image/png';
                break;
            case 'audio':
                mimetype = data.message.audioMessage?.mimetype || mimeDefault;
                mensagem = null;
                break;
            case 'sticker':
                mimetype = data.message.stickerMessage?.mimetype || mimeDefault;
                mensagem = null;
                break;
            case 'document':
                mimetype = data.message.documentMessage?.mimetype || mimeDefault;
                mensagem = data.message.documentMessage?.caption || data.message.documentMessage?.fileName || '';
                break;
        }

        return {
            chat_id: campoMensagem.chat_id,
            remetente,
            mensagem,
            mimetype,
            base64,
            ...(tipoMedia === 'document' && campoMensagem.nome_arquivo ? { nome_arquivo: campoMensagem.nome_arquivo } : {})
        };

    } catch (err) {
        console.error(`Erro ao buscar base64 da mídia (${tipoMedia}):`, err.message);
        return null;
    }
}

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

router.post('/dispatch', async (req, res) => {
    const { connection, event, data } = req.body;

    // Ignora mensagens que não queremos processar
    if (data.message?.editedMessage || data.message?.reactionMessage || data.message?.videoMessage ||
        data.message?.locationMessage || data.message?.contactMessage || data.message?.pollCreationMessageV3 ||
        data.message?.interactiveMessage || data.message?.eventMessage) {
        console.log('👍 Ignorado evento de mensagem não suportado');
        return res.status(200).send('Ignorada');
    }

    try {
        if (event === 'connection.update' && data.state === 'open' && data.wuid) {
            await supabase
                .from('connections')
                .update({
                    numero: data.wuid.split('@')[0],
                    status: true
                })
                .eq('id', connection);
        }

        const { data: fullConnection, error } = await supabase
            .from('connections')
            .select(`
                *,
                user:users(id, nome, email),
                agente:agents(id, tipo_de_agente, prompt_do_agente)
            `)
            .eq('id', connection)
            .single();

        if (error || !fullConnection) {
            return res.status(200).send('Conexão não encontrada');
        }

        const userId = fullConnection.user?.id;
        if (!userId) return res.status(400).send('Usuário da conexão não encontrado');

        const enrichedEvent = {
            event,
            connection: fullConnection,
            state: data.state,
        };

        if (event === 'messages.upsert' || event === 'send.message') {
            const contatoNumero = data.key.remoteJid.replaceAll('@s.whatsapp.net', '');
            const connectionId = fullConnection.id;
            let chatId = null;
            let chatCompleto = null;

            // Busca chat existente
            const { data: chatExistente, error: chatError } = await supabase
                .from('chats')
                .select('*')
                .eq('contato_numero', contatoNumero)
                .eq('connection_id', connectionId)
                .maybeSingle();

            if (chatError) {
                console.error('Erro ao buscar chat existente:', chatError.message);
            }

            if (chatExistente) {
                if (chatExistente.contato_nome === chatExistente.contato_numero && !data.key.fromMe) {
                    await supabase
                        .from('chats')
                        .update({ contato_nome: data.pushName })
                        .eq('id', chatExistente.id);
                }
                chatId = chatExistente.id;
                chatCompleto = chatExistente;
            } else {
                const { profilePictureUrl } = await buscarDadosContato(contatoNumero, connection);
                const isContatoIniciou = !data.key.fromMe;
                const nomeInicial = isContatoIniciou ? data.pushName : contatoNumero;

                const { data: novoChat, error: insertChatError } = await supabase
                    .from('chats')
                    .insert({
                        contato_nome: nomeInicial,
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
                chatCompleto = novoChat;
            }

            let remetente = (event === 'messages.upsert')
                ? (data.key.fromMe ? 'cliente' : 'humano')
                : 'cliente';

            let novaMensagem = {
                chat_id: chatId,
                remetente,
                mensagem: data.message?.conversation || null,
            };

            // Tenta extrair mídia, se existir
            if (data.message?.imageMessage) {
                const mediaMsg = await extrairMensagemComMedia(data, connectionId, remetente, 'image', novaMensagem, 'image/png');
                if (mediaMsg) novaMensagem = mediaMsg;
            } else if (data.message?.audioMessage) {
                const mediaMsg = await extrairMensagemComMedia(data, connectionId, remetente, 'audio', novaMensagem, 'audio/ogg');
                if (mediaMsg) novaMensagem = mediaMsg;
            } else if (data.message?.stickerMessage) {
                const mediaMsg = await extrairMensagemComMedia(data, connectionId, remetente, 'sticker', novaMensagem, 'image/webp');
                if (mediaMsg) novaMensagem = mediaMsg;
            } else if (data.message?.documentMessage) {
                const mediaMsg = await extrairMensagemComMedia(data, connectionId, remetente, 'document', novaMensagem, 'application/octet-stream');
                if (mediaMsg) novaMensagem = mediaMsg;
            }

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
            enrichedEvent.chat = chatCompleto || chatExistente;
        }

        if (eventClientsByUser[userId]) {
            for (const client of eventClientsByUser[userId]) {
                client.write(`data: ${JSON.stringify(enrichedEvent)}\n\n`);
            }
            console.log(`📡 Evento enviado: ${event} → user_id=${userId}`);
        }

        if (event === 'connection.update' && data.state === 'close') {
            await supabase.from('connections').delete().eq('id', connection);
        }

        return res.status(200).send('ok, enviado');
    } catch (err) {
        console.error('Erro no /dispatch:', err.message);
        return res.status(500).send('Erro interno');
    }
});

module.exports = {
    router,
    eventClientsByUser
};