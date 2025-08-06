
const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { eventClientsByUser } = require('./events.js');

// Rota para criar mensagem e enviar para a Evolution API
router.post('/', async (req, res) => {
  // O campo 'mensagem' agora pode ser o texto, a legenda de uma imagem, ou o nome de um arquivo
  const { user_id, chat_id, mensagem, mimetype, base64 } = req.body;

  try {
    // 1. BUSCAR DADOS ESSENCIAIS (Chat, Conexão, Usuário)
    const { data: chatData, error: chatError } = await supabase
      .from('chats')
      .select('id, contato_nome, contato_numero, connection_id')
      .eq('id', chat_id)
      .single();

    if (chatError) throw new Error(`Erro ao buscar chat: ${chatError.message}`);

    const instanceName = chatData.connection_id;
    const chatNumber = chatData.contato_numero;

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('nome, mostra_nome_mensagens')
      .eq('id', user_id)
      .single();

    if (userError) throw new Error(`Erro ao buscar usuário: ${userError.message}`);

    let remetenteNome = '';
    if (userData.mostra_nome_mensagens && userData.nome) {
      remetenteNome = `*${userData.nome.trim()}*\n\n`;
    }

    // --- LÓGICA DE ENVIO ---

    if (base64 && mimetype) {
      let endpoint = `http://localhost:8081/message/sendMedia/${instanceName}`;
      let payload;

      if (mimetype.startsWith('image/')) {
        payload = {
          number: chatNumber,
          mediatype: 'image',
          mimetype: mimetype,
          caption: '',
          media: base64,
          fileName: mensagem || 'image.png'
        };
      } else if (mimetype.startsWith('audio/')) {
        // CORREÇÃO 1: Adicionar fileName ao payload de áudio

        endpoint = `http://localhost:8081/message/SendWhatsAppAudio/${instanceName}`;

        payload = {
          number: chatNumber,
          audio: base64,
        };
      } else {
        const extensao = mimetype.split('/')[1] || 'dat';
        payload = {
          number: chatNumber,
          mediatype: 'document',
          mimetype: mimetype,
          caption: remetenteNome.trim(),
          media: base64,
          fileName: mensagem || `documento.${extensao}`
        };
      }

      // Envia para a Evolution API
      await axios.post(endpoint, payload, {
        headers: { apikey: process.env.EVOLUTION_API_KEY },
      });

      // CORREÇÃO 2: Mover a resposta para fora do 'else'
      // para que seja enviada para TODOS os tipos de mídia
      res.status(201).json(mensagem || '[Mídia enviada]');

    } else if (mensagem) {
      // Se não for mídia, é uma mensagem de texto simples
      const endpoint = `http://localhost:8081/message/sendText/${instanceName}`;
      const textoFormatado = `${remetenteNome}${mensagem}`;

      await axios.post(endpoint, {
        number: chatNumber,
        text: textoFormatado,
      }, {
        headers: { apikey: process.env.EVOLUTION_API_KEY },
      });

      res.status(201).json(mensagem);
    } else {
      return res.status(400).send('Corpo da requisição inválido. Mensagem ou mídia necessária.');
    }

  } catch (err) {
    console.error('Erro no processo de envio:', err.response?.data?.response?.message || err.message);
    res.status(500).send(`Erro ao enviar mensagem: ${err.message}`);
  }
});



// Listar todas as mensagens com dados do chat
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select(`
      *,
      chat:chats(id, contato_nome, contato_numero)
    `);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});


// Buscar mensagens por chat_id
router.get('/chat/:chat_id', async (req, res) => {
  const { chat_id } = req.params;
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chat_id)
    .order('criado_em', { ascending: true });

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar mensagem por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('messages')
    .select(`
      *,
      chat:chats(id, contato_nome, contato_numero)
    `)
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar mensagem
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { chat_id, remetente, mensagem, mimetype, base64, transcricao } = req.body;

  const { data, error } = await supabase
    .from('messages')
    .update({ chat_id, remetente, mensagem, mimetype, base64, transcricao })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar mensagem
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('messages').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Mensagem deletada com sucesso');
});

module.exports = router;
