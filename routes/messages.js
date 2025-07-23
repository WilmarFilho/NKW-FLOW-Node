
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar mensagem
router.post('/', async (req, res) => {
  const { chat_id, remetente, mensagem, mimetype, base64, transcricao } = req.body;
  const { data, error } = await supabase
    .from('messages')
    .insert([{ chat_id, remetente, mensagem, mimetype, base64, transcricao }])
    .select();

  if (error) return res.status(500).send(error.message);
  res.status(201).json(data);
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
