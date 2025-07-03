const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar agentes
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM atendentes');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar atendentes' });
  }
});

module.exports = router;
