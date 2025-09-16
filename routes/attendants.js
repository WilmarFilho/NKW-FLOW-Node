const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth'); // nosso middleware global
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Função de checagem de admin
const isAdmin = async (authId) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('tipo_de_usuario')
    .eq('auth_id', authId)
    .single();
  if (error || !user) throw new Error('Usuário não encontrado.');
  return user.tipo_de_usuario === 'admin';
};

// --- CRIA ATENDENTE ---
router.post('/', authMiddleware, async (req, res) => {
  try {
    const admin_id = req.authId;
    const { user_id: newUserId, connection_id } = req.body;

    if (!newUserId) return res.status(400).json({ error: 'ID do usuário a ser vinculado é obrigatório.' });
    if (!(await isAdmin(admin_id))) return res.status(403).json({ error: 'Apenas admins podem criar atendentes.' });

    const { data, error } = await supabase
      .from('attendants')
      .insert([{ user_admin_id: admin_id, user_id: newUserId, connection_id }])
      .select();

    if (error) return res.status(500).json({ error: 'Erro ao criar atendente.' });

    res.status(201).json({ message: 'Atendente criado com sucesso.', data });
  } catch (err) {
    console.error('Erro inesperado ao criar atendente:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// --- LISTA ATENDENTES ---
router.get('/', authMiddleware, async (req, res) => {
  try {
    const admin_id = req.authId;
    if (!(await isAdmin(admin_id))) return res.status(403).json({ error: 'Apenas admins podem listar atendentes.' });

    const { data, error } = await supabase
      .from('attendants')
      .select(`
        *,
        user_admin:users!attendants_user_admin_id_fkey(id, nome, email),
        user:users!attendants_user_id_fkey(id, nome, email, status, numero),
        connection:connections!attendants_connection_id_fkey(id, nome)
      `)
      .eq('user_admin_id', admin_id);

    if (error) return res.status(500).json({ error: 'Erro ao listar atendentes.' });

    res.status(200).json(data);
  } catch (err) {
    console.error('Erro inesperado ao listar atendentes:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// --- ATUALIZA ATENDENTE ---
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const admin_id = req.authId;
    const { id } = req.params;
    const updateBody = req.body;

    if (!(await isAdmin(admin_id))) return res.status(403).json({ error: 'Apenas admins podem atualizar atendentes.' });

    const { data: attendant, error: findError } = await supabase
      .from('attendants')
      .select('user_id, connection_id')
      .eq('id', id)
      .single();
    if (findError || !attendant) return res.status(404).json({ error: 'Atendente não encontrado.' });

    const updatesUser = {};
    const updatesAttendant = {};
    const userFields = ['nome', 'numero', 'status'];

    userFields.forEach(field => {
      if (field in updateBody) updatesUser[field] = updateBody[field];
    });

    if (updateBody.email) {
      const { error: authError } = await supabase.auth.admin.updateUserById(attendant.user_id, { email: updateBody.email });
      if (authError) return res.status(500).json({ error: 'Erro ao atualizar email no Auth.' });
      updatesUser.email = updateBody.email;
    }

    if (updateBody.password) {
      const { error: passError } = await supabase.auth.admin.updateUserById(attendant.user_id, { password: updateBody.password });
      if (passError) return res.status(500).json({ error: 'Erro ao atualizar senha no Auth.' });
    }

    if ('connection_id' in updateBody) updatesAttendant.connection_id = updateBody.connection_id;

    if (Object.keys(updatesUser).length > 0) {
      const { error: userError } = await supabase
        .from('users')
        .update(updatesUser)
        .eq('auth_id', attendant.user_id);
      if (userError) return res.status(500).json({ error: 'Erro ao atualizar dados do usuário.' });
    }

    if (Object.keys(updatesAttendant).length > 0) {
      const { error: attError } = await supabase
        .from('attendants')
        .update(updatesAttendant)
        .eq('id', id);
      if (attError) return res.status(500).json({ error: 'Erro ao atualizar atendente.' });
    }

    res.status(200).json({ message: 'Atendente atualizado com sucesso.' });
  } catch (err) {
    console.error('Erro inesperado ao atualizar atendente:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// --- DELETA ATENDENTE ---
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const admin_id = req.authId;
    const { id } = req.params;
    if (!(await isAdmin(admin_id))) return res.status(403).json({ error: 'Apenas admins podem deletar atendentes.' });

    const { data: attendant, error: findError } = await supabase
      .from('attendants')
      .select('user_id')
      .eq('id', id)
      .single();
    if (findError) return res.status(500).json({ error: 'Erro ao buscar atendente.' });
    if (!attendant) return res.status(404).json({ error: 'Atendente não encontrado.' });

    const { error: deleteAttendantError } = await supabase
      .from('attendants')
      .delete()
      .eq('id', id);
    if (deleteAttendantError) return res.status(500).json({ error: 'Erro ao deletar atendente.' });

    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(attendant.user_id);
    if (deleteAuthError) return res.status(500).json({ error: 'Erro ao deletar usuário do Auth.' });

    res.status(200).json({ message: 'Atendente e usuário Auth deletados com sucesso.' });
  } catch (err) {
    console.error('Erro inesperado ao deletar atendente:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

module.exports = router;