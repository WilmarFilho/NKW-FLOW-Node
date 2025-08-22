const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- Middleware para checar se user_id é admin ---
const adminCheck = async (user_id) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('tipo_de_usuario')
    .eq('id', user_id)
    .single();

  if (error) throw new Error('Erro ao verificar tipo de usuário.');
  if (!user || user.tipo_de_usuario !== 'admin') return false;
  return true;
};

// --- CRIA ATENDENTE ---
router.post('/', async (req, res) => {
  try {
    const { user_admin_id, user_id, connection_id } = req.body;

    if (!user_admin_id || !user_id) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    // Apenas admin pode criar atendente
    const isAdmin = await adminCheck(user_admin_id);
    if (!isAdmin) return res.status(403).json({ error: 'Apenas administradores podem criar atendentes.' });

    const { data, error } = await supabase
      .from('attendants')
      .insert([{ user_admin_id, user_id, connection_id }])
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

// --- LISTA ATENDENTES ---
router.get('/', async (req, res) => {
  try {
    const { user_admin_id } = req.query;

    if (!user_admin_id) return res.status(400).json({ error: 'ID do usuário é obrigatório.' });

    const isAdmin = await adminCheck(user_admin_id);
    if (!isAdmin) return res.status(403).json({ error: 'Apenas administradores podem requisitar a lista completa de atendentes.' });

    const { data, error } = await supabase
      .from('attendants')
      .select(`
        *,
        user_admin:users!attendants_user_admin_id_fkey(id, nome, email),
        user:users!attendants_user_id_fkey(id, nome, email, status, numero),
        connection:connections!attendants_connection_id_fkey(id, nome)
      `)
      .eq('user_admin_id', user_admin_id);

    if (error) {
      console.error('Erro ao listar atendentes:', error);
      return res.status(500).json({ error: `Erro ao listar atendentes: ${error.message}` });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('Erro inesperado ao listar atendentes:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// --- ATUALIZA ATENDENTE (PATCH) ---
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_admin_id, ...updateData } = req.body;

    if (!id || !user_admin_id) return res.status(400).json({ error: 'ID do atendente e ID do admin são obrigatórios.' });

    const isAdmin = await adminCheck(user_admin_id);
    if (!isAdmin) return res.status(403).json({ error: 'Apenas administradores podem atualizar atendentes.' });

    const { data, error } = await supabase
      .from('attendants')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Erro ao atualizar atendente:', error);
      return res.status(500).json({ error: 'Erro ao atualizar atendente.' });
    }

    res.status(200).json({ message: 'Atendente atualizado com sucesso.', data });
  } catch (err) {
    console.error('Erro inesperado ao atualizar atendente:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// --- DELETA ATENDENTE ---
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_admin_id } = req.body;

    if (!id || !user_admin_id) return res.status(400).json({ error: 'ID do atendente e ID do admin são obrigatórios.' });

    const isAdmin = await adminCheck(user_admin_id);
    if (!isAdmin) return res.status(403).json({ error: 'Apenas administradores podem deletar atendentes.' });

    const { data: attendant, error: findError } = await supabase
      .from('attendants')
      .select('user_id')
      .eq('id', id)
      .single();

    if (findError) {
      console.error('Erro ao buscar atendente:', findError);
      return res.status(500).json({ error: 'Erro ao buscar atendente.' });
    }
    if (!attendant) return res.status(404).json({ error: 'Atendente não encontrado.' });

    const { error: deleteAttendantError } = await supabase
      .from('attendants')
      .delete()
      .eq('id', id);

    if (deleteAttendantError) {
      console.error('Erro ao deletar atendente:', deleteAttendantError);
      return res.status(500).json({ error: 'Erro ao deletar atendente.' });
    }

    const { error: deleteUserError } = await supabase
      .from('users')
      .delete()
      .eq('id', attendant.user_id);

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