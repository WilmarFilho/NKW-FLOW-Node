const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar agentes
router.get('/', async (req, res) => {
  return res.json([
    {
      id: 20,
      nome: 'Vendas',
      descricao: 'Para realizar atendimentos de vendedores',
      criado_em: '04/04/2025',
      ativo: true,
    },
  ]);
});

module.exports = router;
