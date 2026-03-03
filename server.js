const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ["polling", "websocket"],
  pingTimeout: 60000,
  allowEIO3: true
});

// Middleware
app.use(express.json());
app.use('/garcom', express.static(path.join(__dirname, 'frontend', 'garcom')));
app.use('/admin', express.static(path.join(__dirname, 'frontend', 'admin')));
app.get('/garcom/style.css', (req, res) => res.sendFile(__dirname + '/frontend/garcom/style.css'));
app.get('/garcom/app.js', (req, res) => res.sendFile(__dirname + '/frontend/garcom/app.js'));
app.get('/admin/style.css', (req, res) => res.sendFile(__dirname + '/frontend/admin/style.css'));
app.get('/admin/app.js', (req, res) => res.sendFile(__dirname + '/frontend/admin/app.js'));
app.get('/garcom', (req, res) => res.sendFile(__dirname + '/frontend/garcom/index.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/frontend/admin/index.html'));
app.get('/', (req, res) => res.sendFile(__dirname + '/frontend/garcom/index.html'));

// Rotas API
app.get('/api/mesas', (req, res) => {
  res.json([
    { id: 1, numero: 1, status: "livre" },
    { id: 2, numero: 2, status: "livre" },
    { id: 3, numero: 3, status: "livre" },
    { id: 4, numero: 4, status: "livre" },
    { id: 5, numero: 5, status: "livre" }
  ]);
});

app.get('/api/menu', (req, res) => {
  res.json([
    { id: 1, nome: "Cerveja Heineken", categoria: "bebidas", preco: 8.5, imagem: "https://placehold.co/100" },
    { id: 2, nome: "Caipirinha de Limão", categoria: "bebidas", preco: 12, imagem: "https://placehold.co/100" },
    { id: 3, nome: "Hambúrguer Clássico", categoria: "comidas", preco: 15, imagem: "https://placehold.co/100" },
    { id: 4, nome: "Batata Frita", categoria: "comidas", preco: 7.5, imagem: "https://placehold.co/100" }
  ]);
});

app.post('/api/pedidos', (req, res) => {
  const { mesa_id, garcom_id, itens } = req.body;
  const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
  
  const pedido = {
    id: Date.now(),
    mesa_id,
    garcom_id,
    status: "recebido",
    total,
    created_at: new Date(),
    mesa_numero: mesas.find(m => m.id === mesa_id)?.numero || mesa_id
  };
  
  pedidos.push(pedido);
  
  for (const item of itens) {
    pedido_itens.push({
      id: Date.now() + Math.random(),
      pedido_id: pedido.id,
      menu_id: item.menu_id,
      quantidade: item.quantidade,
      observacao: item.observacao
    });
  }
  
  io.emit('novo_pedido', {
    pedido_id: pedido.id,
    mesa_id: pedido.mesa_id,
    garcom_id: pedido.garcom_id,
    total: pedido.total,
    status: pedido.status,
    mesa_numero: pedido.mesa_numero
  });
  
  res.json({ id: pedido.id });
});

app.get('/api/pedidos', (req, res) => {
  const result = pedidos.map(p => ({
    id: p.id,
    mesa_id: p.mesa_id,
    garcom_id: p.garcom_id,
    status: p.status,
    total: p.total,
    created_at: p.created_at,
    mesa_numero: p.mesa_numero
  }));
  res.json(result);
});

app.put('/api/pedidos/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const pedido = pedidos.find(p => p.id == id);
  
  if (!pedido) {
    return res.status(404).json({ error: 'Pedido not found' });
  }
  
  pedido.status = status;
  io.emit('atualizar_pedido', { id, status });
  res.json({ success: true });
});

app.get('/api/pedidos/:id/itens', (req, res) => {
  const { id } = req.params;
  const itens = pedido_itens
    .filter(pi => pi.pedido_id == id)
    .map(pi => {
      const menuItem = menu.find(m => m.id === pi.menu_id);
      return {
        ...pi,
        nome: menuItem?.nome,
        preco: menuItem?.preco
      };
    });
  res.json(itens);
});

let mesas = [
  { id: 1, numero: 1, status: "livre" },
  { id: 2, numero: 2, status: "livre" },
  { id: 3, numero: 3, status: "livre" },
  { id: 4, numero: 4, status: "livre" },
  { id: 5, numero: 5, status: "livre" }
];

let menu = [
  { id: 1, nome: "Cerveja Heineken", categoria: "bebidas", preco: 8.5, imagem: "https://placehold.co/100" },
  { id: 2, nome: "Caipirinha de Limão", categoria: "bebidas", preco: 12, imagem: "https://placehold.co/100" },
  { id: 3, nome: "Hambúrguer Clássico", categoria: "comidas", preco: 15, imagem: "https://placehold.co/100" },
  { id: 4, nome: "Batata Frita", categoria: "comidas", preco: 7.5, imagem: "https://placehold.co/100" }
];

let pedidos = [];
let pedido_itens = [];

server.listen(process.env.PORT || 3001, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT || 3001}`);
});
