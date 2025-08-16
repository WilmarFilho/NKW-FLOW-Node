const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar leitura
router.post('/', async (req, res) => {
  const { user_id, chat_id, last_read_at } = req.body;

  const { data, error } = await supabase
    .from('chats_reads')
    .insert([{ user_id, chat_id, last_read_at }])
    .select();

  if (error) return res.status(500).send(error.message);
  res.status(201).json(data);
});

// Listar todas as leituras
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('chats_reads').select('*');
  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar leitura por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('chats_reads')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar leitura
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, chat_id, last_read_at } = req.body;

  const { data, error } = await supabase
    .from('chats_reads')
    .update({ user_id, chat_id, last_read_at })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar leitura
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('chats_reads').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Leitura deletada com sucesso');
});

module.exports = router;
