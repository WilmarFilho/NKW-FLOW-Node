
const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { eventClientsByUser } = require('./events.js');

// Criar mensagem e enviar para Evolution
router.post('/', async (req, res) => {
  const { chat_id, remetente, mensagem, mimetype, base64, transcricao } = req.body;

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
    .select('nome')
    .eq('id', chatData.connection_id)
    .single();

  if (conexaoError) return res.status(500).send(conexaoError.message);

  const instanceName = conexaoData.nome;
  const chatNumber = chatData.contato_numero;

  console.log(instanceName, '--', chatNumber, '---', mensagem)

  // 4. Enviar para EvolutionAPI
  try {
    await axios.post(`http://localhost:8081/message/sendText/${instanceName}`, {
      number: chatNumber,
      text: mensagem,
    }, {
      headers: {
        apikey: process.env.EVOLUTION_API_KEY,
      },
    });
  } catch (sendError) {
    console.error('Erro ao enviar mensagem para Evolution:', sendError.response?.data || sendError.message);
    return res.status(500).send('Erro ao enviar mensagem para EvolutionAPI');
  }

  // 5. Buscar user_id da conexão
  const { data: conexaoCompleta, error: connUserError } = await supabase
    .from('connections')
    .select('id, user_id')
    .eq('id', chatData.connection_id)
    .single();

  if (connUserError) {
    console.error('Erro ao buscar user_id da conexão:', connUserError.message);
    return res.status(500).send('Erro ao identificar usuário da conexão');
  }

  const userId = conexaoCompleta.user_id;

  console.log(eventClientsByUser)

  // 6. Disparar evento SSE para o usuário
  if (eventClientsByUser[userId]) {
    console.log('op')
    const enrichedEvent = {
      event: 'send.message',
      message: mensagem,
    };

    for (const client of eventClientsByUser[userId]) {
      client.write(`data: ${JSON.stringify(enrichedEvent)}\n\n`);
    }

    console.log(`📡 Mensagem enviada via SSE para user_id=${userId}`);

    res.status(201).json(mensagem);
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
