const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

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

app.get('/api/pedidos', (req, res) => {
  res.json([
    { id: Date.now(), mesa_id: 1, garcom_id: "garcom-1", status: "recebido", total: 8.5, created_at: new Date(), mesa_numero: 1 }
  ]);
});

app.post('/api/pedidos', (req, res) => {
  try {
    const { mesa_id, garcom_id, itens } = req.body;
    
    if (!mesa_id || !garcom_id || !itens || !Array.isArray(itens)) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    
    const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const pedido = {
      id: Date.now(),
      mesa_id: parseInt(mesa_id),
      garcom_id,
      status: "recebido",
      total,
      created_at: new Date()
    };
    
    res.json({ id: pedido.id, success: true });
  } catch (error) {
    console.error('Erro na API:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/pedidos/:id/status', (req, res) => {
  res.json({ success: true });
});

app.get('/api/pedidos/:id/itens', (req, res) => {
  res.json([]);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
