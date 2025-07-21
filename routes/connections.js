const axios = require("axios");
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Salvar conexão
router.post('/', async (req, res) => {

  const { user_id, nome, numero, status, agente_id } = req.body;
  const { data, error } = await supabase
    .from('connections')
    .insert([{ user_id, nome, numero, status, agente_id }])
    .select();

  const n8nWebhookURL = `http://localhost:5678/webhook/create-session`;
  const responseN8N = await axios.post(n8nWebhookURL, { nome });

  if (error) return res.status(500).send(error.message);
  res.status(201).json(responseN8N.data);
});

// Listar todas conexões com usuário e agente (join)
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('connections')
    .select(`
      *,
      user:users(id, nome, email),
      agente:agents(id, tipo_de_agente, prompt_do_agente)
    `);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar conexão por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('connections')
    .select(`
      *,
      user:users(id, nome, email),
      agente:agents(id, tipo_de_agente, prompt_do_agente)
    `)
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});


// Buscar conexão por ID do usuario
router.get('/usuario/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { data, error } = await supabase
    .from('connections')
    .select(`
      *,
      agente:agents(id, tipo_de_agente, prompt_do_agente)
    `)
    .eq('user_id', user_id);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar conexão
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, nome, numero, status, agente_id } = req.body;

  const { data, error } = await supabase
    .from('connections')
    .update({ user_id, nome, numero, status, agente_id })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar conexão
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('connections').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Conexão deletada com sucesso');
});

const newConnections = {};

// Rota que o FRONT escuta com EventSource
router.get('/webhook/events/:connection', (req, res) => {
  const { connection } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!newConnections[connection]) newConnections[connection] = [];
  newConnections[connection].push(res);

  console.log(`📡 Cliente conectado: ${connection}`);

  req.on('close', () => {
    newConnections[connection] = newConnections[connection].filter(c => c !== res);
    console.log(`❌ Cliente desconectado: ${connection}`);
  });
});

// Rota que o N8N envia eventos ao BACK
router.post('/dispatch', async (req, res) => {
  const { connection, event, data } = req.body;

  try {

    //Atualiza o status e numero da conexão
    if (event === 'connection.update') {

      if (data.state === 'open' && data.wuid) {
        await supabase
          .from('connections')
          .update({
            numero: data.wuid.split('@')[0],
            status: true
          })
          .eq('nome', connection);
      }

      if (data.state === 'close') {
        await supabase
          .from('connections')
          .delete()
          .eq('nome', connection);

        console.log(`🗑 Conexão deletada por evento: ${connection}`);

        // Envia o nome da conexão mesmo que o objeto completo tenha sido apagado
        const enrichedEvent = {
          event,
          connection: { nome: connection },
          state: 'close'
        };

        if (newConnections[connection]) {
          for (const newConnection of newConnections[connection]) {
            newConnection.write(`data: ${JSON.stringify(enrichedEvent)}\n\n`);
          }
        }

        return res.status(200).send('ok, enviado');
      }

    }

    // Buscar a conexão completa pelo nome da instância
    const { data: fullConnection, error } = await supabase
      .from('connections')
      .select(`
        *,
        user:users(id, nome, email),
        agente:agents(id, tipo_de_agente, prompt_do_agente)
      `)
      .eq('nome', connection)
      .single();

    if (error || !fullConnection) {
      console.error('Conexão não encontrada para instancia:', connection);
      return res.status(404).send('Conexão não encontrada');
    }

    const enrichedEvent = {
      event,
      connection: fullConnection, // objeto completo aqui
      wuid: data?.wuid || null,
      state: data?.state || null,
    };

    if (newConnections[connection]) {
      for (const newConnection of newConnections[connection]) {
        newConnection.write(`data: ${JSON.stringify(enrichedEvent)}\n\n`);
      }

      console.log(`📤 Evento enriquecido enviado: ${event} → ${connection}`);
    }

    res.status(200).send('ok, enviado');
  } catch (err) {
    console.error('Erro ao processar dispatch:', err.message);
    res.status(500).send('Erro interno');
  }
});


module.exports = router;
