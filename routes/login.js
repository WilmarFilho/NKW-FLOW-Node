const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Função para padronizar erros
const sendError = (res, statusCode, message) => res.status(statusCode).json({ error: message });

// Login
router.post('/', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return sendError(res, 400, 'E-mail e senha são obrigatórios.');
    }

    // Autenticar no Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) return sendError(res, 401, error.message);

    // data.session contém o token JWT
    const token = data.session?.access_token;
    if (!token) return sendError(res, 500, 'Não foi possível gerar o token.');

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: data.user
    });

  } catch (err) {
    console.error('Erro inesperado no login:', err);
    return sendError(res, 500, 'Erro interno no servidor');
  }
});

module.exports = router;