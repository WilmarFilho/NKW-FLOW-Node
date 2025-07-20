const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar atendentes
router.get('/', async (req, res) => {
  return res.json([
    {
      id: 20,
      nome: 'Roberto',
      email: 'roberto@gmail.com',
      criado_em: '04/04/2025',
      ativo: true,
    },
    {
      id: 20,
      nome: 'Roberto',
      email: 'roberto@gmail.com',
      criado_em: '04/04/2025',
      ativo: true,
    },
  ]);
});

// Criar atendente
router.post('/', async (req, res) => {
  const { nome, email } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO atendentes (nome, email) VALUES ($1, $2) RETURNING *',
      [nome, email]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar atendente' });
  }
});

// Remover atendente
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM atendentes WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir atendente' });
  }
});

module.exports = router;
