const express = require('express');
const path = require('path');
const Pusher = require('pusher');
require('dotenv').config();

const app = express();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '2122978',
  key: process.env.PUSHER_APP_KEY || 'c4a9b50fe10859f2107a',
  secret: process.env.PUSHER_APP_SECRET || 'e1161ddeb0d86b88ba6f',
  cluster: process.env.PUSHER_CLUSTER || 'sa1',
  useTLS: true
});

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
let pedidoItens = [];

app.get('/api/mesas', (req, res) => {
  res.json(mesas);
});

app.get('/api/menu', (req, res) => {
  res.json(menu);
});

app.get('/api/pedidos', (req, res) => {
  res.json(pedidos);
});

app.post('/api/pedidos', (req, res) => {
  try {
    const { mesa_id, garcom_id, itens } = req.body;
    
    if (!mesa_id || !garcom_id || !itens || !Array.isArray(itens)) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    
    const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const mesa = mesas.find(m => m.id == mesa_id);
    
    const pedido = {
      id: Date.now(),
      mesa_id: parseInt(mesa_id),
      garcom_id,
      status: "recebido",
      total,
      created_at: new Date(),
      mesa_numero: mesa ? mesa.numero : mesa_id
    };
    
    pedidos.push(pedido);
    
    itens.forEach(item => {
      pedidoItens.push({
        id: Date.now() + Math.random(),
        pedido_id: pedido.id,
        menu_id: item.menu_id,
        quantidade: item.quantidade,
        observacao: item.observacao || ''
      });
    });
    
    pusher.trigger('pedidos', 'novo-pedido', pedido);
    
    res.json({ id: pedido.id, success: true });
  } catch (error) {
    console.error('Erro na API:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/pedidos/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const pedido = pedidos.find(p => p.id == parseInt(id));
  if (!pedido) {
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }
  
  pedido.status = status;
  res.json({ success: true });
});

app.get('/api/pedidos/:id/itens', (req, res) => {
  const { id } = req.params;
  const itens = pedidoItens
    .filter(pi => pi.pedido_id == parseInt(id))
    .map(pi => {
      const menuItem = menu.find(m => m.id === pi.menu_id);
      return {
        ...pi,
        nome: menuItem ? menuItem.nome : 'Item não encontrado',
        preco: menuItem ? menuItem.preco : 0
      };
    });
  res.json(itens);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
