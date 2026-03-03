const express = require('express');
const path = require('path');
const Pusher = require('pusher');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '2122978',
  key: process.env.PUSHER_APP_KEY || 'c4a9b50fe10859f2107a',
  secret: process.env.PUSHER_APP_SECRET || 'e1161ddeb0d86b88ba6f',
  cluster: process.env.PUSHER_CLUSTER || 'sa1',
  useTLS: true
});

const db = new Database('garconnexpress.db');

// Cria tabelas se não existirem
db.exec(`
  CREATE TABLE IF NOT EXISTS mesas (
    id INTEGER PRIMARY KEY,
    numero INTEGER,
    status TEXT DEFAULT 'livre'
  );

  CREATE TABLE IF NOT EXISTS menu (
    id INTEGER PRIMARY KEY,
    nome TEXT,
    categoria TEXT,
    preco REAL,
    imagem TEXT
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_id INTEGER,
    garcom_id TEXT,
    status TEXT DEFAULT 'recebido',
    total REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    mesa_numero INTEGER,
    FOREIGN KEY (mesa_id) REFERENCES mesas(id)
  );

  CREATE TABLE IF NOT EXISTS pedido_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER,
    menu_id INTEGER,
    quantidade INTEGER,
    observacao TEXT,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (menu_id) REFERENCES menu(id)
  );
`);

// Insere dados iniciais se não existirem
const countMesas = db.prepare('SELECT COUNT(*) as count FROM mesas').get().count;
if (countMesas === 0) {
  const insertMesa = db.prepare('INSERT INTO mesas (id, numero, status) VALUES (?, ?, ?)');
  [1, 2, 3, 4, 5].forEach(numero => {
    insertMesa.run(numero, numero, 'livre');
  });
}

const countMenu = db.prepare('SELECT COUNT(*) as count FROM menu').get().count;
if (countMenu === 0) {
  const insertMenu = db.prepare('INSERT INTO menu (id, nome, categoria, preco, imagem) VALUES (?, ?, ?, ?, ?)');
  insertMenu.run(1, 'Cerveja Heineken', 'bebidas', 8.5, 'https://placehold.co/100');
  insertMenu.run(2, 'Caipirinha de Limão', 'bebidas', 12, 'https://placehold.co/100');
  insertMenu.run(3, 'Hambúrguer Clássico', 'comidas', 15, 'https://placehold.co/100');
  insertMenu.run(4, 'Batata Frita', 'comidas', 7.5, 'https://placehold.co/100');
}

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
  const mesas = db.prepare('SELECT * FROM mesas').all();
  res.json(mesas);
});

app.get('/api/menu', (req, res) => {
  const menu = db.prepare('SELECT * FROM menu').all();
  res.json(menu);
});

app.get('/api/pedidos', (req, res) => {
  const pedidos = db.prepare('SELECT * FROM pedidos WHERE status != ?').all('entregue');
  res.json(pedidos);
});

app.post('/api/pedidos', (req, res) => {
  try {
    const { mesa_id, garcom_id, itens } = req.body;
    
    if (!mesa_id || !garcom_id || !itens || !Array.isArray(itens)) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    
    const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesa_id);
    
    const insertPedido = db.prepare('INSERT INTO pedidos (mesa_id, garcom_id, status, total, mesa_numero) VALUES (?, ?, ?, ?, ?)');
    const result = insertPedido.run(mesa_id, garcom_id, 'recebido', total, mesa.numero);
    const pedidoId = result.lastInsertRowid;
    
    const insertItem = db.prepare('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao) VALUES (?, ?, ?, ?)');
    itens.forEach(item => {
      insertItem.run(pedidoId, item.menu_id, item.quantidade, item.observacao || '');
    });
    
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
    pusher.trigger('pedidos', 'novo-pedido', pedido);
    
    res.json({ id: pedidoId, success: true });
  } catch (error) {
    console.error('Erro na API:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/pedidos/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!pedido) {
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }
  
  db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true });
});

app.get('/api/pedidos/:id/itens', (req, res) => {
  const { id } = req.params;
  const itens = db.prepare(`
    SELECT pi.*, m.nome, m.preco 
    FROM pedido_itens pi 
    JOIN menu m ON pi.menu_id = m.id 
    WHERE pi.pedido_id = ?
  `).all(id);
  res.json(itens);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
