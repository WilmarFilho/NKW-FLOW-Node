const express = require('express');
const axios = require('axios');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar chat
router.post('/', async (req, res) => {
  const { connection_id, contato_nome, contato_numero, ia_ativa, status, user_id } = req.body;

  try {
    const { data, error } = await supabase
      .from('chats')
      .insert([{ connection_id, contato_nome, contato_numero, ia_ativa, status, user_id }])
      .select();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('Erro ao criar chat:', err.message);
    res.status(500).send(err.message);
  }
});

// Buscar chats por user_id
router.get('/connections/chats/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { agente_id } = req.query;

  try {
    // Busca conexões do usuário (opcional filtro por agente)
    let query = supabase.from('connections').select('id').eq('user_id', user_id);

    if (agente_id) query = query.eq('agente_id', agente_id);

    const { data: conexoes, error: conexoesError } = await query;

    if (conexoesError) throw conexoesError;

    if (!conexoes || conexoes.length === 0) return res.json([]);

    // Chama RPC para cada conexão e espera resultados
    const chamadas = conexoes.map(c =>
      supabase.rpc('chats_com_ultima_mensagem', { connection_id: c.id })
    );

    const resultados = await Promise.all(chamadas);

    // Remove duplicatas por chat id
    const todosOsChats = resultados
      .flatMap(r => r.data ?? [])
      .reduce((acc, chat) => {
        if (!acc.some(c => c.id === chat.id)) acc.push(chat);
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
  const { connection_id, contato_nome, contato_numero, ia_ativa, status, user_id  } = req.body;

  try {
    const { data, error } = await supabase
      .from('chats')
      .update({ connection_id, contato_nome, contato_numero, ia_ativa, status, user_id })
      .eq('id', id)
      .select('*, connections(*)');

    if (error) throw error;

    const updatedChat = data[0];
    const connection = updatedChat.connections ?? null;

    delete updatedChat.connections;
    updatedChat.connection = connection;

    res.json(updatedChat);
  } catch (err) {
    console.error('Erro ao atualizar chat:', err.message);
    res.status(500).send(err.message);
  }
});

// Buscar chat por id (retorna no mesmo formato da sua função SQL)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // 1) Chat base
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, contato_nome, contato_numero, connection_id, ia_ativa, foto_perfil, status, user_id')
      .eq('id', id)
      .maybeSingle();

    if (chatError) throw chatError;
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    // 2) Última mensagem
    const { data: lastMsg, error: msgError } = await supabase
      .from('messages')
      .select('mensagem, criado_em')
      .eq('chat_id', chat.id)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (msgError) throw msgError;

    // 3) Connection (id, nome, agente_id)
    const { data: conn, error: connError } = await supabase
      .from('connections')
      .select('id, nome, agente_id')
      .eq('id', chat.connection_id)
      .maybeSingle();
    if (connError) throw connError;

    // 4) Agent (id, tipo_agente)
    let agente = null;
    if (conn?.agente_id) {
      const { data: ag, error: agError } = await supabase
        .from('agents') 
        .select('id, tipo_de_agente')
        .eq('id', conn.agente_id)
        .maybeSingle();
      if (agError) throw agError;
      agente = ag ?? null;
    }

    // 5) Monta o payload exatamente como sua função faz
    const payload = {
      id: chat.id,
      contato_nome: chat.contato_nome,
      contato_numero: chat.contato_numero,
      connection_id: chat.connection_id,
      ia_ativa: chat.ia_ativa,
      foto_perfil: chat.foto_perfil,
      status: chat.status,
      user_id: chat.user_id,
      ultima_mensagem: lastMsg?.mensagem ?? null,
      mensagem_data: lastMsg?.criado_em ?? null,
      connection: {
        id: conn?.id ?? null,
        nome: conn?.nome ?? null,
        agente_id: conn?.agente_id ?? null,
        agente: agente, // { id, tipo_agente } ou null
      },
    };

    res.json(payload);
  } catch (err) {
    console.error('Erro ao buscar chat:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Atualiza foto de perfil do chat
router.put('/fetchImage/:chatId', async (req, res) => {
  const { chatId } = req.params;
  if (!chatId) return res.status(400).json({ error: 'chatId é obrigatório' });

  try {
    const { data: chat, error } = await supabase
      .from('chats')
      .select('id, contato_numero, connection_id')
      .eq('id', chatId)
      .maybeSingle();

    if (error || !chat) return res.status(404).json({ error: 'Chat não encontrado' });

    const fotoURL = await axios.post(
      `http://localhost:8081/chat/fetchProfilePictureUrl/${chat.connection_id}`,
      { number: chat.contato_numero },
      { headers: { apikey: process.env.EVOLUTION_API_KEY } }
    );

    const { profilePictureUrl } = fotoURL.data;

    const { data: updatedChat, error: updateError } = await supabase
      .from('chats')
      .update({ foto_perfil: profilePictureUrl || null })
      .eq('id', chatId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.status(200).json(updatedChat);

  } catch (err) {
    console.error('Erro ao atualizar foto de perfil:', err.message);
    res.status(500).json({ error: 'Erro ao buscar nova imagem' });
  }
});

// Deletar chat
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase.from('chats').delete().eq('id', id);
    if (error) throw error;
    res.status(200).send('Chat deletado com sucesso');
  } catch (err) {
    console.error('Erro ao deletar chat:', err.message);
    res.status(500).send(err.message);
  }
});

module.exports = router;