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

  console.log(quote_id)

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

        console.log(payload)
        console.log(payload.quoted)

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

// Buscar mensagens por chat_id
router.get('/chat/:chat_id', async (req, res) => {
  const { chat_id } = req.params;

  try {
    const { data, error } = await supabase
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
  .order('criado_em', { ascending: true });


    if (error) {
      console.error('Erro ao buscar mensagens:', error);
      return res.status(500).send('Erro ao buscar mensagens.');
    }

    return res.json(data);
  } catch (err) {
    console.error('Erro inesperado ao buscar mensagens:', err);
    return res.status(500).send('Erro inesperado ao buscar mensagens.');
  }
});

module.exports = router;