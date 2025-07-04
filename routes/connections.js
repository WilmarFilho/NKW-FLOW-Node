// routes/connections.js
const express = require('express');
const axios = require('axios');
const router = express.Router();


router.get('/', (req, res) => {
    return res.json([
        {
            id: 5,
            nome: 'WhatsApp da Loja',
            agente: 'Recepcionista',
            numero: '5599999999999',
            status: true,
            instanceName: 'loja_123456789',
        },
    ]);
});


// Endpoint chamado pelo frontend para criar nova sessão
router.post('/create', async (req, res) => {
    const { session } = req.body;

    if (!session) {
        return res.status(400).json({ error: 'Nome da sessão é obrigatório.' });
    }

    try {
        // Altere a URL abaixo para a URL pública (ou interna se mesma rede) do seu N8N
        const n8nWebhookURL = `http://localhost:5678/webhook/create-session`;

        const response = await axios.post(n8nWebhookURL, { session });
        return res.status(200).json(response.data);
    } catch (error) {
        console.error('Erro ao criar sessão no N8N:', error.message);
        return res.status(500).json({ error: 'Erro ao criar sessão no N8N.' });
    }
});

module.exports = router;
