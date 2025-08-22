const router = require('express').Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// LISTA AGENTES APENAS PARA ADMINS
router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
    }

    // Verifica se o usuário é admin no banco
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tipo_de_usuario')
      .eq('id', user_id)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (userData.tipo_de_usuario !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem acessar agentes.' });
    }

    // Buscar agentes
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