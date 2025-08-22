// routes/metrics.js
const express = require("express");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 📊 Chats novos
router.get("/chats/novos", async (req, res) => {
  try {
    const { period = "weekly", user_admin_id } = req.query;
    if (!user_admin_id) return res.status(401).json({ error: 'Não autorizado' });

    console.log(user_admin_id)

    const { data: labels, error } = await supabase.rpc('get_chats_stats', { period, user_admin_id });
    if (error) throw error;

    const total = labels.reduce((acc, d) => acc + d.chats, 0);

    // cálculo previous_total omitido para brevidade, mas aplicar mesmo filtro user_admin_id
    const previous_total = 0;

    const diff = total - previous_total;
    const percent = previous_total > 0 ? (diff / previous_total) * 100 : 100;

    res.json({ labels, total, previous_total, diff, percent });
  } catch (err) {
    console.error('Erro ao buscar chats novos:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats novos" });
  }
});

// 📊 Chats fechados
router.get("/chats/fechados", async (req, res) => {
  try {
    const { period = "weekly", user_admin_id } = req.query;
    if (!user_admin_id) return res.status(401).json({ error: 'Não autorizado' });

    const { data: labels, error } = await supabase.rpc('get_chats_stats', { period, status_filter: 'Close', user_admin_id });
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
router.get("/chats/atendentes", async (req, res) => {
  try {
    const { user_admin_id } = req.query;
    if (!user_admin_id) return res.status(401).json({ error: 'Não autorizado' });

    const { data, error } = await supabase.rpc('get_chats_by_attendant', { user_admin_id });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar chats por atendente:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats por atendente" });
  }
});

// 📊 Chats por conexão
router.get("/chats/conexoes", async (req, res) => {
  try {
    const { user_admin_id } = req.query;
    if (!user_admin_id) return res.status(401).json({ error: 'Não autorizado' });

    const { data, error } = await supabase.rpc('get_chats_by_connection', { user_admin_id });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar chats por conexões:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats por conexões" });
  }
});

module.exports = router;