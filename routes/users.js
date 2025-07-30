
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar usuário
router.post('/', async (req, res) => {
  const {
    foto_perfil, email, nome, senha_hash, tipo_de_usuario, status,
    modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
    notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
    notificacao_novo_chat
  } = req.body;

  const { data, error } = await supabase
    .from('users')
    .insert([{
      foto_perfil, email, nome, senha_hash, tipo_de_usuario, status,
      modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
      notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
      notificacao_novo_chat
    }])
    .select();

  if (error) return res.status(500).send(error.message);
  res.status(201).json(data);
});

// Listar todos os usuários
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*');
  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar usuário por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single(); // retorna objeto direto em vez de array

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar usuário
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    foto_perfil, email, nome, senha_hash, tipo_de_usuario, status,
    modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
    notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
    notificacao_novo_chat
  } = req.body;

  const { data, error } = await supabase
    .from('users')
    .update({
      foto_perfil, email, nome, senha_hash, tipo_de_usuario, status,
      modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
      notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
      notificacao_novo_chat
    })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar usuário
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Usuário deletado com sucesso');
});

module.exports = router;
