const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Função para padronizar erros e melhorar mensagens conhecidas
const sendError = (res, statusCode, rawMessage) => {
  let friendlyMessage = rawMessage;

  // Tratamento de erros conhecidos
  if (rawMessage.includes('duplicate key value') && rawMessage.includes('email')) {
    friendlyMessage = 'Este e-mail já está cadastrado. Tente outro.';
  }

  return res.status(statusCode).json({ message: friendlyMessage });
};

// Função de validação de e-mail
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmedEmail = email.trim();
  if (trimmedEmail.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
}

// Criar usuário
router.post('/', async (req, res) => {
  try {
    const {
      foto_perfil, email, nome, numero, senha_hash, tipo_de_usuario, status,
      modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
      notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
      notificacao_novo_chat, cidade, endereco, referrals_cout, discount_percent
    } = req.body;

    // Validação de nome
    if (!nome || nome.trim().length < 3) {
      return sendError(res, 400, 'O nome é obrigatório e deve ter pelo menos 3 caracteres.');
    }

    // Validação de e-mail
    if (!validateEmail(email)) {
      return sendError(res, 400, 'E-mail inválido. Forneça um e-mail válido.');
    }


    // Validação de número (somente dígitos, de 10 a 15 caracteres)
    const validateNumero = (numero) => {
      return /^\d{10,15}$/.test(numero);
    };

    if (!validateNumero(numero)) {
      return sendError(res, 400, 'Número inválido. Digite apenas números, com 10 a 15 dígitos.');
    }

    const { data, error } = await supabase
      .from('users')
      .insert([{
        foto_perfil, email, nome, senha_hash, tipo_de_usuario, status, numero,
        modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
        notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
        notificacao_novo_chat, cidade, endereco, referrals_cout, discount_percent
      }])
      .select();

    if (error) {
      console.error('Erro ao criar usuário:', error.message);
      return sendError(res, 500, error.message);
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Erro inesperado ao criar usuário:', err);
    return sendError(res, 500, err.message);
  }
});

// Buscar usuário por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Erro ao buscar usuário:', error.message);
      return sendError(res, 500, error.message);
    }

    res.json(data);
  } catch (err) {
    console.error('Erro inesperado ao buscar usuário:', err);
    return sendError(res, 500, err.message);
  }
});

// Atualizar usuário
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
        foto_perfil, email, nome, senha_hash, tipo_de_usuario, status, numero,
        modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
        notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
        notificacao_novo_chat, cidade, endereco, referrals_cout, discount_percent
    } = req.body;

    // Validação de número (somente dígitos, de 10 a 15 caracteres)
    const validateNumero = (numero) => {
      return /^\d{10,15}$/.test(numero);
    };

    // Validação no PUT
    if ('numero' in req.body) {
      if (!validateNumero(req.body.numero)) {
        return sendError(res, 400, 'Número inválido. Digite apenas números, com 10 a 15 dígitos.');
      }
    }

    const { data, error } = await supabase
      .from('users')
      .update({
        foto_perfil, email, nome, senha_hash, tipo_de_usuario, status, numero,
        modo_tela, modo_side_bar, mostra_nome_mensagens, modo_notificacao_atendente,
        notificacao_para_entrar_conversa, notificacao_necessidade_de_entrar_conversa,
        notificacao_novo_chat, cidade, endereco, referrals_cout, discount_percent
      })
      .eq('id', id)
      .select();

    if (error) {
      console.error('Erro ao atualizar usuário:', error.message);
      return sendError(res, 500, error.message);
    }

    res.json(data);
  } catch (err) {
    console.error('Erro inesperado ao atualizar usuário:', err);
    return sendError(res, 500, err.message);
  }
});

module.exports = router;