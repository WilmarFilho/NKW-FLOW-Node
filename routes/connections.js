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
  res.status(201).json(data);
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


module.exports = router;
