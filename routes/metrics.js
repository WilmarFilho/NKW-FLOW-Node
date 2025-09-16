const express = require("express");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth'); // middleware de autenticação
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 📊 Chats novos
router.get("/chats/novos", authMiddleware, async (req, res) => {
  try {
    const period = req.query.period || "weekly";
    const user_admin_id = req.userId;

    // Garante que apenas admins possam acessar
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('id', user_admin_id)
      .single();
    if (userError || !userData || userData.tipo_de_usuario !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas admins.' });
    }

    const { data: labels, error } = await supabase.rpc('get_chats_stats', { period, user_admin_id });
    if (error) throw error;

    const total = labels.reduce((acc, d) => acc + d.chats, 0);
    const previous_total = 0; // aplicar mesmo filtro se houver
    const diff = total - previous_total;
    const percent = previous_total > 0 ? (diff / previous_total) * 100 : 100;

    res.json({ labels, total, previous_total, diff, percent });
  } catch (err) {
    console.error('Erro ao buscar chats novos:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats novos" });
  }
});

// 📊 Chats fechados
router.get("/chats/fechados", authMiddleware, async (req, res) => {
  try {
    const period = req.query.period || "weekly";
    const user_admin_id = req.userId;

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('id', user_admin_id)
      .single();
    if (userError || !userData || userData.tipo_de_usuario !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas admins.' });
    }

    const status_filter = 'Close';
    const { data: labels, error } = await supabase.rpc('get_chats_stats', { period, user_admin_id, status_filter });
    if (error) throw error;

    const total = labels.reduce((acc, d) => acc + d.chats, 0);
    const previous_total = 0;
    const diff = total - previous_total;
    const percent = previous_total > 0 ? (diff / previous_total) * 100 : 100;

    res.json({ labels, total, previous_total, diff, percent });
  } catch (err) {
    console.error('Erro ao buscar chats fechados:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats fechados" });
  }
});

// 📊 Chats por atendente
router.get("/chats/atendentes", authMiddleware, async (req, res) => {
  try {
    const user_admin_id = req.userId;

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('id', user_admin_id)
      .single();
    if (userError || !userData || userData.tipo_de_usuario !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas admins.' });
    }

    const { data, error } = await supabase.rpc('get_chats_by_attendant', { user_admin_id });
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar chats por atendente:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats por atendente" });
  }
});

// 📊 Chats por conexão
router.get("/chats/conexoes", authMiddleware, async (req, res) => {
  try {
    const user_admin_id = req.userId;

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('id', user_admin_id)
      .single();
    if (userError || !userData || userData.tipo_de_usuario !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas admins.' });
    }

    const { data, error } = await supabase.rpc('get_chats_by_connection', { user_admin_id });
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar chats por conexões:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats por conexões" });
  }
});

module.exports = router;