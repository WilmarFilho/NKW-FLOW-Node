const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const jwt = require('jsonwebtoken');

// Função para padronizar erros
const sendError = (res, statusCode, rawMessage) => {
  let friendlyMessage = rawMessage;
  if (rawMessage.includes('duplicate key value') && rawMessage.includes('email')) {
    friendlyMessage = 'Este e-mail já está cadastrado. Tente outro.';
  }
  return res.status(statusCode).json({ message: friendlyMessage });
};

// Cliente Supabase com service key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Função para validar token JWT do usuário
const validateUserToken = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.sub) return null;
    return decoded.sub; // retorna user_id do Auth
  } catch (err) {
    return null;
  }
};

// --- GET Usuário ---
router.get('/', async (req, res) => {
  const { user_id, token } = req.query;

  if (!user_id) return res.status(400).json({ message: 'user_id é obrigatório' });
  if (!token || typeof token !== 'string') return res.status(401).json({ message: 'Token inválido' });

  const tokenUserId = validateUserToken(token);
  if (!tokenUserId) return res.status(401).json({ message: 'Token inválido' });

  try {
    // Busca usuário pelo auth_id ou id direto
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .or(`auth_id.eq.${user_id},id.eq.${user_id}`)
      .maybeSingle();

    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    if (userError) return sendError(res, 500, userError.message);

    // Busca atendente se houver
    const { data: attendant, error: attendantError } = await supabase
      .from('attendants')
      .select('connection_id, user_admin_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (attendantError) return sendError(res, 500, attendantError.message);

    let responseData = { ...user, role: 'admin' };

    if (attendant?.connection_id) {
      const { data: connection, error: connError } = await supabase
        .from('connections')
        .select('id, nome')
        .eq('id', attendant.connection_id)
        .single();

      if (connError) return sendError(res, 500, connError.message);

      responseData = {
        ...user,
        role: 'attendant',
        connection_id: connection?.id,
        connection_nome: connection?.nome,
        user_admin_id: attendant.user_admin_id,
      };
    }

    return res.json(responseData);
  } catch (err) {
    console.error('Erro inesperado ao buscar usuário:', err);
    return sendError(res, 500, err.message);
  }
});

// --- PUT Usuário ---
router.put('/:id', async (req, res) => {
  const { token } = req.query;
  const targetUserId = req.params.id;

  if (!token || typeof token !== 'string') return res.status(401).json({ message: 'Token inválido' });

  const tokenUserId = validateUserToken(token);
  if (!tokenUserId) return res.status(401).json({ message: 'Token inválido' });

  try {
    // Busca dados do usuário logado
    const { data: authUser, error: authUserError } = await supabase
      .from('users')
      .select('*')
      .or(`auth_id.eq.${tokenUserId},id.eq.${tokenUserId}`)
      .maybeSingle();

    if (!authUser || authUserError) return sendError(res, 401, 'Usuário não autorizado');

    // Busca dados do usuário alvo
    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('*')
      .eq('id', targetUserId)
      .single();

    if (!targetUser || targetError) return sendError(res, 404, 'Usuário não encontrado');

    const {
      foto_perfil, email, nome, numero, senha_hash, tipo_de_usuario, status,
      modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
      notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
      notificacao_novo_chat, cidade, endereco, ref_code, referrals_count, discount_percent, ai_trigger_word
    } = req.body;

    // Se for atendente e tentar alterar outro usuário
    if (authUser.tipo_de_usuario === 'atendente' && authUser.id !== targetUserId) {
      return sendError(res, 403, 'Você não tem permissão para alterar este usuário.');
    }

    // Validação de número
    const validateNumero = (num) => /^\d{10,15}$/.test(num);
    if ('numero' in req.body && !validateNumero(numero)) {
      return sendError(res, 400, 'Número inválido. Digite apenas números, com 10 a 15 dígitos.');
    }

    // Atualizar senha se fornecida
    if (senha_hash && targetUser.auth_id) {
      const { error: authError } = await supabase.auth.admin.updateUserById(targetUser.auth_id, {
        password: senha_hash
      });
      if (authError) return sendError(res, 400, authError.message);
    }

    // Campos permitidos
    const camposAtualizaveis = authUser.tipo_de_usuario === 'admin'
      ? {
        foto_perfil, email, nome, numero, tipo_de_usuario, status,
        modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
        notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
        notificacao_novo_chat, cidade, endereco, ref_code, referrals_count, discount_percent, ai_trigger_word
      }
      : { foto_perfil, email, nome, numero, modo_tela, modo_side_bar, mostra_nome_mensagens };

    const { data, error } = await supabase
      .from('users')
      .update(camposAtualizaveis)
      .eq('id', targetUserId)
      .select();

    if (error) return sendError(res, 500, error.message);

    return res.json({ message: 'Usuário atualizado com sucesso', user: data });
  } catch (err) {
    console.error('Erro inesperado ao atualizar usuário:', err);
    return sendError(res, 500, 'Erro interno no servidor');
  }
});

module.exports = router;
