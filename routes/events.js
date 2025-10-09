const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const jwt = require("jsonwebtoken");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const Redis = require('ioredis');

const redis = new Redis({
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379,
});

const eventClientsByUser = {};

const BUCKET_NAME = "bucket_arquivos_medias";
const MEDIA_FOLDER = "media";

const DEBOUNCE_MS = 500;
const recentMsgActivity = new Map();

const normalizeNumber = (remoteJid = "") => remoteJid.replace(/@s\.whatsapp\.net$/, "").trim();

const makeKey = (connectionId, remoteJid) => `${connectionId}|${normalizeNumber(remoteJid)}`;

function markMessageActivity(connectionId, remoteJid) {
    if (!connectionId || !remoteJid) return;
    recentMsgActivity.set(makeKey(connectionId, remoteJid), Date.now());
}

function shouldIgnoreChatsUpsert(connectionId, remoteJid) {
    if (!connectionId || !remoteJid) return false;
    const ts = recentMsgActivity.get(makeKey(connectionId, remoteJid));
    return ts && (Date.now() - ts) <= DEBOUNCE_MS;
}

function extractRemoteJid(event, data) {
    if (event === 'chats.upsert') return Array.isArray(data) ? data[0]?.remoteJid : null;
    if (event === 'messages.upsert') return data?.key?.remoteJid || data?.remoteJid || null;
    if (event === 'messages.delete') return data?.remoteJid;
    if (event === 'send.message') return data?.key?.remoteJid || data?.remoteJid || data?.to || data?.jid || null;
    return null;
}

async function buscarDadosContato(numero, instance) {
    try {
        const { data } = await axios.post(`${process.env.EVOLUTION_API_URL}/chat/fetchProfilePictureUrl/${instance}`, {
            number: numero,
        }, {
            headers: { apikey: process.env.EVOLUTION_API_KEY }
        });
        return { profilePictureUrl: data.profilePictureUrl, wuid: data.wuid };
    } catch (err) {
        console.error(`Erro ao buscar foto do número ${numero}:`, err.message);
        return null;
    }
}

async function processarMensagemComMedia(data, connectionId, remetente, tipoMedia, campoMensagem, mimeDefault) {
    try {

        const response = await axios.post(
            `${process.env.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${connectionId}`,
            { message: data },
            { headers: { apikey: process.env.EVOLUTION_API_KEY } }
        );

        const base64 = response?.data?.base64 || null;

        if (!base64) {
            console.error(`Falha ao obter base64 da mídia (${tipoMedia}). A API não retornou o conteúdo.`);
            return null;
        }

        // ETAPA 2: Converter base64 para Buffer
        const fileBuffer = Buffer.from(base64, 'base64');

        // ETAPA 3: Criar um nome de arquivo único
        const mimeType = (
            data.message.imageMessage?.mimetype ||
            data.message.audioMessage?.mimetype ||
            data.message.documentMessage?.mimetype ||
            mimeDefault
        );

        const fileExtension = mimeType.split('/')[1] || 'bin';

        const fileName = `${MEDIA_FOLDER}/${campoMensagem.id}.${fileExtension}`;

        // ETAPA 4: Fazer upload do buffer para o Supabase Storage
        const { error: uploadError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(fileName, fileBuffer, {
                contentType: mimeDefault,
                upsert: true,
            });

        if (uploadError) {
            console.error(`Erro no upload para o Supabase (${tipoMedia}):`, uploadError.message);
            return null; // Falha a operação se o upload não funcionar
        }

        // ETAPA 5: Obter a URL pública do arquivo
        const { data: urlData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(fileName);

        const publicUrl = urlData.publicUrl;

        // ETAPA 6: Montar o objeto final da mensagem com a URL
        let mensagem = null;
        let file_name = null;
        let mimetype = mimeDefault;

        switch (tipoMedia) {
            case 'image':
                mensagem = data.message.imageMessage?.caption || '';
                mimetype = 'image/png';
                break;
            case 'video':
                mensagem = data.message.videoMessage?.caption || '';
                mimetype = 'video/mp4';
                break;
            case 'audio':
                mimetype = data.message.audioMessage?.mimetype || mimeDefault;
                break;
            case 'sticker':
                mimetype = data.message.stickerMessage?.mimetype || mimeDefault;
                break;
            case 'document':
                mimetype = data.message.documentMessage?.mimetype || mimeDefault;
                mensagem = data.message.documentMessage?.caption;
                file_name = data.message.documentMessage?.fileName;
                break;
        }

        return {
            id: campoMensagem.id,
            quote_id: campoMensagem.quote_id,
            chat_id: campoMensagem.chat_id,
            remetente,
            mensagem,
            mimetype,
            file_name,
            base64: publicUrl,
            ...(tipoMedia === 'document' && campoMensagem.nome_arquivo ? { nome_arquivo: campoMensagem.nome_arquivo } : {})
        };

    } catch (err) {
        console.error(`Erro CRÍTICO ao processar mídia (${tipoMedia}):`, err);
        return null;
    }
}

router.post('/dispatch', async (req, res) => {

    const { connection, event, data } = req.body;

    const { data: fullConnection } = await supabase
        .from('connections')
        .select(`
                *,
                user:users(id, auth_id, nome, email),
                agente:agents(id, tipo_de_agente, prompt_do_agente)
            `)
        .eq('id', connection)
        .single();

    if (!fullConnection || fullConnection.status === false) {
        return res.status(400).json({ error: 'Conexão não encontrada ou desativada' });
    }

    const userId = fullConnection.user.id;

    const authUserid = fullConnection.user.auth_id;

    let enrichedEvent = {
        event,
        state: data.state,
        connection: fullConnection
    };

    if (
        data.message &&
        (
            data.message.editedMessage ||
            data.message.reactionMessage ||
            data.message.templateMessage ||
            Object.keys(data.message).length === 0
        )
    ) {
        return res.status(200).json({ event: 'ignored', message: 'Mensagem ignorada (editada, reação ou vazia)' });
    }

    if (event === 'connection.update' && data.state === 'open' && data.wuid) {

        const numero = data.wuid.split('@')[0];

        const { data: currentConnection, error: connError } = await supabase
            .from('connections')
            .select('id, user_id')
            .eq('id', connection)
            .maybeSingle();

        if (connError || !currentConnection) {
            enrichedEvent.event = 'error';
            enrichedEvent.message = 'Conexão não encontrada';
        }

        const { data: duplicate, error: dupError } = await supabase
            .from('connections')
            .select('id')
            .eq('user_id', currentConnection.user_id)
            .eq('numero', numero)
            .neq('id', connection)
            .maybeSingle();

        if (dupError) {
            enrichedEvent.error = true;
            enrichedEvent.message = 'Erro ao verificar duplicidade';
        }

        if (duplicate) {
            enrichedEvent.error = true;
            enrichedEvent.message = 'Conexao duplicada';

            await supabase.from('connections').delete().eq('id', connection);
            await axios.delete(`${process.env.EVOLUTION_API_URL}/instance/delete/${connection}`, { headers: { apikey: process.env.EVOLUTION_API_KEY } });
        }

        const { data: updatedConnection, error } = await supabase
            .from('connections')
            .update({
                numero,
                status: true
            })
            .eq('id', connection)
            .select('*')
            .maybeSingle();

        enrichedEvent.event = 'connection.update';
        enrichedEvent.connection = updatedConnection;

    }

    if (event === 'chats.upsert') {

        const rjid = extractRemoteJid(event, data);

        if (shouldIgnoreChatsUpsert(connection, rjid) || !rjid) {
            enrichedEvent.event = 'error';
            enrichedEvent.message = 'Ignorado chats.upsert (debounce)';
        } else {
            const contato_numero = normalizeNumber(rjid);

            const { data: chatExistente, error: chatError } = await supabase
                .from('chats')
                .select('*')
                .eq('contato_numero', contato_numero)
                .eq('connection_id', connection)
                .maybeSingle();

            if (chatExistente) {
                await supabase
                    .from('chats_reads')
                    .upsert(
                        {
                            chat_id: chatExistente.id,
                            connection_id: connection,
                            last_read_at: new Date().toISOString(),
                        },
                        { onConflict: ['chat_id', 'connection_id'] }
                    );

                enrichedEvent.chat = chatExistente;
            }

        }
    }

    if (event === 'messages.upsert' || event === 'send.message') {

        console.log('oi')

        const rjid = extractRemoteJid(event, data);
        if (rjid && !/@g\.us$/.test(rjid)) markMessageActivity(connection, rjid);

        let contatoNumero = rjid.replaceAll('@s.whatsapp.net', '');

        if (contatoNumero.endsWith('@lid')) {
            contatoNumero = data?.key?.senderPn.replaceAll('@s.whatsapp.net', '');
        }

        // Remove sufixo do tipo ":63" se existir (ex: 556492954044:63 -> 556492954044)
        if (/^\d+:\d+$/.test(contatoNumero)) {
            contatoNumero = contatoNumero.split(':')[0];
        }

        const connectionId = fullConnection.id;

        let chatId = null;
        let chatCompleto = null;

        // 1. Buscar o tipo de usuário
        const { data: userData, error: userTypeError } = await supabase
            .from('users')
            .select('tipo_de_usuario')
            .eq('id', fullConnection.user_id)
            .single();

        if (userTypeError || !userData) {
            return res.status(400).json({ error: 'Usuário não encontrado para verificação de duplicidade de chat.' });
        }

        let adminId = fullConnection.user.id;
        if (userData.tipo_de_usuario !== 'admin') {
            // Se for atendente, buscar o user_admin_id
            const { data: attendantData, error: attendantError } = await supabase
                .from('attendants')
                .select('user_admin_id')
                .eq('user_id', fullConnection.user_id)
                .single();

            if (attendantError || !attendantData) {
                return res.status(400).json({ error: 'Atendente não vinculado a admin para verificação de duplicidade de chat.' });
            }
            adminId = attendantData.user_admin_id;
        }

        // 2. Buscar todas as conexões do admin
        const { data: adminConnections, error: adminConnError } = await supabase
            .from('connections')
            .select('id, numero')
            .eq('user_id', adminId);

        if (adminConnError) {
            return res.status(400).json({ error: 'Erro ao buscar conexões do admin.' });
        }

        // 3. Verificar se existe outra conexão com o mesmo contatoNumero
        const duplicateConn = adminConnections.find(conn => conn.numero === contatoNumero);

        if (duplicateConn) {
            return res.status(200).json({ event: 'ignored', message: 'Chat com número de uma conexão existente.' });
        }

        const { data: chatExistenteArray, error: chatBuscaError } = await supabase
            .from('chats')
            .select('*')
            .eq('contato_numero', contatoNumero)
            .eq('connection_id', connectionId)
            .limit(1);

        const chatExistente = chatExistenteArray[0]

        if (chatExistente) {
            // --- NOVA REGRA: Desativa IA se for message.upsert enviado pelo usuário ---
            if (
                event === 'messages.upsert' &&
                data.key.fromMe &&
                chatExistente.ia_ativa
            ) {
                await supabase
                    .from('chats')
                    .update({ ia_ativa: false })
                    .eq('id', chatExistente.id);
                chatExistente.ia_ativa = false;
            }

            // --- NOVA REGRA: Ativa IA se usuário enviar a palavra-chave ---
            if (
                event === 'messages.upsert' &&
                data.key.fromMe &&
                !chatExistente.ia_ativa
            ) {
                // Busca a trigger word do admin
                const { data: userData } = await supabase
                    .from('users')
                    .select('ai_trigger_word')
                    .eq('id', fullConnection.user.id)
                    .single();

                const triggerWord = userData?.ai_trigger_word?.trim()?.toLowerCase();
                const mensagem = data.message?.conversation?.trim()?.toLowerCase();

                if (triggerWord && mensagem === triggerWord) {
                    await supabase
                        .from('chats')
                        .update({ ia_ativa: true })
                        .eq('id', chatExistente.id);
                    chatExistente.ia_ativa = true;
                }
            }

            if (chatExistente.contato_nome === chatExistente.contato_numero && !data.key.fromMe) {
                await supabase
                    .from('chats')
                    .update({ contato_nome: data.pushName })
                    .eq('id', chatExistente.id);
            }
            if (chatExistente.status === 'Close') {
                await supabase
                    .from('chats')
                    .update({ status: 'Open', ia_ativa: true, user_id: null })
                    .eq('id', chatExistente.id);

                chatExistente.status = 'Open';
                chatExistente.ia_ativa = true;
            }
            chatId = chatExistente.id;
            chatCompleto = chatExistente;
        } else {
            const { profilePictureUrl } = await buscarDadosContato(contatoNumero, connection);
            const isContatoIniciou = !data.key.fromMe;
            const nomeInicial = isContatoIniciou ? data.pushName : contatoNumero;

            const { data: novoChat, error: novoChatError } = await supabase
                .from('chats')
                .upsert({
                    contato_nome: nomeInicial,
                    contato_numero: contatoNumero,
                    connection_id: connectionId,
                    ia_ativa: true,
                    status: 'Open',
                    foto_perfil: profilePictureUrl
                }, { onConflict: ['connection_id', 'contato_numero'] })
                .select()
                .single();

            chatId = novoChat.id;
            chatCompleto = novoChat;
        }

        let remetente = (event === 'messages.upsert')
            ? (data.key.fromMe ? 'Usuário' : 'Contato')
            : 'Usuário';

        let quoteMessage = null;
        let quoteId = null;

        if (data.contextInfo?.stanzaId) {
            const quotedStanzaId = data.contextInfo.stanzaId;
            const { data: msgCitada } = await supabase
                .from('messages')
                .select('id, mensagem, mimetype, remetente, base64')
                .eq('id', quotedStanzaId)
                .maybeSingle();

            if (msgCitada) {
                quoteId = msgCitada.id;
                quoteMessage = msgCitada;
            }
        }

        let novaMensagem = null;

        // Mídias suportadas
        if (data.message?.imageMessage) {
            novaMensagem = await processarMensagemComMedia(data, connectionId, remetente, 'image', {
                id: data.key.id,
                quote_id: quoteId,
                chat_id: chatId
            }, 'image/png');
        } else if (data.message?.audioMessage) {
            novaMensagem = await processarMensagemComMedia(data, connectionId, remetente, 'audio', {
                id: data.key.id,
                quote_id: quoteId,
                chat_id: chatId
            }, 'audio/ogg');
        } else if (data.message?.videoMessage) {
            novaMensagem = await processarMensagemComMedia(data, connectionId, remetente, 'video', {
                id: data.key.id,
                quote_id: quoteId,
                chat_id: chatId
            }, 'video/mp4');
        } else if (data.message?.stickerMessage) {
            novaMensagem = await processarMensagemComMedia(data, connectionId, remetente, 'sticker', {
                id: data.key.id,
                quote_id: quoteId,
                chat_id: chatId
            }, 'image/webp');
        } else if (data.message?.documentMessage) {
            novaMensagem = await processarMensagemComMedia(data, connectionId, remetente, 'document', {
                id: data.key.id,
                quote_id: quoteId,
                chat_id: chatId
            }, 'application/octet-stream');
        }

        // Tipos não suportados
        const unsupportedTypes = {
            eventMessage: { mensagem: '[Evento recebido]', mimetype: 'event/unsupported' },
            ptvMessage: { mensagem: '[Recado de Video recebido]', mimetype: 'ptv/unsupported' },
            pollCreationMessageV3: { mensagem: '[Enquete recebida]', mimetype: 'poll/unsupported' },
            interactiveMessage: { mensagem: '[Chave Pix Recebida]', mimetype: 'pix/unsupported' },
            locationMessage: { mensagem: '[Localização recebida]', mimetype: 'location/unsupported' },
            contactMessage: { mensagem: '[Contato recebido]', mimetype: 'contact/unsupported' },
            adReplyMessage: { mensagem: '[Anúncio ignorado]', mimetype: 'ads/unsupported' }
        };

        if (!novaMensagem) {
            // Se não for mídia, verifica tipos não suportados
            for (const [key, value] of Object.entries(unsupportedTypes)) {
                if (data.message?.[key]) {
                    novaMensagem = {
                        id: data.key.id,
                        chat_id: chatId,
                        remetente,
                        ...value,
                    };
                    break;
                }
            }
        }

        if (!novaMensagem) {
            // Se não for mídia nem tipo não suportado, salva como texto/conversation
            novaMensagem = {
                id: data.key.id,
                chat_id: chatId,
                remetente,
                mensagem: data.message?.conversation || null,
                quote_id: quoteId,
            };
        }

        const { data: msgCriada, error: msgError } = await supabase
            .from('messages')
            .insert(novaMensagem)
            .select()
            .single();

        enrichedEvent.message = {
            ...msgCriada,
            quote_message: quoteMessage || null,
        };

        enrichedEvent.chat = chatCompleto || chatExistente;

        // 🔹 Atualiza cache Redis (incremental)
        try {
            const redisKeys = await redis.keys(`chats:${userId}:0`);

            for (const key of redisKeys) {
                const cached = await redis.get(key);
                if (!cached) continue;

                const parsed = JSON.parse(cached);
                let updated = false;

                for (const chat of parsed.chats || []) {
                    if (chat.id === chatId) {
                        chat.ultimas_mensagens = [
                            { ...msgCriada },
                            ...(chat.ultimas_mensagens || []).slice(0, 7)
                        ];

                        chat.ultima_mensagem = msgCriada.mensagem || chat.ultima_mensagem;
                        chat.ultima_mensagem_type = msgCriada.mimetype || chat.ultima_mensagem_type;
                        chat.mensagem_data = msgCriada.criado_em || new Date().toISOString();
                        chat.ultima_atualizacao = new Date().toISOString();

                        // Atualiza contagem de não lidas se for mensagem do contato
                        if (msgCriada.remetente === "Contato") {
                            chat.unread_count = (chat.unread_count || 0) + 1;
                        }

                        updated = true;
                    }
                }

                if (updated) {
                    await redis.set(key, JSON.stringify(parsed)); // usa set normal (mantém TTL)
                    console.log(`✅ Cache Redis atualizado para a chave ${key}`);
                }
            }
        } catch (err) {
            console.error("❌ Erro ao atualizar cache Redis:", err);
        }
    }

    if (event === 'messages.delete') {
        let whatsappId;
        if (data?.remoteJid && data?.id) whatsappId = data.id;
        if (data?.key?.id) whatsappId = data.key.id;

        if (!whatsappId) {
            enrichedEvent.event = 'error';
            enrichedEvent.message = 'invalid_payload, dados insuficientes';
        }

        const { data: msg } = await supabase
            .from("messages")
            .select("id, chat_id")
            .eq("id", whatsappId)
            .single();

        await supabase
            .from("messages")
            .update({ excluded: true })
            .eq("id", msg.id);

        enrichedEvent.deletedMessage = { id: msg.id, chat_id: msg.chat_id };

    }

    if (eventClientsByUser[authUserid]) {
        for (const client of eventClientsByUser[authUserid]) {
            client.write(`data: ${JSON.stringify(enrichedEvent)}\n\n`);
        }
    }

    // 🔴 Envia também para atendentes dessa conexão
    const connectionKey = `connection:${fullConnection.id}`;
    if (eventClientsByUser[connectionKey]) {
        for (const client of eventClientsByUser[connectionKey]) {
            client.write(`data: ${JSON.stringify(enrichedEvent)}\n\n`);
        }
    }


    if (event === 'connection.update' && data.state === 'close') {

        const { data: attendantsData } = await supabase
            .from('attendants')
            .select('user_id')
            .eq('connection_id', connection);

        const authIds = attendantsData?.map(a => a.user_id) || [];

        await supabase
            .from('connections')
            .delete()
            .eq('id', connection);


        for (const authId of authIds) {
            try {
                await supabase.auth.admin.deleteUser(authId);
            } catch (err) {
                console.error(`Erro ao deletar auth.user ${authId}:`, err.message || err);
            }
        }
    }

    return res.status(enrichedEvent.error ? 400 : 200).json(enrichedEvent);

});


router.get('/:user_id', async (req, res) => {
    const { user_id } = req.params;
    const { token } = req.query;

    if (!token) return res.status(401).json({ error: "Token ausente" });

    try {
        const decoded = jwt.decode(token);
        if (!decoded || decoded.sub !== user_id) {
            return res.status(403).json({ error: "Token não corresponde ao usuário" });
        }
    } catch (err) {
        return res.status(401).json({ error: "Token inválido" });
    }

    // Verifica tipo do usuário
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('auth_id, tipo_de_usuario')
        .eq('auth_id', user_id)
        .maybeSingle();

    if (userError || !user) {
        return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    let clientKey = null;

    if (user.tipo_de_usuario === 'admin') {
        // Admin recebe todos os eventos das suas conexões
        clientKey = user.auth_id;
    } else {
        // Atendente só recebe eventos da connection dele
        const { data: attendant, error: attError } = await supabase
            .from('attendants')
            .select('connection_id')
            .eq('user_id', user.auth_id)
            .maybeSingle();

        if (attError || !attendant || !attendant.connection_id) {
            return res.status(400).json({ error: 'Atendente não vinculado a conexão' });
        }

        clientKey = `connection:${attendant.connection_id}`;
    }

    // Configura SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!eventClientsByUser[clientKey]) {
        eventClientsByUser[clientKey] = [];
    }
    eventClientsByUser[clientKey].push(res);

    // Heartbeat
    const heartbeat = setInterval(() => {
        res.write(`event: ping\ndata: {}\n\n`);
    }, 15000);

    req.on('close', () => {
        clearInterval(heartbeat);
        eventClientsByUser[clientKey] =
            eventClientsByUser[clientKey].filter(c => c !== res);
    });
});


module.exports = {
    router,
    eventClientsByUser
};



