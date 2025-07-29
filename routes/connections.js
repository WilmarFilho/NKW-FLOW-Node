const axios = require("axios");
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Salvar conexão
router.post('/', async (req, res) => {
  const { user_id, nome, agente_id } = req.body;

  try {
    // 1. Criar instância no Evolution
    const evolutionResponse = await axios.post('http://localhost:8081/instance/create', {
      instanceName: nome,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        url: 'http://host.docker.internal:5678/webhook/evolution',
        events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE'],
      },
    }, {
      headers: {
        apikey: process.env.EVOLUTION_API_KEY
      }
    });

    const { instance, qrcode } = evolutionResponse.data;

    // 2. Salvar conexão no Supabase com o mesmo ID
    const { data, error } = await supabase
      .from('connections')
      .insert([{
        id: instance.instanceId,
        user_id,
        nome,
        numero: null,
        status: false,
        agente_id
      }])
      .select();

    if (error) return res.status(500).send(error.message);

    // 3. Retornar o QR Code ao front
    res.status(201).json({ instance: instance.instanceId, qr_code: qrcode.base64 });
  } catch (err) {
    console.error('Erro ao criar instância:', err.message);
    res.status(500).send('Erro ao criar instância no Evolution');
  }
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
router.delete('/:id/:instanceName', async (req, res) => {
  const { id, instanceName } = req.params;
  const { error } = await supabase.from('connections').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);

  try {
    await axios.delete(`http://localhost:8081/instance/delete/${instanceName}`, {
      headers: {
        apikey: process.env.EVOLUTION_API_KEY,
      },
    });
  } catch (sendError) {
    console.error('Erro ao deletar conexão:', sendError.response?.data || sendError.message);
    return res.status(500).send('Erro ao deletar conexão');
  }

  res.status(200).send('Conexão deletada com sucesso');
});

module.exports = router;
