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
const chats_readsRoutes = require('./routes/chats_reads');
const uploadRoutes = require("./routes/upload");
const create_usersRoutes = require("./routes/create_users");
const { router: eventsRoutes } = require('./routes/events');
const metricsRoutes = require('./routes/metrics');
const loginRoutes = require('./routes/login');

// Inicia Servidor Express
const app = express();

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Middlewares do Express
app.use(cors());
app.use(express.json());

// Middleware das ROTAS REST
app.use('/users', usersRoutes);
app.use('/attendants', attendantsRoutes);
app.use('/agents', agentsRoutes);
app.use('/connections', connectionsRoutes);
app.use('/chats', chatsRoutes);
app.use('/messages',messagesRoutes);
app.use('/chats_reads', chats_readsRoutes);
app.use('/events',eventsRoutes);
app.use('/upload', uploadRoutes);
app.use('/createUser', create_usersRoutes);
app.use('/metrics', metricsRoutes);
app.use('/login', loginRoutes);

//PORTA DO SERVER
const PORT = 5679;

// START
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Node.js escutando em http://0.0.0.0:${PORT}`);
});