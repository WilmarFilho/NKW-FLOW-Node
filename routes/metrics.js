const express = require("express");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

router.get("/chats/novos", async (req, res) => {
  try {
    const { period = "weekly" } = req.query;

    // 📊 Labels atuais
    const { data: labels, error } = await supabase.rpc('get_chats_stats', { period });
    if (error) throw error;

    // 🔢 Total atual
    const total = labels.reduce((acc, d) => acc + d.chats, 0);

    // 📊 Período anterior
    let previous_total = 0;

    if (period === "weekly") {
      // Semana anterior: -13 até -7
      const { data, error: prevError } = await supabase.from('chats')
        .select('id')
        .gte('ultima_atualizacao', new Date(new Date().setDate(new Date().getDate() - 13)).toISOString())
        .lte('ultima_atualizacao', new Date(new Date().setDate(new Date().getDate() - 7)).toISOString());

      if (prevError) throw prevError;
      previous_total = data.length;
    } else {
      // 6 meses anteriores: -11 até -6
      const { data, error: prevError } = await supabase.from('chats')
        .select('id')
        .gte('ultima_atualizacao', new Date(new Date().setMonth(new Date().getMonth() - 11)).toISOString())
        .lte('ultima_atualizacao', new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString());

      if (prevError) throw prevError;
      previous_total = data.length;
    }

    // 📈 Diferença e porcentagem
    const diff = total - previous_total;
    const percent = previous_total > 0 ? (diff / previous_total) * 100 : 100;

    res.json({
      labels,
      total,
      previous_total,
      diff,
      percent
    });

  } catch (err) {
    console.error('Erro ao buscar chats novos:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats novos" });
  }
});

router.get("/chats/fechados", async (req, res) => {
  try {
    const { period = "weekly" } = req.query;

    // 📊 Labels para o período atual
    const { data: labels, error } = await supabase.rpc('get_chats_stats', {
      period,
      status_filter: 'Close'
    });
    if (error) throw error;

    // 🔢 Total atual
    const total = labels.reduce((acc, d) => acc + d.chats, 0);

    // 📊 Período anterior
    let previous_total = 0;

    if (period === "weekly") {
      // Semana anterior: -13 até -7
      const { data, error: prevError } = await supabase.from('chats')
        .select('id')
        .gte('ultima_atualizacao', new Date(new Date().setDate(new Date().getDate() - 13)).toISOString())
        .lte('ultima_atualizacao', new Date(new Date().setDate(new Date().getDate() - 7)).toISOString());

      if (prevError) throw prevError;
      previous_total = data.length;
    } else {
      // 6 meses anteriores: -11 até -6
      const { data, error: prevError } = await supabase.from('chats')
        .select('id')
        .gte('ultima_atualizacao', new Date(new Date().setMonth(new Date().getMonth() - 11)).toISOString())
        .lte('ultima_atualizacao', new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString());

      if (prevError) throw prevError;
      previous_total = data.length;
    }

    // 📈 Diferença e porcentagem
    const diff = total - previous_total;
    const percent = previous_total > 0 ? (diff / previous_total) * 100 : 100;

    res.json({
      labels,
      total,
      previous_total,
      diff,
      percent
    });

  } catch (err) {
    console.error('Erro ao buscar chats novos:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats novos" });
  }
});

// 📊 Chats por atendente (users)
router.get("/chats/atendentes", async (req, res) => {
  try {
    // Chama a função RPC 'get_chats_by_attendant'
    const { data, error } = await supabase.rpc('get_chats_by_attendant');

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
    // Chama a função RPC 'get_chats_by_connection'
    const { data, error } = await supabase.rpc('get_chats_by_connection');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar chats por conexões:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats por conexões" });
  }
});

module.exports = router;