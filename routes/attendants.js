
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar atendente
router.post('/', async (req, res) => {
  const { user_admin_id, user_id } = req.body;
  const { data, error } = await supabase
    .from('attendants')
    .insert([{ user_admin_id, user_id }])
    .select();

  if (error) return res.status(500).send(error.message);
  res.status(201).json(data);
});

// Listar atendentes com usuários relacionados
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('attendants')
    .select(`
      *,
      user_admin:users!attendants_user_admin_id_fkey(id, nome, email),
      user:users!attendants_user_id_fkey(id, nome, email)
    `);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar atendente por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('attendants')
    .select(`
      *,
      user_admin:users!attendants_user_admin_id_fkey(id, nome, email),
      user:users!attendants_user_id_fkey(id, nome, email)
    `)
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar atendente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { user_admin_id, user_id } = req.body;

  const { data, error } = await supabase
    .from('attendants')
    .update({ user_admin_id, user_id })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar atendente
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  // 1. Buscar atendente
  const { data: atendente, error: findError } = await supabase
    .from('attendants')
    .select('user_id')
    .eq('id', id)
    .single();

  if (findError) return res.status(404).send('Atendente não encontrado');

  // 2. Deletar atendente
  const { error: deleteAtendenteError } = await supabase
    .from('attendants')
    .delete()
    .eq('id', id);

  if (deleteAtendenteError) return res.status(500).send(deleteAtendenteError.message);

  // 3. Deletar o user vinculado
  const { error: deleteUserError } = await supabase
    .from('users')
    .delete()
    .eq('id', atendente.user_id);

  if (deleteUserError) return res.status(500).send(deleteUserError.message);

  res.status(200).send('Atendente e usuário deletados com sucesso');
});
module.exports = router;
