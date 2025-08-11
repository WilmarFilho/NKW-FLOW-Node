const router = require('express').Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Listar todos os agentes
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('agents').select('*');

    if (error) {
      console.error('Erro ao buscar agentes:', error);
      return res.status(500).json({ error: 'Erro ao buscar agentes.' });
    }

    res.json(data);
  } catch (err) {
    console.error('Erro inesperado ao listar agentes:', err);
    res.status(500).json({ error: 'Erro inesperado ao listar agentes.' });
  }
});

module.exports = router;