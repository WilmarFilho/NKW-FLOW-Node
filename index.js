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
const messagesRoutes = require('./routes/messages')
const helpRoutes = require("./routes/help");
const { router: eventsRoutes } = require('./routes/events');

// Inicia Servidor Express
const app = express();

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
app.use('/events',eventsRoutes);
app.use("/api/help", helpRoutes);

//PORTA DO SERVER
const PORT = 5679;

// START
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Node.js escutando em http://0.0.0.0:${PORT}`);
});




















