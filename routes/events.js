const express = require('express');
const axios = require("axios");
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { tmpdir } = require('os');
const { join } = require('path');
const fs = require('fs/promises');
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
        // 1️⃣ Buscar o base64
        const response = await axios.post(
            `${process.env.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${connectionId}`,
            { message: data },
            { headers: { apikey: process.env.EVOLUTION_API_KEY } }
        );

        const base64 = response?.data?.base64;
        if (!base64) {
            console.error(`Falha ao obter base64 da mídia (${tipoMedia}).`);
            return null;
        }

        let fileBuffer = Buffer.from(base64, 'base64');

        // 2️⃣ Detectar tipo e extensão
        const mimeType =
            data.message.imageMessage?.mimetype ||
            data.message.audioMessage?.mimetype ||
            data.message.documentMessage?.mimetype ||
            mimeDefault;

        const fileExtension = mimeType.split('/')[1] || 'bin';
        const tempPath = join(tmpdir(), `${campoMensagem.id}.${fileExtension}`);

        // 3️⃣ Compressão condicional
        switch (tipoMedia) {
            case 'image':
                fileBuffer = await sharp(fileBuffer)
                    .jpeg({ quality: 80 }) // controla compressão (60–85 ideal)
                    .toBuffer();
                break;

            case 'video':
                await fs.writeFile(tempPath, fileBuffer);
                const outputPath = join(tmpdir(), `${campoMensagem.id}-compressed.mp4`);
                await new Promise((resolve, reject) => {
                    ffmpeg(tempPath)
                        .outputOptions(['-vcodec libx264', '-crf 28', '-preset veryfast'])
                        .save(outputPath)
                        .on('end', resolve)
                        .on('error', reject);
                });
                fileBuffer = await fs.readFile(outputPath);
                await fs.unlink(tempPath);
                await fs.unlink(outputPath);
                break;

            case 'audio':
                await fs.writeFile(tempPath, fileBuffer);
                const outAudio = join(tmpdir(), `${campoMensagem.id}-compressed.mp3`);
                await new Promise((resolve, reject) => {
                    ffmpeg(tempPath)
                        .audioBitrate('96k')
                        .save(outAudio)
                        .on('end', resolve)
                        .on('error', reject);
                });
                fileBuffer = await fs.readFile(outAudio);
                await fs.unlink(tempPath);
                await fs.unlink(outAudio);
                break;

            // documentos e stickers ficam como estão
        }

        // 4️⃣ Upload pro Supabase
        const fileName = `${MEDIA_FOLDER}/${campoMensagem.id}.${fileExtension}`;
        const { error: uploadError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(fileName, fileBuffer, {
                contentType: mimeType,
                upsert: true,
            });

        if (uploadError) {
            console.error(`Erro no upload (${tipoMedia}):`, uploadError.message);
            return null;
        }

        // 5️⃣ Obter URL pública
        const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);
        const publicUrl = urlData.publicUrl;

        // 6️⃣ Montar retorno
        let mensagem = '';
        let file_name = null;
        let mimetype = mimeType;

        switch (tipoMedia) {
            case 'image':
                mensagem = data.message.imageMessage?.caption || '';
                break;
            case 'video':
                mensagem = data.message.videoMessage?.caption || '';
                break;
            case 'audio':
                break;
            case 'document':
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
            ...(tipoMedia === 'document' && campoMensagem.nome_arquivo
                ? { nome_arquivo: campoMensagem.nome_arquivo }
                : {}),
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

    if (!fullConnection) {
        return res.status(400).json({ error: 'Conexão não encontrada ou desativada' });
    }

    // Busca os números dos atendentes desta conexão
    const { data: attendantsData, error: attendantsError } = await supabase
        .from('attendants')
        .select(`
        user_id,
        users!attendants_user_id_fkey(numero)
    `)
        .eq('connection_id', connection);

    // Extrai apenas os números dos atendentes (filtra nulos)
    const numerosAtendentes = attendantsData
        ?.map(att => att.users?.numero)
        .filter(numero => numero) || [];

    // Verifica o plano do usuário na tabela subscriptions
    const { data: subscription, error: subError } = await supabase
        .from('subscriptions')
        .select('plano')
        .eq('user_id', fullConnection.user_id)
        .single();

    if (subError || !subscription) {
        return res.status(400).json({ error: 'Plano do usuário não encontrado' });
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

    if (event === 'messages.upsert' || event === 'send.message') {

        const rjid = extractRemoteJid(event, data);

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

        // 2. Buscar todas as conexões do admin
        const { data: adminConnections, error: adminConnError } = await supabase
            .from('connections')
            .select('id, numero')
            .eq('user_id', fullConnection.user.id);

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
            const textoMensagem =
                data.message?.conversation ||
                data.message?.extendedTextMessage?.text ||
                data.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
                null;

            novaMensagem = {
                id: data.key.id,
                chat_id: chatId,
                remetente,
                mensagem: textoMensagem,
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

    // Detecta o tipo da mensagem
    let tipoMensagem = 'outros';
    let isDocumento = false;

    if (data.message) {
        if (data.message.imageMessage) {
            tipoMensagem = 'imagem';
        } else if (data.message.audioMessage) {
            tipoMensagem = 'audio';
        } else if (data.message.documentMessage?.mimetype === 'application/pdf') {
            isDocumento = true;
            tipoMensagem = 'PDF';
        } else if (data.message.documentMessage?.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            tipoMensagem = 'XLS';
            isDocumento = true;
        } else if (
            data.message.conversation ||
            data.message.extendedTextMessage?.text ||
            data.message.ephemeralMessage?.message?.extendedTextMessage?.text
        ) {
            tipoMensagem = 'texto';
        }
    }

    if (enrichedEvent.error) {
        return res.status(400).json(enrichedEvent);
    } else {
        return res.status(200).json({
            numerosAtendentes,
            chat: enrichedEvent.chat || null,
            event: event,
            data: data,
            subscription,
            isDocumento,
            tipo_mensagem: tipoMensagem,
            connection: fullConnection,
        });
    }

});

// Debounce para dispatchColeta
const FLOOD_DEBOUNCE_MS = 5000; // 5 segundos
const recentColetaActivity = new Map();

router.post('/dispatchColeta', async (req, res) => {
    const { connection, event, data } = req.body;

    try {
        const rjid = extractRemoteJid(event, data);

        let contatoNumero = rjid.replaceAll('@s.whatsapp.net', '');

        if (contatoNumero.endsWith('@lid')) {
            contatoNumero = data?.key?.senderPn.replaceAll('@s.whatsapp.net', '');
        }

        // Remove sufixo do tipo ":63" se existir (ex: 556492954044:63 -> 556492954044)
        if (/^\d+:\d+$/.test(contatoNumero)) {
            contatoNumero = contatoNumero.split(':')[0];
        }

        // Busca o usuário na tabela users pelo número
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('numero', contatoNumero)
            .maybeSingle();

        if (userError) {
            return res.status(500).json({
                error: 'Erro ao buscar usuário',
                details: userError.message
            });
        }

        if (!userData) {
            return res.status(404).json({
                error: 'Usuário não encontrado para o número',
                numero: contatoNumero
            });
        }

        // 🔥 Verifica flood/debounce por user_id
        const userId = userData.id;
        const now = Date.now();
        const lastActivity = recentColetaActivity.get(userId);
        let isFlood = false;

        if (lastActivity && (now - lastActivity) < FLOOD_DEBOUNCE_MS) {
            isFlood = true;
        }

        // Atualiza timestamp da última atividade
        recentColetaActivity.set(userId, now);

        // Limpa entradas antigas do Map (evita memory leak)
        setTimeout(() => {
            if (recentColetaActivity.get(userId) === now) {
                recentColetaActivity.delete(userId);
            }
        }, FLOOD_DEBOUNCE_MS);

        // Detecta o tipo da mensagem
        let tipoMensagem = 'outros';
        let isDocumento = false;

        if (data.message) {
            if (data.message.imageMessage) {
                tipoMensagem = 'imagem';
            } else if (data.message.audioMessage) {
                tipoMensagem = 'audio';
            } else if (data.message.documentMessage?.mimetype === 'application/pdf') {
                isDocumento = true;
                tipoMensagem = 'PDF';
            } else if (data.message.documentMessage?.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
                tipoMensagem = 'XLS';
                isDocumento = true;
            } else if (
                data.message.conversation ||
                data.message.extendedTextMessage?.text ||
                data.message.ephemeralMessage?.message?.extendedTextMessage?.text
            ) {
                tipoMensagem = 'texto';
            }
        }

        // Retorna o usuário, evento, data completos, tipo da mensagem e isFlood
        return res.status(200).json({
            user: userData,
            event,
            data,
            numero_extraido: contatoNumero,
            remote_jid: rjid,
            tipo_mensagem: tipoMensagem,
            isDocumento,
            isFlood // 🔥 Novo campo indicando se é flood
        });

    } catch (err) {
        console.error('Erro no /dispatchColeta:', err);
        return res.status(500).json({
            error: 'Erro interno no servidor',
            details: err.message
        });
    }
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