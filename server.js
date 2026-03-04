const express = require('express');
const path = require('path');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();

const cache = new NodeCache({ stdTTL: 0, checkperiod: 0 });

const initialMesas = [
  { id: 1, numero: 1, status: "livre" },
  { id: 2, numero: 2, status: "livre" },
  { id: 3, numero: 3, status: "livre" },
  { id: 4, numero: 4, status: "livre" },
  { id: 5, numero: 5, status: "livre" }
];

const initialMenu = [
  { id: 1, nome: "Cerveja Heineken", categoria: "bebidas", preco: 8.5, imagem: "https://placehold.co/100" },
  { id: 2, nome: "Caipirinha de Limão", categoria: "bebidas", preco: 12, imagem: "https://placehold.co/100" },
  { id: 3, nome: "Hambúrguer Clássico", categoria: "comidas", preco: 15, imagem: "https://placehold.co/100" },
  { id: 4, nome: "Batata Frita", categoria: "comidas", preco: 7.5, imagem: "https://placehold.co/100" }
];

if (!cache.get('mesas')) cache.set('mesas', initialMesas);
if (!cache.get('menu')) cache.set('menu', initialMenu);
if (!cache.get('pedidos')) cache.set('pedidos', []);
if (!cache.get('pedidoItens')) cache.set('pedidoItens', []);

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

app.get('/api/mesas', (req, res) => {
  const mesas = cache.get('mesas');
  res.json(mesas);
});

app.get('/api/menu', (req, res) => {
  const menu = cache.get('menu');
  res.json(menu);
});

app.get('/api/pedidos', (req, res) => {
  const pedidos = cache.get('pedidos');
  res.json(pedidos.filter(p => p.status !== 'entregue'));
});

app.post('/api/pedidos', (req, res) => {
  try {
    const { mesa_id, garcom_id, itens } = req.body;
    
    if (!mesa_id || !garcom_id || !itens || !Array.isArray(itens)) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    
    const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const mesas = cache.get('mesas');
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
    
    const pedidos = cache.get('pedidos');
    pedidos.push(pedido);
    cache.set('pedidos', pedidos);
    
    const pedidoItens = cache.get('pedidoItens');
    itens.forEach(item => {
      pedidoItens.push({
        id: Date.now() + Math.random(),
        pedido_id: pedido.id,
        menu_id: item.menu_id,
        quantidade: item.quantidade,
        observacao: item.observacao || ''
      });
    });
    cache.set('pedidoItens', pedidoItens);
    
    res.json({ id: pedido.id, success: true });
  } catch (error) {
    console.error('Erro na API:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/pedidos/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const pedidos = cache.get('pedidos');
  const pedido = pedidos.find(p => p.id == parseInt(id));
  if (!pedido) {
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }
  
  pedido.status = status;
  cache.set('pedidos', pedidos);
  res.json({ success: true });
});

app.get('/api/pedidos/:id/itens', (req, res) => {
  const { id } = req.params;
  const pedidoItens = cache.get('pedidoItens');
  const menu = cache.get('menu');
  
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
