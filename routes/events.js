const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const jwt = require("jsonwebtoken");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

async function processarMensagemComMedia(data, connectionId, remetente, tipoMedia, campoMensagem, mimeDefault) {
    try {

        const response = await axios.post(
            `http://localhost:8081/chat/getBase64FromMediaMessage/${connectionId}`,
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
        let mimetype = mimeDefault;

        switch (tipoMedia) {
            case 'image':
                mensagem = data.message.imageMessage?.caption || '';
                mimetype = 'image/png';
                break;
            case 'video':
                mensagem = data.message.imageMessage?.caption || '';
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
                mensagem = data.message.documentMessage?.caption || data.message.documentMessage?.fileName || '';
                break;
        }

        return {
            id: campoMensagem.id,
            quote_id: campoMensagem.quote_id,
            chat_id: campoMensagem.chat_id,
            remetente,
            mensagem,
            mimetype,
            base64: publicUrl, // <-- IMPORTANTE: Salvamos a URL no campo 'base64'
            ...(tipoMedia === 'document' && campoMensagem.nome_arquivo ? { nome_arquivo: campoMensagem.nome_arquivo } : {})
        };

    } catch (err) {
        console.error(`Erro CRÍTICO ao processar mídia (${tipoMedia}):`, err);
        return null;
    }
}

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

    // Primeiro pega o tipo de usuário
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('auth_id, tipo_de_usuario')
        .eq('auth_id', user_id)
        .maybeSingle();

    if (userError || !user) {
        return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    let resolvedUserId = user.auth_id;

    if (user.tipo_de_usuario !== 'admin') {
        // Se for atendente, resolve o admin
        const { data: attendant, error: attError } = await supabase
            .from('attendants')
            .select('user_admin_id')
            .eq('user_id', user.auth_id)
            .maybeSingle();

        if (attError || !attendant) {
            return res.status(400).json({ error: 'Atendente não vinculado a admin' });
        }

        resolvedUserId = attendant.user_admin_id;
    }

    // Configura SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!eventClientsByUser[resolvedUserId]) {
        eventClientsByUser[resolvedUserId] = [];
    }
    eventClientsByUser[resolvedUserId].push(res);

    req.on('close', () => {
        eventClientsByUser[resolvedUserId] =
            eventClientsByUser[resolvedUserId].filter(c => c !== res);
    });
});

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

    if (!fullConnection) {
        return res.status(400).json({ error: 'Conexão não encontrada' });
    }

    const userId = fullConnection.user.id;

    const authUserid = fullConnection.user.auth_id;

    let enrichedEvent = {
        event,
        state: data.state,
        connection: fullConnection
    };

    if (
        data.message?.editedMessage ||
        data.message?.reactionMessage ||
        data.message?.templateMessage ||
        !data.message ||
        (Object.keys(data.message).length === 0)
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
            await axios.delete(`http://localhost:8081/instance/delete/${connection}`, { headers: { apikey: process.env.EVOLUTION_API_KEY } });
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

        const rjid = extractRemoteJid(event, data);
        if (rjid && !/@g\.us$/.test(rjid)) markMessageActivity(connection, rjid);

        const contatoNumero = rjid.replaceAll('@s.whatsapp.net', '');
        const connectionId = fullConnection.id;

        let chatId = null;
        let chatCompleto = null;

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

module.exports = {
    router,
    eventClientsByUser
};