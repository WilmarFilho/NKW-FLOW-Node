const express = require('express');
const axios = require('axios');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);


// Marcar chat como lido
router.post('/:id', async (req, res) => {

  const { id: chatId } = req.params;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId é obrigatório' });
  }

  try {
    // Busca chat completo via RPC, incluindo unread_messages
    const { data: chat, error: chatError } = await supabase
      .rpc('chat_por_id', { p_chat_id: chatId })
      .maybeSingle();

    if (chatError) throw chatError;
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });

    // Monta payload com todas as mensagens não lidas
    const payload = {
      readMessages: chat.unread_messages.map(msg => ({
        remoteJid: chat.contato_numero + '@s.whatsapp.net',
        fromMe: false,
        id: msg.id
      }))
    };

    if (payload.readMessages.length > 0) {
      // Chama a Evolution API para marcar como lido
      await axios.post(
        `http://localhost:8081/chat/markMessageAsRead/${chat.connection_id}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.EVOLUTION_API_KEY
          }
        }
      );

      // Marca como lido (upsert em chats_reads)
      const { error } = await supabase
        .from('chats_reads')
        .upsert(
          {
            chat_id: chatId,
            connection_id: chat.connection_id,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: ['chat_id', 'connection_id'] }
        );

      if (error) throw error;
    }

    res.status(200).json({ success: true });
    
  } catch (err) {
    console.error('Erro ao marcar chat como lido:', err.message);
    res.status(500).json({ error: 'Erro ao marcar chat como lido' });
  }
});

// Listar todas as leituras
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('chats_reads').select('*');
  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar leitura por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('chats_reads')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar leitura
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { user_id, chat_id, last_read_at } = req.body;

  const { data, error } = await supabase
    .from('chats_reads')
    .update({ user_id, chat_id, last_read_at })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar leitura
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('chats_reads').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Leitura deletada com sucesso');
});

module.exports = router;
