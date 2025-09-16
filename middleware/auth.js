const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const authIdHeader = req.headers['x-auth-id'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido ou inválido.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token inválido.' });

    // Decodifica apenas o payload, sem verificar assinatura
    const payload = jwt.decode(token);
    const tokenAuthId = payload?.sub; // sub = auth_id do Supabase

    if (!tokenAuthId) return res.status(401).json({ error: 'Token inválido.' });
    if (authIdHeader && tokenAuthId !== authIdHeader) {
      return res.status(401).json({ error: 'Auth ID inválido.' });
    }

    // Busca o user real no Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('id')
      .eq('auth_id', tokenAuthId)
      .single();

    if (error || !user) return res.status(401).json({ error: 'Usuário não encontrado.' });

    // Anexa authId e userId no req para próximas rotas
    req.authId = tokenAuthId;
    req.userId = user.id;
    req.tokenPayload = payload;

    next();
  } catch (err) {
    console.error('Falha na autenticação:', err.message || err);
    return res.status(401).json({ error: 'Falha na autenticação.' });
  }
};

module.exports = { authMiddleware };