const axios = require("axios");
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

// HELPER DE ERRO
function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// --- CRIA NOVA CONEXÃO ---
router.post('/', authMiddleware, async (req, res) => {
  const { nome, agente_id, numero } = req.body;
  const user_id = req.userId;

  // ---- INÍCIO DA LÓGICA AJUSTADA ----

  let numeroFormatado = null

  if (numero) {
    numeroFormatado = numero

    // 2. Remove o nono dígito extra, se existir (ex: 64992434104 → 6492434104)
    if (numeroFormatado.length === 11 && numeroFormatado.charAt(2) === '9') {
      const ddd = numeroFormatado.substring(0, 2);
      const numeroSem9 = numeroFormatado.substring(3);
      numeroFormatado = `${ddd}${numeroSem9}`;
    }

    // 3. Adiciona novamente o prefixo 55 (ficando 12 dígitos no total)
    numeroFormatado = `55${numeroFormatado}`;

    // ---- FIM DA LÓGICA AJUSTADA ----

    // 4. Valida formato final (deve ter exatamente 12 dígitos)
    if (!/^\d{12}$/.test(numeroFormatado)) {
      return sendError(
        res,
        400,
        `Número inválido: ${numero}. O formato final esperado é 55 + DDD + número (12 dígitos, sem o nono dígito).`
      );
    }
  }

  if (!user_id || !nome) {
    return sendError(res, 400, 'Nome e usuário são obrigatórios.');
  }

  try {
    // Busca o plano do usuário na tabela subscriptions
    const { data: subData, error: subError } = await supabase
      .from('subscriptions')
      .select('plano')
      .eq('user_id', user_id)
      .single();

    if (subError || !subData) return sendError(res, 403, 'Plano do usuário não encontrado.');

    let maxConnections = 4;
    let requireAgente = true;

    if (subData.plano === 'basico') {
      maxConnections = 2;
      requireAgente = false;
    } else if (subData.plano === 'intermediario') {
      maxConnections = 4;
    } else if (subData.plano === 'premium') {
      maxConnections = 6;
    }

    if (requireAgente && !agente_id) {
      return sendError(res, 400, 'O campo agente_id é obrigatório para este plano.');
    }

    // Verifica limite de conexões do usuário
    const { count, error: countError } = await supabase
      .from('connections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user_id);

    if (countError) throw countError;
    if (count >= maxConnections) {
      return sendError(res, 400, `Limite de ${maxConnections} conexões atingido para seu plano.`);
    }

    // Salvar conexão no Supabase 
    const { data, error } = await supabase
      .from('connections')
      .insert([{ user_id, nome, numero: numero, status: null, agente_id: agente_id || null }])
      .select();

    if (error || !data || data.length === 0) throw error || new Error('Falha ao salvar conexão.');

    const instanceId = data[0].id;



    // Criar instância no Evolution
    // Monta a URL do endpoint Evolution, adicionando ?number=numero se numero existir
    let evolutionUrl = `${process.env.EVOLUTION_API_URL}/instance/create`;
    if (numeroFormatado) {
      evolutionUrl += `?number=${encodeURIComponent(numeroFormatado)}`;
      console.log(numeroFormatado)
    }

    const evolutionResponse = await axios.post(
      evolutionUrl,
      {
        instanceName: instanceId,
        qrcode: true,
        groupsIgnore: true,
        alwaysOnline: true,
        readMessages: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          url: `${process.env.NODE_HOST}/events/dispatch`,
          events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE', 'MESSAGES_DELETE'],
        },
      },
      { headers: { apikey: process.env.EVOLUTION_API_KEY } }
    );

    res.status(201).json(evolutionResponse.data.qrcode);
  } catch (err) {
    console.error('Erro ao criar conexão:', err.response?.data || err.message || err);
    sendError(res, 500, 'Erro ao criar conexão.');
  }
});

// --- LISTAR CONEXÕES DO USUÁRIO ---
router.get('/', authMiddleware, async (req, res) => {
  const user_id = req.userId;

  try {
    // Verifica se o usuário é admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('id', user_id)
      .single();

    if (userError || !userData) return sendError(res, 404, 'Usuário não encontrado.');
    if (userData.tipo_de_usuario !== 'admin') return sendError(res, 403, 'Acesso negado. Apenas admins.');

    // Limpeza de conexões com status null
    const { data: nullConnections } = await supabase
      .from('connections')
      .select('id')
      .eq('user_id', user_id)
      .is('status', null);

    if (nullConnections?.length > 0) {
      for (const conn of nullConnections) {
        try {
          await axios.delete(`${process.env.EVOLUTION_API_URL}/instance/delete/${conn.id}`, { headers: { apikey: process.env.EVOLUTION_API_KEY } });
        } catch (evoErr) {
          console.error(`Erro ao deletar instância ${conn.id} na Evolution:`, evoErr.response?.data || evoErr.message);
        }
      }

      await supabase.from('connections').delete().eq('user_id', user_id).is('status', null);
    }

    // Busca conexões
    const { data, error } = await supabase
      .from('connections')
      .select(`*, user:users(id, nome, email), agente:agents(id, tipo_de_agente, prompt_do_agente)`)
      .eq('user_id', user_id);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Erro ao listar conexões:', err);
    sendError(res, 500, 'Erro ao listar conexões.');
  }
});

// --- ATUALIZAR CONEXÃO ---
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { nome, agente_id } = req.body;

  if (!id) return sendError(res, 400, 'ID da conexão é obrigatório.');

  try {
    const { data, error } = await supabase
      .from('connections')
      .update({ nome, agente_id })
      .eq('id', id)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) return sendError(res, 404, 'Conexão não encontrada.');
    res.json(data);
  } catch (err) {
    console.error('Erro ao atualizar conexão:', err);
    sendError(res, 500, 'Erro ao atualizar conexão.');
  }
});

// --- DELETAR CONEXÃO ---
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!id) return sendError(res, 400, 'ID da conexão é obrigatório.');

  try {
    // Busca user_id antes de deletar
    const { data: connData } = await supabase
      .from('connections')
      .select('user_id')
      .eq('id', id)
      .single();

    const user_id = connData?.user_id;

    const { data: attendantsData } = await supabase
      .from('attendants')
      .select('user_id')
      .eq('connection_id', id);

    const authIds = attendantsData?.map(a => a.user_id) || [];

    const { error: delError } = await supabase
      .from('connections')
      .delete()
      .eq('id', id);


    for (const authId of authIds) {
      try {
        await supabase.auth.admin.deleteUser(authId);
      } catch (err) {
        console.error(`Erro ao deletar auth.user ${authId}:`, err.message || err);
      }
    }

    if (delError) throw delError;

    // Remove do Evolution
    try {
      await axios.delete(`${process.env.EVOLUTION_API_URL}/instance/delete/${id}`, { headers: { apikey: process.env.EVOLUTION_API_KEY } });
    } catch (axiosErr) {
      console.error('Erro ao deletar instância no Evolution:', axiosErr.response?.data || axiosErr.message);
    }

    // Limpa o cache
    if (user_id) {
      const cacheKey = `chats:${user_id}:0`;
      try {
        await redis.del(cacheKey);
      } catch (cacheErr) {
        console.error('Erro ao limpar cache:', cacheErr.message || cacheErr);
      }
    }

    res.status(200).json({ message: 'Conexão deletada com sucesso.' });
  } catch (err) {
    console.error('Erro ao deletar conexão:', err);
    sendError(res, 500, 'Erro ao deletar conexão.');
  }
});

module.exports = router;