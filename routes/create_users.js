const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const Stripe = require('stripe');
const axios = require('axios'); 
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { sendEmail } = require('../utils/sendEmail');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// 🔒 Função para padronizar erros
const sendError = (res, statusCode, message) => res.status(statusCode).json({ message });

// 🔒 Middleware para validar API_KEY interna
const checkInternalKey = (req) => {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const apiKey = authHeader.split(' ')[1];

  return apiKey === process.env.INTERNAL_API_KEY;
};

// 🔒 Middleware para validar token JWT do Supabase (admins)
const checkAdminJWT = async (req) => {

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido ou inválido.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token inválido.' });

  // Decodifica apenas o payload, sem verificar assinatura
  const payload = jwt.decode(token);
  const tokenAuthId = payload?.sub; // sub = auth_id do Supabase

  if (!tokenAuthId) return res.status(401).json({ error: 'Token inválido.' });

  const { data: dbUser } = await supabase
    .from('users')
    .select('tipo_de_usuario')
    .eq('auth_id', tokenAuthId)
    .single();

  if (!dbUser || dbUser.tipo_de_usuario !== 'admin') return null;
  return dbUser;
};

/**
 * 🟢 Criação manual de usuários
 */
router.post('/', express.json({ limit: '250mb' }), async (req, res) => {

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

    let adminUserId = null;

    if (tipo_de_usuario === 'admin') {
      if (!checkInternalKey(req)) {
        return sendError(res, 403, 'Somente chamadas internas podem criar admins.');
      }
    } else if (tipo_de_usuario === 'atendente') {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'Token não fornecido ou inválido.');
      }

      const token = authHeader.split(' ')[1];
      if (!token) return sendError(res, 401, 'Token inválido.');

      const payload = jwt.decode(token);
      const tokenAuthId = payload?.sub;

      if (!tokenAuthId) return sendError(res, 401, 'Token inválido.');

      const { data: dbUser } = await supabase
        .from('users')
        .select('id, tipo_de_usuario')
        .eq('auth_id', tokenAuthId)
        .single();

      if (!dbUser || dbUser.tipo_de_usuario !== 'admin') {
        return sendError(res, 403, 'Somente admins podem criar atendentes.');
      }

      adminUserId = dbUser.id;

      // Verifica o plano do usuário admin
      const { data: subData, error: subError } = await supabase
        .from('subscriptions')
        .select('plano')
        .eq('user_id', adminUserId)
        .single();

      if (subError || !subData) {
        return sendError(res, 403, 'Plano do usuário não encontrado.');
      }

      // Define limites por plano
      let maxAtendentes = 0;
      if (subData.plano === 'basico') {
        maxAtendentes = 2;
      } else if (subData.plano === 'intermediario') {
        maxAtendentes = 4;
      } else if (subData.plano === 'premium') {
        maxAtendentes = 6;
      }

      // Conta quantos atendentes o admin já tem
      const { count, error: countError } = await supabase
        .from('attendants')
        .select('id', { count: 'exact', head: true })
        .eq('user_admin_id', tokenAuthId);

      if (countError) {
        return sendError(res, 500, 'Erro ao verificar limite de atendentes.');
      }

      if (count >= maxAtendentes) {
        return sendError(res, 400, `Limite de ${maxAtendentes} atendentes atingido para seu plano.`);
      }
    } else {
      return sendError(res, 400, 'Tipo de usuário inválido.');
    }

    // Criar usuário no Supabase Auth
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { tipo: tipo_de_usuario },
      email_confirm: true,
    });
    if (authError) return sendError(res, 400, authError.message);

    // Criar usuário na tabela users
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
      .select()
      .single();

    if (userError) {
      await supabase.auth.admin.deleteUser(authUser.user.id); // rollback
      return sendError(res, 400, userError.message);
    }

    // Envia email de boas-vindas para novos admins
    if (tipo_de_usuario === 'admin') {
      try {
        await sendEmail(email, 'novo_cliente', {
          nome,
          email,
          senha: password
        });
      } catch (emailErr) {
        console.error('Erro ao enviar email de boas-vindas:', emailErr.message);
        // Não falha a criação se email falhar
      }

      // Envia webhook para n8n
      try {
        await axios.post(process.env.N8N_WEBHOOK_USER_CREATED, {
          email,
          number: numero
        });
      } catch (webhookErr) {
        console.error('Erro ao enviar webhook para n8n:', webhookErr.message);
        // Não falha a criação do usuário se webhook falhar
      }
    }

    res.status(201).json({ message: 'Usuário criado com sucesso.', authUser, userData });

  } catch (err) {
    console.error('Erro inesperado ao criar usuário manual:', err);
    return sendError(res, 500, 'Erro interno no servidor.');
  }
});

/**
 * 🟢 Webhook da Stripe - Criação Automática
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️ Erro de assinatura do webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_details.email;
        const nome = session.customer_details.name || 'Novo Usuário';
        const numero = session.customer_details.phone || null;
        const cidade = session.customer_details.address?.city || null;
        const endereco = session.customer_details.address?.line1 || null;
        const tipo_de_usuario = 'admin';
        const tempPassword = Math.random().toString(36).slice(-10);

        // 🔹 Recupera subscription no Stripe para pegar o price_id
        const subscription = await stripe.subscriptions.retrieve(session.subscription, {
          expand: ['items.data.price'],
        });

        const priceId = subscription.items.data[0].price.id;

        let plano;
        let periodo;

        switch (priceId) {
          case 'price_1SEBOjDLO1TMGeDVPT9tyv52': // Anual
            plano = 'premium';
            periodo = 'anual';
            break;
          case 'price_1SDxqnDLO1TMGeDVwcJHs3N9': // Mensal
            plano = 'premium';
            periodo = 'mensal';
            break;
          case 'price_1SEBOyDLO1TMGeDVdyT1Dj9g': // Diario Testes
            plano = 'premium';
            periodo = 'diario';
            break;
          case 'price_1SEBQLDLO1TMGeDVwtIVTcks': // Anual
            plano = 'basico';
            periodo = 'anual';
            break;
          case 'price_1SDxmcDLO1TMGeDVckB3Z8NY': // Mensal
            plano = 'basico';
            periodo = 'mensal';
            break;
          case 'price_1SEBPhDLO1TMGeDVNw911b12': // Anual
            plano = 'intermediario';
            periodo = 'anual';
            break;
          case 'price_1SDxorDLO1TMGeDVy39YaDVO': // Mensal
            plano = 'intermediario';
            periodo = 'mensal';
            break;
          default:
            throw new Error(`Price ID não mapeado: ${priceId}`);
        }

        // Verifica se usuário já existe
        const { data: existingUser } = await supabase
          .from('users')
          .select('*')
          .eq('email', customerEmail)
          .single();

        let userId;

        if (!existingUser) {
          const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: customerEmail,
            password: tempPassword,
            email_confirm: true,
          });
          if (authError) throw new Error(authError.message);

          const { data: userData, error: userError } = await supabase
            .from('users')
            .insert([{
              auth_id: authUser.user.id,
              email: customerEmail,
              nome,
              endereco,
              cidade,
              numero,
              tipo_de_usuario,
            }])
            .select()
            .single();

          if (userError) throw new Error(userError.message);

          // Envia email de boas-vindas usando template
          try {
            await sendEmail(customerEmail, 'novo_cliente', {
              nome,
              email: customerEmail,
              senha: tempPassword
            });
          } catch (emailErr) {
            console.error('Erro ao enviar email de boas-vindas:', emailErr.message);
          }

          userId = userData.id;
        } else {
          await supabase.auth.admin.updateUser(existingUser.auth_id, { password: tempPassword });

          // Envia email com nova senha usando template
          try {
            await sendEmail(customerEmail, 'novo_cliente', {
              nome: existingUser.nome,
              email: customerEmail,
              senha: tempPassword
            });
          } catch (emailErr) {
            console.error('Erro ao enviar email com nova senha:', emailErr.message);
          }

          userId = existingUser.id;
        }

        // Criar assinatura
        await supabase.from('subscriptions').insert([{
          user_id: userId,
          stripe_subscription_id: session.subscription,
          stripe_customer_id: session.customer,
          plano,
          periodo,
          status: 'active',
          start_date: new Date(),
        }]);

        // Envia webhook para n8n após criar admin via Stripe
        try {
          await axios.post(process.env.N8N_WEBHOOK_USER_CREATED, {
            number: numero
          });
        } catch (webhookErr) {
          console.error('Erro ao enviar webhook para n8n:', webhookErr.message);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        const { data: sub } = await supabase
          .from('subscriptions')
          .update({
            status: 'past_due',
          })
          .eq('stripe_subscription_id', subscriptionId)
          .select('user_id')
          .single();

        if (sub?.user_id) {
          const { data: user } = await supabase
            .from('users')
            .select('email, nome')
            .eq('id', sub.user_id)
            .single();

          if (user) {
            try {
              await sendEmail(user.email, 'falha_pagamento', {
                nome: user.nome,
              });
            } catch (emailErr) {
              console.error('Erro ao enviar email de falha de pagamento:', emailErr.message);
            }
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        await supabase
          .from('subscriptions')
          .update({ status: 'active', updated_at: new Date() })
          .eq('stripe_subscription_id', subscriptionId);

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        // Busca a assinatura e o usuário associado
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (sub?.user_id) {
          const { data: user } = await supabase.from('users').select('auth_id, email, nome').eq('id', sub.user_id).single();

          if (user) {
            // Envia email de cancelamento antes de remover dados
            try {
              await sendEmail(user.email, 'cancelamento', {
                nome: user.nome,
              });
            } catch (emailErr) {
              console.error('Erro ao enviar email de cancelamento:', emailErr.message);
            }

            // Remove assinatura
            await supabase.from('subscriptions').delete().eq('stripe_subscription_id', subscription.id);
            // Remove usuário
            await supabase.from('users').delete().eq('id', sub.user_id);
            // Remove autenticação
            await supabase.auth.admin.deleteUser(user.auth_id);
          }
        }

        break;
      }

      default:
        console.log(`Evento Ignorado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('❌ Erro no processamento do webhook:', err);
    res.status(500).send('Internal webhook error');
  }
});

module.exports = router;