const express = require('express');
const axios = require("axios");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { eventClientsByUser } = require('./events.js');

// Rota para criar mensagem e enviar para a Evolution API
router.post('/', async (req, res) => {

  const { user_id, chat_id, mensagem, mimetype, base64, connection_id, number, remetente, quote_id, file_name } = req.body;

  // Validação básica
  if (!mensagem && !base64) {
    return res.status(400).send('Mensagem ou mídia (base64) é obrigatória.');
  }

  if (base64 && !mimetype) {
    return res.status(400).send('Para enviar mídia, o mimetype é obrigatório.');
  }

  if (chat_id) {
    try {
      // 1. BUSCAR DADOS ESSENCIAIS (Chat, Conexão, Usuário)
      const { data: chatData, error: chatError } = await supabase
        .from('chats')
        .select('id, contato_nome, contato_numero, connection_id')
        .eq('id', chat_id)
        .single();

      if (chatError) {
        console.error('Erro ao buscar chat:', chatError);
        return res.status(404).send('Chat não encontrado');
      }

      const instanceName = chatData.connection_id;
      const chatNumber = chatData.contato_numero;

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('nome, mostra_nome_mensagens')
        .eq('id', user_id)
        .single();

      if (userError) {
        console.error('Erro ao buscar usuário:', userError);
        return res.status(404).send('Usuário não encontrado');
      }

      const remetenteNome = (userData.mostra_nome_mensagens && userData.nome)
        ? `*${userData.nome.trim()}*\n\n`
        : '';

      // --- LÓGICA DE ENVIO ---

      if (base64 && mimetype) {
        let endpoint = `http://localhost:8081/message/sendMedia/${instanceName}`;
        let payload;

        if (mimetype.startsWith('image/')) {
          payload = {
            number: chatNumber,
            mediatype: 'image',
            mimetype: mimetype,
            caption: '',
            media: base64,
            fileName: mensagem || 'image.png',
            ...(quote_id && {
              quoted: {
                key: {
                  id: quote_id
                },

              }
            })
          };
        } else if (mimetype.startsWith('audio/')) {
          endpoint = `http://localhost:8081/message/SendWhatsAppAudio/${instanceName}`;
          payload = {
            number: chatNumber,
            audio: base64,
            ...(quote_id && {
              quoted: {
                key: {
                  id: quote_id
                },

              }
            })
          };
        } else {
          const extensao = mimetype.split('/')[1] || 'dat';
          payload = {
            number: chatNumber,
            mediatype: 'document',
            mimetype: mimetype,
            caption: remetenteNome.trim(),
            media: base64,
            fileName: mensagem || `documento.${extensao}`,
            ...(quote_id && {
              quoted: {
                key: {
                  id: quote_id
                },

              }
            })
          };
        }

        // Envia para a Evolution API
        await axios.post(endpoint, payload, {
          headers: { apikey: process.env.EVOLUTION_API_KEY },
        });

        res.status(201).json(mensagem || '[Mídia enviada]');

      } else if (mensagem) {

        // Mensagem de texto simples
        const endpoint = `http://localhost:8081/message/sendText/${instanceName}`;
        const textoFormatado = `${remetenteNome}${mensagem}`;

        const payload = {
          number: chatNumber,
          text: textoFormatado,
          ...(quote_id && {
            quoted: {
              key: {
                id: quote_id
              },

            }
          })
        };

        await axios.post(endpoint, payload, {
          headers: { apikey: process.env.EVOLUTION_API_KEY },
        });

        res.status(201).json(mensagem);
      } else {
        return res.status(400).send('Corpo da requisição inválido. Mensagem ou mídia necessária.');
      }

    } catch (err) {
      console.error('Erro no processo de envio:', err.response?.data?.response?.message || err.message);
      res.status(500).send(`Erro ao enviar mensagem: ${err.message}`);
    }
  } else {
    try {

      // Envia para a Evolution API
      await axios.post(`http://localhost:8081/message/sendText/${connection_id}`, {
        number: number,
        text: mensagem,
      }, {
        headers: { apikey: process.env.EVOLUTION_API_KEY },
      });

      res.status(201).json(mensagem);

    } catch (err) {
      console.error('Erro no processo de envio:', err.response?.data?.response?.message || err.message);
      return res.status(500).send(`Erro ao enviar mensagem: ${err.message}`);
    }
  }

});

// Buscar mensagens com paginação baseada no criado_em
router.get('/chat/:chat_id', async (req, res) => {
  const { chat_id } = req.params;
  const { limit = 20, cursor } = req.query;

  try {
    let query = supabase
      .from('messages')
      .select(`
        *,
        quote_message: quote_id (
          id,
          mensagem,
          mimetype,
          remetente,
          criado_em
        )
      `)
      .eq('chat_id', chat_id)
      .order('criado_em', { ascending: false }) // mais recentes primeiro
      .limit(limit);

    // Se tiver cursor, busca mensagens mais antigas
    if (cursor) {
      const ts = Buffer.from(cursor, 'base64').toString('utf8');
      query = query.lt('criado_em', ts);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao buscar mensagens:', error);
      return res.status(500).send('Erro ao buscar mensagens.');
    }

    // Definir novo cursor (timestamp da última mensagem retornada)
    let nextCursor = null;
    if (data.length > 0) {
      const last = data[data.length - 1];
      nextCursor = Buffer.from(last.criado_em).toString('base64');
    }

    return res.json({
      messages: data,
      nextCursor
    });
  } catch (err) {
    console.error('Erro inesperado ao buscar mensagens:', err);
    return res.status(500).send('Erro inesperado ao buscar mensagens.');
  }
});

// Apagar mensagem (soft delete no Supabase + Evolution API)
router.delete('/:id', async (req, res) => {

  const { id } = req.params;

  try {
    // 1. Buscar dados da mensagem + chat (pra pegar instance e número)
    const { data: msgData, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        excluded,
        chat_id,
        chats (
          connection_id,
          contato_numero
        )
      `)
      .eq('id', id)
      .single();

    if (msgError || !msgData) {
      console.error('Mensagem não encontrada:', msgError);
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }

    if (msgData.excluded) {
      return res.status(400).json({ error: 'Mensagem já excluída' });
    }

    const instanceName = msgData.chats.connection_id;
    const remoteJid = msgData.chats.contato_numero + '@s.whatsapp.net';

    // 2. Apagar no WhatsApp via Evolution
    try {
      await axios.delete(
        `http://localhost:8081/chat/deleteMessageForEveryone/${instanceName}`,
        {
          data: {
            id: msgData.id,
            remoteJid,
            fromMe: true
          },
          headers: { apikey: process.env.EVOLUTION_API_KEY }
        }
      );

    } catch (evoErr) {
      console.error('Erro ao apagar no Evolution API:', evoErr.response?.data || evoErr.message);
      return res.status(500).json({ error: 'Falha ao apagar no WhatsApp' });
    }

    return res.json({ success: true, id });
  } catch (err) {
    console.error('Erro inesperado ao excluir mensagem:', err);
    return res.status(500).json({ error: 'Erro inesperado ao excluir mensagem' });
  }
});


module.exports = router;


