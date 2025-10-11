require('dotenv').config();
// Utilitarios
const express = require('express');
const cors = require('cors');

// Import de Rotas
const usersRoutes = require('./routes/users');
const attendantsRoutes = require('./routes/attendants');
const agentsRoutes = require('./routes/agents');
const connectionsRoutes = require('./routes/connections');
const chatsRoutes = require('./routes/chats');
const messagesRoutes = require('./routes/messages');
const uploadRoutes = require("./routes/upload");
const create_usersRoutes = require("./routes/create_users"); // aqui está o webhook também
const { router: eventsRoutes } = require('./routes/events');
const metricsRoutes = require('./routes/metrics');
const loginRoutes = require('./routes/login');

// Middleware de autenticação
const { authMiddleware } = require('./middleware/auth');

// Inicia Servidor Express
const app = express();

// ⚠️ NÃO colocar express.json() global antes do webhook
app.use(cors());

// Rota do Webhook Stripe (usa raw, definido dentro do create_users.js)
app.use('/createUser', create_usersRoutes);

// Depois disso, o resto pode usar JSON normal
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));

// Rotas públicas
app.use('/login', loginRoutes);
app.use('/events', eventsRoutes);

// Rotas protegidas
app.use('/users', authMiddleware, usersRoutes);
app.use('/attendants', authMiddleware, attendantsRoutes);
app.use('/agents', authMiddleware, agentsRoutes);
app.use('/connections', connectionsRoutes); // já tem authMiddleware dentro
app.use('/chats', authMiddleware, chatsRoutes);
app.use('/messages', authMiddleware, messagesRoutes);
app.use('/upload', authMiddleware, uploadRoutes);
app.use('/metrics', authMiddleware, metricsRoutes);

// PORTA DO SERVER
const PORT = 3000;

// START
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});