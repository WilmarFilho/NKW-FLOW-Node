const axios = require("axios");
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// HELPER DE ERRO
function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// CRIA NOVA CONEXÃO
router.post('/', async (req, res) => {
  const { user_id, nome, agente_id } = req.body;

  if (!user_id || !nome || !agente_id) {
    return sendError(res, 400, 'Todos os campos são obrigatórios.');
  }
  try {
    // 1. Salvar conexão no Supabase 
    const { data, error } = await supabase
      .from('connections')
      .insert([{
        user_id,
        nome,
        numero: null,
        status: false,
        agente_id
      }])
      .select();

    if (error) {
      console.error('Erro ao inserir conexão no Supabase:', error);
      return sendError(res, 500, 'Erro ao salvar conexão no banco de dados.');
    }

    if (!data || data.length === 0) {
      return sendError(res, 500, 'Falha ao salvar conexão, dados não retornados.');
    }

    const instanceId = data[0].id;

    try {
      // 1. Criar instância no Evolution com o instanceName sendo o Id dela no supabase
      const evolutionResponse = await axios.post('http://localhost:8081/instance/create', {
        instanceName: instanceId,
        qrcode: true,
        groupsIgnore: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          url: 'http://host.docker.internal:5678/webhook/evolution',
          events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE', 'CHATS_UPSERT', 'MESSAGES_DELETE'],
        },
      }, {
        headers: {
          apikey: process.env.EVOLUTION_API_KEY
        }
      });

      const { instance, qrcode } = evolutionResponse.data;

      // 3. Retornar o QR Code ao front
      res.status(201).json(qrcode.base64);
    } catch (err) {
      console.error('Erro ao criar instância no Evolution:', evolutionErr.response?.data || evolutionErr.message);
      return sendError(res, 500, 'Erro ao criar instância no Evolution.');
    }
  } catch (supabaseErr) {
    console.error('Erro geral ao salvar conexão:', supabaseErr);
    return sendError(res, 500, 'Erro inesperado ao salvar conexão.');
  }
});

// LISTAR CONEXÕES DO USUÁRIO 
router.get('/', async (req, res) => {
  try {

    const { user_id } = req.query;

    // Verifica se o usuário é admin no banco
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('id', user_id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (userData.tipo_de_usuario !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem acessar conexões.' });
    }

    const { data, error } = await supabase
      .from('connections')
      .select(`
        *,
        user:users(id, nome, email),
        agente:agents(id, tipo_de_agente, prompt_do_agente)
      `)
      .eq('user_id', user_id);

    if (error) {
      console.error('Erro ao buscar conexões:', error);
      return res.status(500).json({ error: 'Erro ao buscar conexões.' });
    }

    return res.json(data);
  } catch (err) {
    console.error('Erro inesperado ao listar conexões:', err);
    return res.status(500).json({ error: 'Erro inesperado ao listar conexões.' });
  }
});

// ATUALIZAR CONEXÃO
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, nome, numero, status, agente_id } = req.body;

  if (!id) {
    return sendError(res, 400, 'ID da conexão é obrigatório.');
  }

  try {
    const { data, error } = await supabase
      .from('connections')
      .update({ user_id, nome, numero, status, agente_id })
      .eq('id', id)
      .select();

    if (error) {
      console.error('Erro ao atualizar conexão:', error);
      return sendError(res, 500, 'Erro ao atualizar conexão.');
    }

    if (!data || data.length === 0) {
      return sendError(res, 404, 'Conexão não encontrada.');
    }

    return res.json(data);

  } catch (err) {
    console.error('Erro geral ao atualizar conexão:', err);
    return sendError(res, 500, 'Erro inesperado ao atualizar conexão.');
  }
});

// DELETAR CONEXÃO 
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return sendError(res, 400, 'ID da conexão é obrigatório para deletar.');
  }

  try {
    const { error } = await supabase.from('connections').delete().eq('id', id);

    if (error) {
      console.error('Erro ao deletar conexão no banco:', error);
      return sendError(res, 500, 'Erro ao deletar conexão no banco.');
    }

    try {
      await axios.delete(`http://localhost:8081/instance/delete/${id}`, {
        headers: { apikey: process.env.EVOLUTION_API_KEY },
      });
    } catch (axiosErr) {
      console.error('Erro ao deletar instância no Evolution:', axiosErr.response?.data || axiosErr.message);
      return sendError(res, 500, 'Erro ao deletar conexão no Evolution.');
    }

    return res.status(200).json({ message: 'Conexão deletada com sucesso.' });

  } catch (err) {
    console.error('Erro geral ao deletar conexão:', err);
    return sendError(res, 500, 'Erro inesperado ao deletar conexão.');
  }
});

module.exports = router;