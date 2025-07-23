const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar agente
router.post('/', async (req, res) => {
  const { foto_perfil, nome, tipo_de_agente, descricao, prompt_do_agente } = req.body;
  const { data, error } = await supabase
    .from('agents')
    .insert([{ tipo_de_agente, descricao, prompt_do_agente }])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Listar todos os agentes
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('agents').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Buscar agente por id 
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('agentes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});


// Atualizar agente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { foto_perfil, nome, tipo_de_agente, descricao, prompt_do_agente } = req.body;
  const { data, error } = await supabase
    .from('agents')
    .update({ tipo_de_agente, prompt_do_agente })
    .eq('id', id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Deletar agente
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('agents').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).send('Deletado com sucesso');
});

module.exports = router;
