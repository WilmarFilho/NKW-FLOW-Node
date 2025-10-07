const express = require('express');
const axios = require('axios');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth'); // import do middleware
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
});

// --- LISTA CHATS COM PAGINAÇÃO (8 em 8) E 8 MENSAGENS RECENTES ---
router.get("/", authMiddleware, async (req, res) => {
  const {
    limit = 8, // 👈 chats por página
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
    // 🔹 Cache Redis

    // Monta cacheKey incluindo todos os filtros relevantes
    const cacheKey = [
      "chats",
      user_id,
      cursor || "0",
      status,
      owner,
      search || "",
      iaStatus,
      connection_id || "all",
      attendant_id || "all"
    ].join(":");

    const cached = await redis.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

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

    // 2️⃣ Buscar 8 chats com filtros
    let chatQuery = supabase
      .from("chats")
      .select("id, contato_nome, contato_numero, connection_id, user_id, ia_ativa, ia_desligada_em, foto_perfil, status, ultima_atualizacao")
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
    if (iaStatus === "desativada") chatQuery = chatQuery.or("ia_ativa.is.false,ia_ativa.is.null");

    const { data: chats, error: chatError } = await chatQuery;
    if (chatError) throw chatError;
    if (!chats?.length) return res.json({ chats: [], nextCursor: null });

    const chatIds = chats.map((c) => c.id);
    const donoIds = [...new Set(chats.map((c) => c.user_id).filter(Boolean))];

    // 3️⃣ Buscar dados complementares em paralelo
    const [users, messages, reads] = await Promise.all([
      donoIds.length
        ? supabase.from("users").select("id, nome").in("id", donoIds)
        : { data: [] },
      supabase
        .from("messages")
        .select("id, chat_id, mensagem, mimetype, criado_em, remetente")
        .in("chat_id", chatIds)
        .order("criado_em", { ascending: false })
        .limit(10 * chatIds.length), // 👈 até 10 mensagens por chat
      supabase
        .from("chats_reads")
        .select("chat_id, connection_id, last_read_at")
        .in("chat_id", chatIds)
        .in("connection_id", connectionIds)
    ]);

    // 4️⃣ Agrupar 10 mensagens por chat
    const mensagensPorChat = {};
    for (const msg of messages.data || []) {
      if (!mensagensPorChat[msg.chat_id]) mensagensPorChat[msg.chat_id] = [];
      if (mensagensPorChat[msg.chat_id].length < 8) {
        mensagensPorChat[msg.chat_id].push(msg);
      }
    }

    // 5️⃣ Agrupar last_read_at por chat_id+connection_id
    const lastReadMap = {};
    for (const read of reads.data || []) {
      lastReadMap[`${read.chat_id}:${read.connection_id}`] = read.last_read_at;
    }

    // 6️⃣ Montar payload final
    const chatsCompletos = chats.map((chat) => {
      const dono = users.data?.find((d) => d.id === chat.user_id);
      const msgs = mensagensPorChat[chat.id] || [];

      // Busca o last_read_at para este chat e connection
      const lastReadAt = lastReadMap[`${chat.id}:${chat.connection_id}`];

      // Conta quantas mensagens do contato são posteriores ao last_read_at
      let unread_count = 0;
      if (lastReadAt) {
        unread_count = msgs.filter(
          (m) =>
            m.remetente === "Contato" &&
            (!m.criado_em || new Date(m.criado_em) > new Date(lastReadAt))
        ).length;
      } else {
        unread_count = msgs.filter((m) => m.remetente === "Contato").length;
      }

      return {
        ...chat,
        ultima_mensagem: msgs[0]?.mensagem || null,
        ultima_mensagem_type: msgs[0]?.mimetype || null,
        mensagem_data: msgs[0]?.criado_em || chat.ultima_atualizacao,
        unread_count,
        user_nome: dono?.nome || null,
        ultimas_mensagens: msgs,
      };
    });

    // 7️⃣ Calcular cursor para paginação
    let nextCursor = null;
    if (chatsCompletos.length > 0) {
      const last = chatsCompletos[chatsCompletos.length - 1];
      nextCursor = Buffer.from(last.mensagem_data || "").toString("base64");
    }

    const result = { chats: chatsCompletos, nextCursor };

    // 8️⃣ Cache no Redis (60s)
    await redis.setex(cacheKey, 60, JSON.stringify(result));

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


