const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Rota para criar usuário admin ou atendente
router.post('/', async (req, res) => {
  try {
    const {
      email,
      password,
      nome,
      tipo_de_usuario, // 'admin' ou 'atendente'
      cidade,
      endereco,
      numero,
      foto_perfil = null,
      ref_code = null,
      referrals_count = 0,
      discount_percent = 0,
      ai_trigger_word = null,
      modo_tela = 'Black',
      modo_side_bar = 'Full',
      mostra_nome_mensagens = false,
      modo_notificacao_atendente = false,
      notificacao_para_entrar_conversa = false,
      notificacao_necessidade_de_entrar_conversa = false,
      notificacao_novo_chat = false
    } = req.body;

    // 1️⃣ Criar usuário no Supabase Auth
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { tipo: tipo_de_usuario },
      email_confirm: true,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    // 2️⃣ Criar usuário na tabela users
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([{
        auth_id: authUser.user.id,
        email,
        nome,
        tipo_de_usuario,
        cidade,
        endereco,
        numero,
        foto_perfil,
        ref_code,
        referrals_count,
        discount_percent,
        ai_trigger_word,
        modo_tela,
        modo_side_bar,
        mostra_nome_mensagens,
        modo_notificacao_atendente,
        notificacao_para_entrar_conversa,
        notificacao_necessidade_de_entrar_conversa,
        notificacao_novo_chat
      }])
      .select() // retorna os dados inseridos
      .single();

    if (userError) {
      // Se falhar, remove o usuário do Auth para não deixar inconsistente
      await supabase.auth.admin.deleteUser(authUser.id);
      return res.status(400).json({ error: userError.message });
    }

    // Sucesso
    res.status(201).json({ message: 'Usuário criado com sucesso.', authUser, userData });

  } catch (err) {
    console.error('Erro inesperado ao criar usuário:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

module.exports = router;
