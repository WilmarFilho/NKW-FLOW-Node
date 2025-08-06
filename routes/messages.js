
const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { eventClientsByUser } = require('./events.js');

// Criar mensagem e enviar para Evolution
router.post('/', async (req, res) => {
  const { user_id, chat_id, remetente, mensagem, mimetype, base64, transcricao } = req.body;

  let remetenteNome = '';

  // 2. Buscar dados do chat (contato e conexão)
  const { data: chatData, error: chatError } = await supabase
    .from('chats')
    .select('id, contato_nome, contato_numero, connection_id')
    .eq('id', chat_id)
    .single();

  if (chatError) return res.status(500).send(chatError.message);

  // 3. Buscar instance_name da conexão
  const { data: conexaoData, error: conexaoError } = await supabase
    .from('connections')
    .select('id')
    .eq('id', chatData.connection_id)
    .single();

  if (conexaoError) return res.status(500).send(conexaoError.message);

  const instanceName = conexaoData.id;
  const chatNumber = chatData.contato_numero;

  console.log('Bateu no endpoint post de message: ', instanceName, '--', chatNumber, '---', mensagem)

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('nome, mostra_nome_mensagens')
    .eq('id', user_id)
    .single();

  if (userError) return res.status(500).send(userError.message);

  if (userData.mostra_nome_mensagens) {
    remetenteNome = `*${userData.nome}* \n\n`;
  }

  const textoFormatado = `${remetenteNome}${mensagem}`;

  console.log(chatData.connection_id, '------', textoFormatado)

  // 4. Enviar para EvolutionAPI
  try {
    await axios.post(`http://localhost:8081/message/sendText/${chatData.connection_id}`, {
      number: chatNumber,
      text: textoFormatado,
    }, {
      headers: {
        apikey: process.env.EVOLUTION_API_KEY,
      },
    });
  } catch (sendError) {
    console.error('Erro ao enviar mensagem para Evolution:', sendError.response?.data || sendError.message);
    return res.status(500).send('Erro ao enviar mensagem para EvolutionAPI');
  }

  res.status(201).json(mensagem);
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
