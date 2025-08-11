const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar atendente
router.post('/', async (req, res) => {
  try {
    const { user_admin_id, user_id } = req.body;

    if (!user_admin_id || !user_id) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    const { data, error } = await supabase
      .from('attendants')
      .insert([{ user_admin_id, user_id }])
      .select();

    if (error) {
      console.error('Erro ao criar atendente:', error);
      return res.status(500).json({ error: 'Erro ao criar atendente.' });
    }

    res.status(201).json({ message: 'Atendente criado com sucesso.', data });
  } catch (err) {
    console.error('Erro inesperado ao criar atendente:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// Listar atendentes com usuários relacionados
router.post('/list', async (req, res) => {
  try {
    const { user_admin_id, tipo_de_usuario } = req.body;

    if (!user_admin_id || !tipo_de_usuario) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    let filtroId = user_admin_id;

    // Se for atendente, buscar o admin dele
    if (tipo_de_usuario === 'atendente') {
      const { data: attendant, error: attendantError } = await supabase
        .from('attendants')
        .select('user_admin_id')
        .eq('user_id', user_admin_id)
        .single();

      if (attendantError) {
        console.error('Erro ao buscar admin do atendente:', attendantError);
        return res.status(500).json({ error: 'Erro ao buscar administrador.' });
      }

      if (!attendant) {
        return res.status(404).json({ error: 'Administrador não encontrado para este atendente.' });
      }

      filtroId = attendant.user_admin_id;
    }

    const { data, error } = await supabase
      .from('attendants')
      .select(`
        *,
        user_admin:users!attendants_user_admin_id_fkey(id, nome, email),
        user:users!attendants_user_id_fkey(id, nome, email, status, numero)
      `)
      .eq('user_admin_id', filtroId);

    if (error) {
      console.error('Erro ao listar atendentes:', error);
      const message = error.message;
      return res.status(500).json({ error: `Erro ao listar atendentes: ${message}` });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('Erro inesperado ao listar atendentes:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// Deletar o atendente
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'ID do atendente é obrigatório.' });
    }

    // 1. Buscar atendente
    const { data: atendente, error: findError } = await supabase
      .from('attendants')
      .select('user_id')
      .eq('id', id)
      .single();

    if (findError) {
      console.error('Erro ao buscar atendente:', findError);
      return res.status(500).json({ error: 'Erro ao buscar atendente.' });
    }

    if (!atendente) {
      return res.status(404).json({ error: 'Atendente não encontrado.' });
    }

    // 2. Deletar atendente
    const { error: deleteAtendenteError } = await supabase
      .from('attendants')
      .delete()
      .eq('id', id);

    if (deleteAtendenteError) {
      console.error('Erro ao deletar atendente:', deleteAtendenteError);
      return res.status(500).json({ error: 'Erro ao deletar atendente.' });
    }

    // 3. Deletar o user vinculado
    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', atendente.user_id);

    if (deleteUserError) {
      console.error('Erro ao deletar usuário vinculado:', deleteUserError);
      return res.status(500).json({ error: 'Erro ao deletar usuário vinculado.' });
    }

    res.status(200).json({ message: 'Atendente e usuário deletados com sucesso.' });
  } catch (err) {
    console.error('Erro inesperado ao deletar atendente:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

module.exports = router;