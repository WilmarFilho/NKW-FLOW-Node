require('dotenv').config();
// Utilitarios
const express = require('express');
const cors = require('cors');

// --- Início da Configuração de CORS ---

// 1. Crie uma "lista branca" com as origens que podem acessar sua API.
const allowedOrigins = [
  'https://app.nkwflow.com', // Seu frontend em produção
  'http://localhost:5173'    // Seu frontend em desenvolvimento local
];

// 2. Crie as opções de configuração do CORS.
const corsOptions = {
  origin: function (origin, callback) {
    // A 'origin' é a URL de quem está fazendo a requisição (ex: https://app.nkwflow.com).
    // Se a origem estiver na nossa lista branca (ou se a requisição não tiver origem, como no Postman), nós a permitimos.
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Não permitido pela política de CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  optionsSuccessStatus: 204
};

// --- Fim da Configuração de CORS ---


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

// Middleware de autenticação
const { authMiddleware } = require('./middleware/auth');

// Inicia Servidor Express
const app = express();

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));


// Middlewares do Express
// 3. Aplique as opções de CORS ao seu app.
app.use(cors(corsOptions));
// A linha abaixo é crucial para responder às requisições "pre-flight" que o navegador envia.
app.options('*', cors(corsOptions));
app.use(express.json());


// Rotas públicas
app.use('/login', loginRoutes);
app.use('/events', eventsRoutes);

// Rotas protegidas
app.use('/users', authMiddleware, usersRoutes);
app.use('/attendants', authMiddleware, attendantsRoutes);
app.use('/agents', authMiddleware, agentsRoutes);
app.use('/connections', authMiddleware, connectionsRoutes);
app.use('/chats', authMiddleware, chatsRoutes);
app.use('/messages', authMiddleware, messagesRoutes);
app.use('/chats_reads', authMiddleware, chats_readsRoutes);
app.use('/upload', authMiddleware, create_usersRoutes);
app.use('/metrics', authMiddleware, metricsRoutes);

// PORTA DO SERVER - Use a variável de ambiente ou um padrão.
const PORT = process.env.PORT || 3000;

// START
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});