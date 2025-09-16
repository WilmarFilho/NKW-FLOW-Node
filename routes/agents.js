const router = require('express').Router();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Função para padronizar erros
const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({ message });
};

// Criar cliente Supabase com chave de serviço
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Função para validar token JWT e retornar o user_id
const validateToken = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.sub) return null; // sub contém user_id
    return decoded.sub;
  } catch (err) {
    return null;
  }
};

// LISTA AGENTES APENAS PARA ADMINS
router.get('/', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return sendError(res, 401, 'Token inválido ou não fornecido.');
    }

    const user_id = validateToken(token);
    if (!user_id) {
      return sendError(res, 401, 'Token inválido.');
    }

    // Verifica se o usuário é admin no banco
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('auth_id', user_id) // usa auth_id para buscar
      .single();

    if (userError || !userData) {
      return sendError(res, 404, 'Usuário não encontrado.');
    }

    if (userData.tipo_de_usuario !== 'admin') {
      return sendError(res, 403, 'Acesso negado. Apenas administradores podem acessar agentes.');
    }

    // Buscar agentes
    const { data, error } = await supabase.from('agents').select('*');

    if (error) {
      console.error('Erro ao buscar agentes:', error);
      return sendError(res, 500, 'Erro ao buscar agentes.');
    }

    res.json(data);
  } catch (err) {
    console.error('Erro inesperado ao listar agentes:', err);
    return sendError(res, 500, 'Erro inesperado ao listar agentes.');
  }
});

module.exports = router;