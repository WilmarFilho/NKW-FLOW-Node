require('dotenv').config();

const express = require('express');
const cors = require('cors');
const atendentesRoutes = require('./routes/atendentes');
const agentesRoutes = require('./routes/agentes');
const connectionsRoutes = require('./routes/connections');
const helpRoutes = require("./routes/helpRoutes");

const app = express();
app.use(cors());
app.use(express.json());

const clients = {};

// Rota que o React escuta com EventSource
app.get('/webhook/events/:instance', (req, res) => {
  const { instance } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!clients[instance]) clients[instance] = [];
  clients[instance].push(res);

  console.log(`📡 Cliente conectado: ${instance}`);

  req.on('close', () => {
    clients[instance] = clients[instance].filter(c => c !== res);
    console.log(`❌ Cliente desconectado: ${instance}`);
  });
});

// Rota que o n8n chama para enviar eventos ao front
app.post('/dispatch', (req, res) => {
  const { instance, event, data } = req.body;

  if (clients[instance]) {
    for (const client of clients[instance]) {
      client.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
    }
    console.log(`📤 Evento enviado: ${event} → ${instance}`);
  }

  res.status(200).send('ok, enviado');
});


// ROTAS REST
app.use('/atendentes', atendentesRoutes);
app.use('/agentes', agentesRoutes);
app.use('/connections', connectionsRoutes);
app.use("/api/help", helpRoutes);



const PORT = 5679;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Node.js escutando em http://0.0.0.0:${PORT}`);
});