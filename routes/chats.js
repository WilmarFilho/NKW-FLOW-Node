const express = require('express');
const axios = require('axios');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth'); // import do middleware
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- LISTA CHATS COM PAGINAÇÃO (8 em 8) E PELO MENOS 8 MENSAGENS RECENTES ---
router.get("/", authMiddleware, async (req, res) => {
  const {
    limit = 7,
    cursor,
    status = "Open",
    owner = "all",
    search,
    iaStatus = "todos",
    connection_id,
    attendant_id,
  } = req.query;

  const user_id = req.userId;
  const auth_id = req.authId;

  if (!user_id) return res.status(400).json({ error: "User ID é obrigatório." });

  try {

    // 1️⃣ Pega attendant e conexões permitidas
    const { data: attendant } = await supabase
      .from("attendants")
      .select("user_admin_id, connection_id")
      .eq("user_id", auth_id)
      .maybeSingle();

    let attendantFilter = null;
    if (attendant_id) {
      const { data } = await supabase
        .from("attendants")
        .select("connection_id")
        .eq("user_id", attendant_id)
        .maybeSingle();
      attendantFilter = data;
    }

    let query = supabase.from("connections").select("id");
    if (connection_id) {
      query = query.in("id", connection_id.split(",").map((i) => i.trim()));
    } else if (attendantFilter?.connection_id) {
      query = query.eq("id", attendantFilter.connection_id);
    } else if (attendant?.connection_id) {
      query = query.eq("id", attendant.connection_id);
    } else {
      query = query.eq("user_id", user_id);
    }

    const { data: conexoes } = await query;
    if (!conexoes?.length) return res.json({ chats: [], nextCursor: null });
    const connectionIds = conexoes.map((c) => c.id);

    // 2️⃣ Buscar 7 chats
    let chatQuery = supabase
      .from("chats")
      .select(
        "id, contato_nome, contato_numero, connection_id, user_id, ia_ativa, ia_desligada_em, foto_perfil, status, ultima_atualizacao"
      )
      .in("connection_id", connectionIds)
      .order("ultima_atualizacao", { ascending: false })
      .limit(limit);

    if (cursor) {
      const decodedCursor = Buffer.from(cursor, "base64").toString("utf8");
      chatQuery = chatQuery.lt("ultima_atualizacao", decodedCursor);
    }

    if (owner === "mine") chatQuery = chatQuery.eq("user_id", user_id);
    if (status) chatQuery = chatQuery.eq("status", status);
    if (search) chatQuery = chatQuery.ilike("contato_nome", `%${search}%`);
    if (iaStatus === "ativa") chatQuery = chatQuery.eq("ia_ativa", true);
    if (iaStatus === "desativada")
      chatQuery = chatQuery.or("ia_ativa.is.false,ia_ativa.is.null");

    const { data: chats, error: chatError } = await chatQuery;
    if (chatError) throw chatError;
    if (!chats?.length) return res.json({ chats: [], nextCursor: null });

    const chatIds = chats.map((c) => c.id);
    const donoIds = [...new Set(chats.map((c) => c.user_id).filter(Boolean))];

    // 3️⃣ Buscar dados complementares
    const [users, messages] = await Promise.all([

      donoIds.length
      ? supabase.from("users").select("id, nome").in("id", donoIds)
      : { data: [] },

      supabase
      .from("messages")
      .select(
        "chat_id, mensagem, mimetype, remetente"
      )
      .in("chat_id", chatIds)
      .order("criado_em", { ascending: false }),

    ]);

    // 4️⃣ Pega só a última mensagem de cada chat
    const mensagensPorChat = {};
    for (const chatId of chatIds) mensagensPorChat[chatId] = [];
    for (const msg of messages.data || []) {
      if (mensagensPorChat[msg.chat_id].length === 0) {
      mensagensPorChat[msg.chat_id].push(msg);
      }
    }

    // 5️⃣ Montar payload final
    const chatsCompletos = chats.map((chat) => {
      const dono = users.data?.find((d) => d.id === chat.user_id);
      const msgs = mensagensPorChat[chat.id] || [];

      // Pega a mensagem mais recente (primeira do array msgs)
      const ultimaMensagem = msgs[0] || null;

      return {
        ...chat,
        ultima_mensagem: ultimaMensagem,
        user_nome: dono?.nome || null,
      };
    });

    // 6️⃣ Paginação
    let nextCursor = null;
    if (chatsCompletos.length > 0) {
      const last = chatsCompletos[chatsCompletos.length - 1];
      nextCursor = Buffer.from(last.ultima_atualizacao || "").toString("base64");
    }
    
    const result = { chats: chatsCompletos, nextCursor };

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno no servidor" });
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
    // Busca o chat
    const { data: chat, error } = await supabase
      .from('chats')
      .select(
        'id, contato_nome, contato_numero, connection_id, user_id, ia_ativa, ia_desligada_em, foto_perfil, status, ultima_atualizacao'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    // Busca dono
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

    // Busca última mensagem do chat
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('chat_id, mensagem, mimetype, remetente')
      .eq('chat_id', chat.id)
      .order('criado_em', { ascending: false })
      .limit(1);

    if (msgError) throw msgError;

    const ultimaMensagem = messages && messages.length > 0 ? messages[0] : null;

    const chatCompleto = {
      ...chat,
      ultima_mensagem: ultimaMensagem,
      user_nome: dono?.nome || null,
    };

    res.json(chatCompleto);
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


