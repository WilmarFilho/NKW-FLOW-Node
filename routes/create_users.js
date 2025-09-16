const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 🔒 Função para padronizar erros
const sendError = (res, statusCode, message) => res.status(statusCode).json({ message });

// 🔒 Middleware para validar API_KEY interna (somente admins internos)
const checkInternalKey = (req) => {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const apiKey = authHeader.split(' ')[1];
  return apiKey === process.env.INTERNAL_API_KEY;
};

// 🔒 Middleware para validar token JWT do Supabase (admins)
const checkAdminJWT = async (req) => {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: dbUser } = await supabase
    .from('users')
    .select('tipo_de_usuario')
    .eq('auth_id', user.id)
    .single();

  if (!dbUser || dbUser.tipo_de_usuario !== 'admin') return null;
  return dbUser;
};

// 🔑 Rota para criar usuários
router.post('/', async (req, res) => {
  try {
    const {
      email,
      password,
      nome,
      tipo_de_usuario, // 'admin' ou 'atendente'
      cidade,
      endereco,
      numero,
      foto_perfil = null,
      ref_code = null,
      referrals_count = 0,
      discount_percent = 0,
      ai_trigger_word = null,
      modo_tela = 'Black',
      modo_side_bar = 'Full',
      mostra_nome_mensagens = false,
      modo_notificacao_atendente = false,
      notificacao_para_entrar_conversa = false,
      notificacao_necessidade_de_entrar_conversa = false,
      notificacao_novo_chat = false
    } = req.body;

    // 🔒 Verificação de segurança
    if (tipo_de_usuario === 'admin') {
      if (!checkInternalKey(req)) {
        return sendError(res, 403, 'Somente chamadas internas podem criar admins.');
      }
    } else if (tipo_de_usuario === 'atendente') {
      const adminUser = await checkAdminJWT(req);
      if (!adminUser) {
        return sendError(res, 403, 'Somente admins podem criar atendentes.');
      }
    } else {
      return sendError(res, 400, 'Tipo de usuário inválido.');
    }

    // 1️⃣ Criar usuário no Supabase Auth
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { tipo: tipo_de_usuario },
      email_confirm: true,
    });

    if (authError) return sendError(res, 400, authError.message);

    // 2️⃣ Criar usuário na tabela users
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([{
        auth_id: authUser.user.id,
        email,
        nome,
        tipo_de_usuario,
        cidade,
        endereco,
        numero,
        foto_perfil,
        ref_code,
        referrals_count,
        discount_percent,
        ai_trigger_word,
        modo_tela,
        modo_side_bar,
        mostra_nome_mensagens,
        modo_notificacao_atendente,
        notificacao_para_entrar_conversa,
        notificacao_necessidade_de_entrar_conversa,
        notificacao_novo_chat
      }])
      .select()
      .single();

    if (userError) {
      // rollback no Supabase Auth
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return sendError(res, 400, userError.message);
    }

    res.status(201).json({ message: 'Usuário criado com sucesso.', authUser, userData });

  } catch (err) {
    console.error('Erro inesperado ao criar usuário:', err);
    return sendError(res, 500, 'Erro interno no servidor.');
  }
});

module.exports = router;