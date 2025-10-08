const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { authMiddleware } = require('../middleware/auth'); // middleware de autenticação
const { eventClientsByUser } = require('./events.js');

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;

// --- CRIAR MENSAGEM E ENVIAR PARA EVOLUTION ---
router.post('/', authMiddleware, async (req, res) => {
  const {
    chat_id,
    mensagem,
    mimetype,
    base64,
    connection_id,
    number,
    quote_id
  } = req.body;

  const user_id = req.userId; // pega do token autenticado

  if (!mensagem && !base64) {
    return res.status(400).send('Mensagem ou mídia (base64) é obrigatória.');
  }

  if (base64 && !mimetype) {
    return res.status(400).send('Para enviar mídia, o mimetype é obrigatório.');
  }

  try {

    // --- VERIFICAR SE USUÁRIO É ATENDENTE E SE ESTÁ ATIVO ---
    const { data: userData, error: attendantError } = await supabase
      .from('users')
      .select('status')
      .eq('id', user_id)
      .single();

    if (!userData.status) {
      return res.status(403).send('Atendente inativo não pode enviar mensagens.');
    }

    let instanceName;
    let chatNumber;
    let remetenteNome = '';

    if (chat_id) {
      // BUSCAR CHAT
      const { data: chatData, error: chatError } = await supabase
        .from('chats')
        .select('id, contato_nome, contato_numero, connection_id')
        .eq('id', chat_id)
        .single();

      if (chatError || !chatData) return res.status(404).send('Chat não encontrado');

      instanceName = chatData.connection_id;
      chatNumber = chatData.contato_numero;

      // BUSCAR USUÁRIO
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('nome, mostra_nome_mensagens')
        .eq('id', user_id)
        .single();

      if (userError || !userData) return res.status(404).send('Usuário não encontrado');

      remetenteNome = (userData.mostra_nome_mensagens && userData.nome)
        ? `*${userData.nome.trim()}*\n\n`
        : '';
    } else {
      instanceName = connection_id;
      // Adiciona '55' caso não exista
      chatNumber = number.startsWith('55') ? number : `55${number}`;
    }


    // --- LÓGICA DE ENVIO ---
    let endpoint;
    let payload;

    if (base64 && mimetype) {
      endpoint = `${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`;

      if (mimetype.startsWith('image/')) {
        payload = {
          number: chatNumber,
          mediatype: 'image',
          mimetype,
          caption: '',
          media: base64,
          fileName: mensagem || 'image.png',
          ...(quote_id && { quoted: { key: { id: quote_id } } })
        };
      } else if (mimetype.startsWith('audio/')) {
        endpoint = `${EVOLUTION_API_URL}/message/SendWhatsAppAudio/${instanceName}`;
        payload = {
          number: chatNumber,
          audio: base64,
          ...(quote_id && { quoted: { key: { id: quote_id } } })
        };
      } else {
        const extensao = mimetype.split('/')[1] || 'dat';
        payload = {
          number: chatNumber,
          mediatype: 'document',
          mimetype,
          caption: remetenteNome.trim(),
          media: base64,
          fileName: mensagem || `documento.${extensao}`,
          ...(quote_id && { quoted: { key: { id: quote_id } } })
        };
      }

      await axios.post(endpoint, payload, { headers: { apikey: process.env.EVOLUTION_API_KEY } });
      return res.status(201).json(mensagem || '[Mídia enviada]');
    }

    if (mensagem) {
      endpoint = `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;
      payload = {
        number: chatNumber,
        text: `${remetenteNome}${mensagem}`,
        ...(quote_id && { quoted: { key: { id: quote_id } } })
      };

      await axios.post(endpoint, payload, { headers: { apikey: process.env.EVOLUTION_API_KEY } });
      return res.status(201).json(mensagem);
    }

    return res.status(400).send('Corpo da requisição inválido. Mensagem ou mídia necessária.');

  } catch (err) {
    console.error('Erro no envio de mensagem:', err.response?.data || err.message);
    return res.status(500).send(`Erro ao enviar mensagem: ${err.message}`);
  }
});

// --- BUSCAR MENSAGENS COM PAGINAÇÃO ---
router.get('/chat/:chat_id', authMiddleware, async (req, res) => {
  const { chat_id } = req.params;
  const { limit = 20, cursor, oldestMessage } = req.query;

  try {
    let query = supabase
      .from('messages')
      .select(`
        *,
        quote_message: quote_id (
          id,
          mensagem,
          mimetype,
          remetente,
          criado_em
        )
      `)
      .eq('chat_id', chat_id)
      .order('criado_em', { ascending: false })
      .limit(Number(limit));

    // Se existir cursor (paginação), filtra
    if (cursor) {
      const ts = Buffer.from(cursor, 'base64').toString('utf8');
      query = query.lt('criado_em', ts);
    }
    // Se não existir cursor, mas existe oldestMessage (primeira chamada)
    else if (oldestMessage) {
      query = query.lt('criado_em', oldestMessage);
    }

    const { data, error } = await query;
    if (error) return res.status(500).send('Erro ao buscar mensagens.');

    // Cria o próximo cursor a partir da mensagem mais antiga retornada
    const nextCursor = data.length > 0
      ? Buffer.from(data[data.length - 1].criado_em).toString('base64')
      : null;

    return res.json({ messages: data, nextCursor });
  } catch (err) {
    console.error('Erro ao buscar mensagens:', err);
    return res.status(500).send('Erro inesperado ao buscar mensagens.');
  }
});

// --- APAGAR MENSAGEM ---
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: msgData, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        excluded,
        chat_id,
        chats (
          connection_id,
          contato_numero
        )
      `)
      .eq('id', id)
      .single();

    if (msgError || !msgData) return res.status(404).json({ error: 'Mensagem não encontrada' });
    if (msgData.excluded) return res.status(400).json({ error: 'Mensagem já excluída' });

    const instanceName = msgData.chats.connection_id;
    const remoteJid = `${msgData.chats.contato_numero}@s.whatsapp.net`;

    try {
      await axios.delete(
        `${EVOLUTION_API_URL}/chat/deleteMessageForEveryone/${instanceName}`,
        {
          data: { id: msgData.id, remoteJid, fromMe: true },
          headers: { apikey: process.env.EVOLUTION_API_KEY }
        }
      );
    } catch (evoErr) {
      console.error('Erro ao apagar no Evolution API:', evoErr.response?.data || evoErr.message);
      return res.status(500).json({ error: 'Falha ao apagar no WhatsApp' });
    }

    return res.json({ success: true, id });
  } catch (err) {
    console.error('Erro inesperado ao excluir mensagem:', err);
    return res.status(500).json({ error: 'Erro inesperado ao excluir mensagem' });
  }
});

module.exports = router;