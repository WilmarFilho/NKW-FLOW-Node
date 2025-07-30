
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar chat
router.post('/', async (req, res) => {
  const { connection_id, contato_nome, contato_numero, ia_ativa } = req.body;
  const { data, error } = await supabase
    .from('chats')
    .insert([{ connection_id, contato_nome, contato_numero, ia_ativa }])
    .select();

  if (error) return res.status(500).send(error.message);
  res.status(201).json(data);
});

// Listar todos os chats com dados da conexão
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('chats')
    .select(`
      *,
      connection:connections(id, nome, numero)
    `);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});


// Buscar chats por contato_numero e connection_id
router.get('/buscar', async (req, res) => {
  const { contato_numero, connection_id } = req.body;

  const { data, error } = await supabase
    .from('chats')
    .select(`
      * ,
      connection:connections(id, nome, numero)
    `)
    .eq('contato_numero', contato_numero)
    .eq('connection_id', connection_id);

  if (error) return res.status(500).send(error.message);
  res.status(201).json({ data: data });
});


// Buscar chats por connection_id e contato_numero
router.get('/search/:connection_id/:contato_numero', async (req, res) => {
  const { connection_id, contato_numero } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('connection_id', connection_id)
    .eq('contato_numero', contato_numero)
    .order('ultima_atualizacao', { ascending: false });

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar chats por connection_id
router.get('/connection/:connection_id', async (req, res) => {
  const { connection_id } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('connection_id', connection_id)
    .order('ultima_atualizacao', { ascending: false });

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar chat por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select(`
      *,
      connection:connections(id, nome, numero)
    `)
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar chats por agente_id via conexão
router.get('/agente/:agente_id', async (req, res) => {
  const { agente_id } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select(`
      *,
      connection:connections!chats_connection_id_fkey(id, nome, agente_id)
    `)
    .filter('connection.agente_id', 'eq', agente_id);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar chat
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { connection_id, contato_nome, contato_numero, ia_ativa } = req.body;

  const { data, error } = await supabase
    .from('chats')
    .update({ connection_id, contato_nome, contato_numero, ia_ativa })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar chat
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('chats').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Chat deletado com sucesso');
});

module.exports = router;
