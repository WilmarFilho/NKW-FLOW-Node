const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

// Cliente Supabase com service key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Função para padronizar erros
const sendError = (res, statusCode, rawMessage) => {
  let friendlyMessage = rawMessage;
  if (rawMessage?.includes('duplicate key value') && rawMessage?.includes('email')) {
    friendlyMessage = 'Este e-mail já está cadastrado. Tente outro.';
  }
  return res.status(statusCode).json({ message: friendlyMessage });
};

// Middleware para validar token e adicionar user_id ao req
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token ausente ou inválido.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.decode(token);
    if (!decoded?.sub) return res.status(401).json({ message: 'Token inválido.' });
    req.user_id = decoded.sub; // auth_id do Supabase
    next();
  } catch (err) {
    console.error('Erro ao validar token:', err);
    return res.status(500).json({ message: 'Erro interno ao validar token.' });
  }
};

// --- GET Usuário ---
router.get('/', authMiddleware, async (req, res) => {
  const tokenUserId = req.user_id;
  const cacheKey = `user:${tokenUserId}`;

  try {
    // Tenta buscar do cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Busca usuário pelo auth_id
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', tokenUserId)
      .maybeSingle();

    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    if (userError) return sendError(res, 500, userError.message);

    // Busca plano na tabela subscription pelo user_id
    const { data: subscription, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('plano, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (subscriptionError) return sendError(res, 500, subscriptionError.message);

    // Se for atendente, busca sua conexão
    if (user.tipo_de_usuario === 'atendente') {
      const { data: attendant, error: attendantError } = await supabase
        .from('attendants')
        .select('connection_id, user_admin_id')
        .eq('user_id', user.auth_id)
        .maybeSingle();

      if (attendantError) return sendError(res, 500, attendantError.message);

      if (attendant) {
        const { data: connection, error: connError } = await supabase
          .from('connections')
          .select('id, nome')
          .eq('id', attendant.connection_id)
          .single();
        if (connError) return sendError(res, 500, connError.message);

        const result = {
          ...user,
          role: 'attendant',
          connection_id: connection?.id,
          connection_nome: connection?.nome,
          user_admin_id: attendant.user_admin_id,
          plano: subscription?.plano,
          subscription_status: subscription?.status
        };
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
        return res.json(result);
      }
    }

    const result = { ...user, role: 'admin', plano: subscription?.plano, subscription_status: subscription?.status };
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
    return res.json(result);
  } catch (err) {
    console.error('Erro inesperado ao buscar usuário:', err);
    return sendError(res, 500, err.message);
  }
});

// --- PUT Usuário ---
router.put('/:id', authMiddleware, async (req, res) => {
  const tokenUserId = req.user_id;
  const targetUserId = req.params.id;
  const cacheKey = `user:${tokenUserId}`;

  try {
    // Usuário logado
    const { data: authUser, error: authUserError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', tokenUserId)
      .maybeSingle();

    if (!authUser || authUserError) return sendError(res, 401, 'Usuário não autorizado');

    // Usuário alvo
    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('*')
      .eq('id', targetUserId)
      .single();

    if (!targetUser || targetError) return sendError(res, 404, 'Usuário não encontrado');

    // Permissão de atendente
    if (authUser.tipo_de_usuario === 'attendant' && authUser.id !== targetUserId) {
      return sendError(res, 403, 'Você não tem permissão para alterar este usuário.');
    }

    // Validação de número
    if ('numero' in req.body) {
      const validateNumero = (num) => /^\d{10,15}$/.test(num);
      if (!validateNumero(req.body.numero)) {
        return sendError(res, 400, 'Número inválido. Digite apenas números, com 10 a 15 dígitos.');
      }
    }

    let newToken = null;

    // Atualizar senha se fornecida
    if (req.body.password && targetUser.auth_id) {
      const { error: authError } = await supabase.auth.admin.updateUserById(targetUser.auth_id, {
        password: req.body.password
      });
      if (authError) return sendError(res, 400, authError.message);

      // Gerar novo token automaticamente
      const { data: authSession, error: loginError } = await supabase.auth.signInWithPassword({
        email: targetUser.email,
        password: req.body.password
      });

      if (loginError) return sendError(res, 400, 'Senha atualizada, mas erro ao gerar novo token');

      newToken = authSession.session.access_token;
    }

    // Campos permitidos
    let allowedFields = [];
    if (authUser.tipo_de_usuario === 'admin') {
      allowedFields = [
        'foto_perfil', 'nome', 'tipo_de_usuario', 'status',
        'modo_tela', 'modo_side_bar', 'mostra_nome_mensagens', 'modo_notificacao_atendente',
        'notificacao_para_entrar_conversa', 'notificacao_necessidade_de_entrar_conversa',
        'notificacao_novo_chat', 'cidade', 'endereco', 'ref_code', 'referrals_count',
        'discount_percent', 'ai_trigger_word'
      ];
    } else {
      // Atendente só pode alterar preferências de tela e sidebar
      allowedFields = ['modo_tela', 'modo_side_bar'];
    }

    // Construir objeto de atualização
    const updateData = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', targetUserId)
      .select();

    if (error) return sendError(res, 500, error.message);

    // Busca plano atualizado na tabela subscription
    const { data: subscription, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('plano, status')
      .eq('user_id', targetUserId)
      .maybeSingle();

    // Limpa o cache do usuário ao atualizar
    await redis.del(cacheKey);

    return res.json({
      ...data,
      plano: subscription?.plano,
      subscription_status: subscription?.status,
      token: newToken
    });
  } catch (err) {
    console.error('Erro inesperado ao atualizar usuário:', err);
    return sendError(res, 500, 'Erro interno no servidor');
  }
});

module.exports = router;