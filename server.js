require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Conexão com Neon (PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Rotas para Frontend
app.get('/garcom', (req, res) => res.sendFile(__dirname + '/frontend/garcom/index.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/frontend/admin/index.html'));
app.get('/', (req, res) => res.sendFile(__dirname + '/frontend/garcom/index.html'));

// Rotas de Mesas
app.get('/api/mesas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mesas');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rotas de Menu
app.get('/api/menu', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM menu');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rotas de Pedidos
app.post('/api/pedidos', async (req, res) => {
  const { mesa_id, garcom_id, itens } = req.body;
  const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);

  try {
    const pedidoResult = await pool.query(
      'INSERT INTO pedidos (mesa_id, garcom_id, total) VALUES ($1, $2, $3) RETURNING id',
      [mesa_id, garcom_id, total]
    );
    const pedido_id = pedidoResult.rows[0].id;

    const itemQueries = itens.map(item => 
      pool.query(
        'INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao) VALUES ($1, $2, $3, $4)',
        [pedido_id, item.menu_id, item.quantidade, item.observacao]
      )
    );
    await Promise.all(itemQueries);

    await pool.query('UPDATE mesas SET status = $1 WHERE id = $2', ['ocupada', mesa_id]);

    io.emit('novo_pedido', { pedido_id, mesa_id, garcom_id, itens, total });
    res.json({ id: pedido_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pedidos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, m.numero as mesa_numero 
      FROM pedidos p 
      JOIN mesas m ON p.mesa_id = m.id 
      ORDER BY created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pedidos/:id/status', async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  try {
    await pool.query('UPDATE pedidos SET status = $1 WHERE id = $2', [status, id]);
    io.emit('atualizar_pedido', { id, status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pedidos/:id/itens', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT pi.*, m.nome, m.preco 
      FROM pedido_itens pi 
      JOIN menu m ON pi.menu_id = m.id 
      WHERE pi.pedido_id = $1
    `, [id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);
  socket.on('disconnect', () => console.log('Usuário desconectado:', socket.id));
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));