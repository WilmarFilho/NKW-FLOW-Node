const express = require('express');
const axios = require('axios');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth'); // import do middleware
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- LISTA CHATS COM PAGINAÇÃO E FILTROS ---
router.get('/', authMiddleware, async (req, res) => {
  const {
    limit = 20,
    cursor,
    status,
    owner,
    search,
    iaStatus,
    connectionId,
    attendantId,
  } = req.query;

  const user_id = req.userId;   // sempre enviado do frontend
  const auth_id = req.authId;                 // do token JWT

  if (!user_id) return res.status(400).json({ error: 'User ID é obrigatório.' });

  let resolvedUserId = null;

  try {
    const { data: attendant } = await supabase
      .from('attendants')
      .select('user_admin_id, connection_id')
      .eq('user_id', auth_id)
      .maybeSingle();

    resolvedUserId = attendant
      ? (await supabase.from('users').select('id').eq('auth_id', attendant.user_admin_id).maybeSingle()).data.id
      : user_id;

    // 1) Busca conexões
    let query = supabase.from('connections').select('id').eq('user_id', resolvedUserId);
    if (attendant?.connection_id) query = query.eq('id', attendant.connection_id);
    if (connectionId) query = query.eq('id', connectionId);

    const { data: conexoes } = await query;
    if (!conexoes || conexoes.length === 0) return res.json({ chats: [], nextCursor: null });

    // 2) Chama RPC
    const chamadas = conexoes.map(c =>
      c.id &&
      supabase.rpc('chats_com_ultima_mensagem', {
        p_limit: limit,
        p_cursor: cursor ? Buffer.from(cursor, 'base64').toString('utf8') : null,
        p_search: search || null,
        p_status: status || 'Open',
        p_owner: owner || 'all',
        p_user_id: owner === 'mine' ? user_id : null,
        p_ia_status: iaStatus || 'todos',
        p_attendant_id: attendantId || null
      })
    ).filter(Boolean);

    const resultados = await Promise.allSettled(chamadas);
    const chats = resultados
      .filter(r => r.status === 'fulfilled' && r.value.data)
      .flatMap(r => r.value.data);

    // 3) Remove duplicatas
    const todosOsChats = chats.reduce((acc, chat) => {
      if (!acc.some(c => c.id === chat.id)) acc.push(chat);
      return acc;
    }, []);

    // 4) Enriquecer com nome do dono
    const donoIds = [...new Set(todosOsChats.map(c => c.user_id).filter(Boolean))];
    let donos = [];
    if (donoIds.length > 0) {
      const { data } = await supabase.from('users').select('id, nome').in('id', donoIds);
      donos = data;
    }

    const chatsComDono = todosOsChats.map(chat => {
      const dono = donos.find(d => d.id === chat.user_id);
      return { ...chat, user_nome: dono ? dono.nome : null };
    });

    let nextCursor = null;
    if (chatsComDono.length > 0) {
      const last = chatsComDono[chatsComDono.length - 1];
      nextCursor = Buffer.from(last.mensagem_data).toString('base64');
    }

    res.json({ chats: chatsComDono, nextCursor });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- CRIA UM CHAT ---
router.post('/', authMiddleware, async (req, res) => {
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

// --- BUSCA CHAT POR ID ---
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: chat, error } = await supabase
      .rpc('chat_por_id', { p_chat_id: id })
      .maybeSingle();

    if (error) throw error;
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    let dono = null;
    if (chat.user_id) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, nome')
        .eq('id', chat.user_id)
        .maybeSingle();

      if (userError) throw userError;
      dono = userData;
    }

    res.json({ ...chat, user_nome: dono ? dono.nome : null });
  } catch (err) {
    console.error('Erro ao buscar chat:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// --- ATUALIZA FOTO DE PERFIL DO CHAT ---
router.put('/fetchImage/:chatId', authMiddleware, async (req, res) => {
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
      `${process.env.EVOLUTION_API_URL}/chat/fetchProfilePictureUrl/${chat.connection_id}`,
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

// --- DELETA O CHAT ---
router.delete('/:id', authMiddleware, async (req, res) => {
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

// --- ATUALIZA O CHAT ---
router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { contato_nome, ia_ativa, status, user_id } = req.body;

  try {
    const { data, error } = await supabase
      .from('chats')
      .update({ contato_nome, ia_ativa, status, user_id })
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

module.exports = router;


