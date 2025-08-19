const express = require("express");
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 📊 Chats Novos por período (weekly ou monthly)
router.get("/chats/novos", async (req, res) => {
  try {
    const { period = "weekly" } = req.query;

    // Chama a função RPC 'get_chats_stats' sem filtro de status
    const { data, error } = await supabase.rpc('get_chats_stats', { period });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar chats novos:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats novos" });
  }
});

// 📊 Chats Fechados por período
router.get("/chats/fechados", async (req, res) => {
  try {
    const { period = "weekly" } = req.query;

    // Chama a função RPC 'get_chats_stats' com o filtro de status 'Close'
    const { data, error } = await supabase.rpc('get_chats_stats', {
      period,
      status_filter: 'Close'
    });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar chats fechados:', err.message);
    res.status(500).json({ error: "Erro ao buscar chats fechados" });
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