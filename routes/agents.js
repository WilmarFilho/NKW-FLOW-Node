const router = require('express').Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth');
require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

// Função para padronizar erros
const sendError = (res, statusCode, message) => res.status(statusCode).json({ message });

// Criar cliente Supabase com chave de serviço
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Cliente Supabase para banco RAG
const supabaseRAG = createClient(process.env.SUPABASE_URL_RAG, process.env.SUPABASE_KEY_RAG);

// LISTA AGENTES APENAS PARA ADMINS
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { authId, userId } = req; // authId e userId fornecidos pelo middleware
    const cacheKey = `agents:${authId}`;

    // Tenta buscar do cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Verifica se é admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('auth_id', authId)
      .single();

    if (userError || !userData) return sendError(res, 404, 'Usuário não encontrado.');
    if (userData.tipo_de_usuario !== 'admin') return sendError(res, 403, 'Acesso negado. Apenas admins podem acessar.');

    // Busca o plano do usuário na tabela subscription
    const { data: subData, error: subError } = await supabase
      .from('subscriptions')
      .select('plano')
      .eq('user_id', userId)
      .single();

    if (subError || !subData) return sendError(res, 403, 'Plano do usuário não encontrado.');

    let agentsQuery = supabase.from('agents').select('*');
    let agentsData = [];

    if (subData.plano === 'basico') {
      // Não retorna nenhum agente para plano básico
      agentsData = [];
    } else if (subData.plano === 'intermediario') {
      const { data, error } = await agentsQuery.eq('tipo_plano', 'intermediario');
      if (error) return sendError(res, 500, 'Erro ao buscar agentes.');
      agentsData = data;
    } else {
      // Premium: retorna todos
      const { data, error } = await agentsQuery;
      if (error) return sendError(res, 500, 'Erro ao buscar agentes.');
      agentsData = data;
    }

    // Busca status e resumo da base de conhecimento no banco RAG
    let ragStatus = null;

    if (subData.plano !== 'basico') {
      try {
       
        const { data: ragData, error: ragError } = await supabaseRAG
          .from('rag_status')
          .select('status_conhecimento, resumo')
          .eq('user_id', userId)
          .maybeSingle();

      } catch (ragErr) {
        console.error('Erro ao buscar status RAG:', ragErr);
        ragStatus = {
          status: 'erro',
          resumo: 'Erro ao acessar base de conhecimento',
          total_documentos: 0,
          ultimo_processamento: null
        };
      }
    }

    // Monta resposta final com agentes e status RAG
    const response = {
      agents: agentsData,
      rag_status: ragStatus
    };

    // Salva no cache por 30 minutos
    await redis.set(cacheKey, JSON.stringify(response), 'EX', 1800);

    res.json(response);
  } catch (err) {
    console.error('Erro inesperado ao listar agentes:', err);
    return sendError(res, 500, 'Erro inesperado ao listar agentes.');
  }
});

module.exports = router;