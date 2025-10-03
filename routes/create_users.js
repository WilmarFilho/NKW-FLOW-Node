const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

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
  const admin_id = req.authId;
  const { data: dbUser } = await supabase
    .from('users')
    .select('tipo_de_usuario')
    .eq('auth_id', admin_id)
    .single();

  if (!dbUser || dbUser.tipo_de_usuario !== 'admin') return null;
  return dbUser;
};

/**
 * 🟢 Criação manual de usuários
 */
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

    if (tipo_de_usuario === 'admin') {
      if (!checkInternalKey(req)) {
        return sendError(res, 403, 'Somente chamadas internas podem criar admins.');
      }
    } else if (tipo_de_usuario === 'atendente') {
      const adminUser = await checkAdminJWT(req);
      if (!adminUser) {
        return sendError(res, 403, 'Somente admins podem criar atendentes.');
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
        const plan = session.metadata.plan;
        const nome = session.customer_details.name || 'Novo Usuário';
        const cidade = session.customer_details.address?.city || null;
        const endereco = session.customer_details.address?.line1 || null;
        const tipo_de_usuario = 'admin';
    
        // Verifica se usuário já existe
        const { data: existingUser } = await supabase
          .from('users')
          .select('*')
          .eq('email', customerEmail)
          .single();

        // Mandar email para o email do novo usuário com a senha temporária e dados de login
        if (!existingUser) {
          console.log('Enviando email para:', customerEmail);
          const tempPassword = Math.random().toString(36).slice(-10);
          //await sendEmail(customerEmail, 'Bem-vindo!', `Sua senha temporária é: ${tempPassword}`);
        }

        let userId;
        if (!existingUser) {
          const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: customerEmail,
            password: tempPassword,
            email_confirm: true,
          });
          if (authError) throw new Error(authError.message);

          console.log(email, tempPassword, authUser.user.id, session.customer_details.name);

          const { data: userData, error: userError } = await supabase
            .from('users')
            .insert([{
              auth_id: authUser.user.id,
              email: customerEmail,
              nome,
              endereco,
              cidade,
              tipo_de_usuario,
            }])
            .select()
            .single();

          if (userError) throw new Error(userError.message);
          userId = userData.id;
        } else {
          // Caso o usuario já exista, e esta adquirindo novamente, também altere a senha dele e mande o email com a nova senha
          const tempPassword = Math.random().toString(36).slice(-10);
          await supabase.auth.admin.updateUser(existingUser.auth_id, { password: tempPassword });
          //await sendEmail(customerEmail, 'Bem-vindo de volta!', `Sua nova senha é: ${tempPassword}`);
          userId = existingUser.id;
        }

        console.log(`userId: ${userId}, plano: ${plan}  | subscription: ${session.subscription} | customer: ${session.customer} `);

        // Criar assinatura
        await supabase.from('subscriptions').insert([{
          user_id: userId,
          stripe_subscription_id: session.subscription,
          stripe_customer_id: session.customer,
          plan,
          status: 'active',
          start_date: new Date(),
        }]);

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        // Marca como "past_due" e agenda cancelamento para 7 dias
        const cancelDate = new Date();
        cancelDate.setDate(cancelDate.getDate() + 7);

        await supabase.from('subscriptions')
          .update({
            status: 'past_due',
            cancel_at: cancelDate,
          })
          .eq('stripe_subscription_id', subscriptionId);

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await supabase.from('subscriptions')
          .update({ status: 'canceled' })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'customer.subscription.updated': {
        console.log('ooi')
        const subscription = event.data.object;
        await supabase.from('subscriptions')
          .update({
            status: subscription.status,
            cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
          })
          .eq('stripe_subscription_id', subscription.id);
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
