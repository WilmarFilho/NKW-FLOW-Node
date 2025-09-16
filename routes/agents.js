const router = require('express').Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth');
require('dotenv').config();

// Função para padronizar erros
const sendError = (res, statusCode, message) => res.status(statusCode).json({ message });

// Criar cliente Supabase com chave de serviço
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// LISTA AGENTES APENAS PARA ADMINS
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { authId } = req; // fornecido pelo middleware
    // Verifica se é admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('auth_id', authId)
      .single();

    if (userError || !userData) return sendError(res, 404, 'Usuário não encontrado.');
    if (userData.tipo_de_usuario !== 'admin') return sendError(res, 403, 'Acesso negado. Apenas admins podem acessar.');

    const { data, error } = await supabase.from('agents').select('*');
    if (error) return sendError(res, 500, 'Erro ao buscar agentes.');

    res.json(data);
  } catch (err) {
    console.error('Erro inesperado ao listar agentes:', err);
    return sendError(res, 500, 'Erro inesperado ao listar agentes.');
  }
});

module.exports = router;