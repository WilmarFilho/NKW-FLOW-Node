
const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar chat
router.post('/', async (req, res) => {
  const { connection_id, contato_nome, contato_numero, ia_ativa } = req.body;
  const { data, error } = await supabase
    .from('chats')
    .insert([{ connection_id, contato_nome, contato_numero, ia_ativa }])
    .select();

  if (error) return res.status(500).send(error.message);
  res.status(201).json(data);
});

// Buscar chats por user_id
router.get('/connections/chats/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { agente_id } = req.query;

  try {
    // 1. Busca conexões do usuário (com ou sem filtro por agente)
    let query = supabase
      .from('connections')
      .select('id')
      .eq('user_id', user_id);

    if (agente_id) {
      query = query.eq('agente_id', agente_id);
    }

    const { data: conexoes, error: conexoesError } = await query;

    if (conexoesError) return res.status(500).send(conexoesError.message);
    if (!conexoes || conexoes.length === 0) return res.json([]);

    // 2. Executa chamada da função RPC para cada conexão
    const chamadas = conexoes.map(c =>
      supabase.rpc('chats_com_ultima_mensagem', { connection_id: c.id })
    );

    const resultados = await Promise.all(chamadas);

    // 3. Remove duplicatas por ID de chat
    const todosOsChats = resultados
      .flatMap(r => r.data ?? [])
      .reduce((acc, chat) => {
        if (!acc.some(c => c.id === chat.id)) {
          acc.push(chat);
        }
        return acc;
      }, []);


    res.json(todosOsChats);

  } catch (err) {
    console.error('Erro ao listar chats do usuário:', err.message);
    res.status(500).send('Erro interno');
  }
});

// Atualizar chat
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { connection_id, contato_nome, contato_numero, ia_ativa, status } = req.body;

  const { data, error } = await supabase
    .from('chats')
    .update({ connection_id, contato_nome, contato_numero, ia_ativa, status })
    .eq('id', id)
    .select('*, connections(*)');

  if (error) return res.status(500).send(error.message);

  console.log(data)
  // Renomear 'connections' para 'connection' se vier como array
  const updatedChat = data[0];
  const connection = updatedChat.connections ? updatedChat.connections : null;

  // Remove o campo 'connections' e adiciona 'connection'
  delete updatedChat.connections;
  updatedChat.connection = connection;

  res.json(updatedChat);

});

// Atualiza foto de perfil do chat
router.put('/fetchImage/:chatId', async (req, res) => {
  const { chatId } = req.params;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId é obrigatório' });
  }

  try {
    // 1. Busca o chat com info da conexão
    const { data: chat, error } = await supabase
      .from('chats')
      .select('id, contato_numero, connection_id')
      .eq('id', chatId)
      .maybeSingle();

    if (error || !chat) {
      return res.status(404).json({ error: 'Chat não encontrado' });
    }

    // 2. Busca a nova imagem de perfil via EvolutionAPI
    const fotoURL = await axios.post(
      `http://localhost:8081/chat/fetchProfilePictureUrl/${chat.connection_id}`,
      { number: chat.contato_numero },
      { headers: { apikey: process.env.EVOLUTION_API_KEY } }
    );

    const { profilePictureUrl } = fotoURL.data;

    // 3. Atualiza no banco e retorna o chat atualizado
    const { data: updatedChat, error: updateError } = await supabase
      .from('chats')
      .update({ foto_perfil: profilePictureUrl || null })
      .eq('id', chatId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json(updatedChat);
  } catch (err) {
    console.error('Erro ao atualizar foto de perfil:', err.message);
    return res.status(500).json({ error: 'Erro ao buscar nova imagem' });
  }
});

// Deletar chat
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('chats').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Chat deletado com sucesso');
});

module.exports = router;