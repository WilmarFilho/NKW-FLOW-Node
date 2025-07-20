const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar agente
router.post('/', async (req, res) => {
  const { tipo_de_agente, prompt_do_agente } = req.body;
  const { data, error } = await supabase
    .from('agentes')
    .insert([{ tipo_de_agente, prompt_do_agente }])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Listar todos os agentes
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('agentes').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Atualizar agente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { tipo_de_agente, prompt_do_agente } = req.body;
  const { data, error } = await supabase
    .from('agentes')
    .update({ tipo_de_agente, prompt_do_agente })
    .eq('id', id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Deletar agente
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('agentes').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).send('Deletado com sucesso');
});

module.exports = router;
