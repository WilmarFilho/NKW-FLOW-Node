const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar atendente
router.post('/', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
  email: email,
  password: password,
  user_metadata: { tipo: "admin" },
  email_confirm: true,
});


    res.status(201).json({ message: 'usuario criado com sucesso.', authUser });
  } catch (err) {
    console.error('Erro inesperado ao criar usuario:', authError);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

module.exports = router;