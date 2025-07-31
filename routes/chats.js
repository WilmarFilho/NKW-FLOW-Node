
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Criar chat
router.post('/', async (req, res) => {
  const { connection_id, contato_nome, contato_numero, ia_ativa } = req.body;
  const { data, error } = await supabase
    .from('chats')
    .insert([{ connection_id, contato_nome, contato_numero, ia_ativa }])
    .select();

  if (error) return res.status(500).send(error.message);
  res.status(201).json(data);
});

// Listar todos os chats com dados da conexão
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('chats')
    .select(`
      *,
      connection:connections(id, nome, numero)
    `);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});


// Buscar chats por contato_numero e connection_id
router.get('/buscar', async (req, res) => {
  const { contato_numero, connection_id } = req.body;

  const { data, error } = await supabase
    .from('chats')
    .select(`
      * ,
      connection:connections(id, nome, numero)
    `)
    .eq('contato_numero', contato_numero)
    .eq('connection_id', connection_id);

  if (error) return res.status(500).send(error.message);
  res.status(201).json({ data: data });
});


// Buscar chats por connection_id e contato_numero
router.get('/search/:connection_id/:contato_numero', async (req, res) => {
  const { connection_id, contato_numero } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('connection_id', connection_id)
    .eq('contato_numero', contato_numero)
    .order('ultima_atualizacao', { ascending: false });

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar chats por user_id
router.get('/connections/chats/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { agente_id } = req.query;

  try {
    // 1. Busca conexões do usuário (com ou sem filtro por agente)
    let query = supabase
      .from('connections')
      .select('id')
      .eq('user_id', user_id);

    if (agente_id) {
      query = query.eq('agente_id', agente_id);
    }

    const { data: conexoes, error: conexoesError } = await query;

    if (conexoesError) return res.status(500).send(conexoesError.message);
    if (!conexoes || conexoes.length === 0) return res.json([]);

    // 2. Executa chamada da função RPC para cada conexão
    const chamadas = conexoes.map(c =>
      supabase.rpc('chats_com_ultima_mensagem', { connection_id: c.id })
    );

    const resultados = await Promise.all(chamadas);

    // 3. Remove duplicatas por ID de chat
    const todosOsChats = resultados
      .flatMap(r => r.data ?? [])
      .reduce((acc, chat) => {
        if (!acc.some(c => c.id === chat.id)) {
          acc.push(chat);
        }
        return acc;
      }, []);

      
    res.json(todosOsChats);

  } catch (err) {
    console.error('Erro ao listar chats do usuário:', err.message);
    res.status(500).send('Erro interno');
  }
});




// Buscar chat por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select(`
      *,
      connection:connections(id, nome, numero)
    `)
    .eq('id', id)
    .single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Buscar chats por agente_id via conexão
router.get('/agente/:agente_id', async (req, res) => {
  const { agente_id } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select(`
      *,
      connection:connections!chats_connection_id_fkey(id, nome, agente_id)
    `)
    .filter('connection.agente_id', 'eq', agente_id);

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Atualizar chat
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { connection_id, contato_nome, contato_numero, ia_ativa } = req.body;

  const { data, error } = await supabase
    .from('chats')
    .update({ connection_id, contato_nome, contato_numero, ia_ativa })
    .eq('id', id)
    .select();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

// Deletar chat
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('chats').delete().eq('id', id);
  if (error) return res.status(500).send(error.message);
  res.status(200).send('Chat deletado com sucesso');
});

module.exports = router;
