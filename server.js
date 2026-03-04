const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const Pusher = require('pusher');
require('dotenv').config();

const app = express();

// Configuração do Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_APP_KEY,
  secret: process.env.PUSHER_APP_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Configuração do Banco de Dados (Híbrido: Postgres ou SQLite)
const isPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let db;

if (isPostgres) {
  console.log('Usando PostgreSQL (Produção/Vercel)');
  db = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  console.log('Usando SQLite (Desenvolvimento Local)');
  db = new Database('garconnexpress.db');
}

// Função auxiliar para queries universais
async function query(text, params) {
  if (isPostgres) {
    // Converter ? para $1, $2 no Postgres
    let i = 1;
    const pgText = text.replace(/\?/g, () => `$${i++}`);
    const res = await db.query(pgText, params);
    return { rows: res.rows, changes: res.rowCount, lastInsertRowid: res.rows[0]?.id };
  } else {
    const stmt = db.prepare(text);
    if (text.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: stmt.all(...(params || [])) };
    } else {
      const info = stmt.run(...(params || []));
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    }
  }
}

// Inicializar Banco de Dados
async function initDb() {
  const createTables = `
    CREATE TABLE IF NOT EXISTS mesas (
      id SERIAL PRIMARY KEY,
      numero INTEGER NOT NULL,
      status TEXT DEFAULT 'livre'
    );
    CREATE TABLE IF NOT EXISTS menu (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL,
      preco REAL NOT NULL,
      imagem TEXT
    );
    CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY,
      mesa_id INTEGER,
      garcom_id TEXT,
      status TEXT DEFAULT 'recebido',
      total REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pedido_itens (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER,
      menu_id INTEGER,
      quantidade INTEGER,
      observacao TEXT
    );
    CREATE TABLE IF NOT EXISTS garcons (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL DEFAULT '123'
    );
    CREATE TABLE IF NOT EXISTS usuarios_admin (
      id SERIAL PRIMARY KEY,
      usuario TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL
    );
  `;

  if (isPostgres) {
    await db.query(createTables.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY'));
  } else {
    // Para SQLite, usamos DATETIME e PRIMARY KEY AUTOINCREMENT
    db.exec(createTables
      .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    );
  }

  // Criar admin padrão se não existir
  const countAdmin = await query('SELECT COUNT(*) as count FROM usuarios_admin');
  if (parseInt(countAdmin.rows[0].count) === 0) {
    await query('INSERT INTO usuarios_admin (usuario, senha) VALUES (?, ?)', ['admin', 'Admin#2026']);
  }

  // Dados iniciais
  const countMesas = await query('SELECT COUNT(*) as count FROM mesas');
  if (parseInt(countMesas.rows[0].count) === 0) {
    for (let num of [1, 2, 3, 4, 5]) {
      await query('INSERT INTO mesas (numero, status) VALUES (?, ?)', [num, 'livre']);
    }
  }

  const countMenu = await query('SELECT COUNT(*) as count FROM menu');
  if (parseInt(countMenu.rows[0].count) === 0) {
    const initialMenu = [
      ["Cerveja Heineken", "bebidas", 8.5, "https://placehold.co/100"],
      ["Caipirinha de Limão", "bebidas", 12.0, "https://placehold.co/100"],
      ["Hambúrguer Clássico", "comidas", 15.0, "https://placehold.co/100"],
      ["Batata Frita", "comidas", 7.5, "https://placehold.co/100"]
    ];
    for (let item of initialMenu) {
      await query('INSERT INTO menu (nome, categoria, preco, imagem) VALUES (?, ?, ?, ?)', item);
    }
  }
}

initDb().catch(console.error);

app.use(express.json());
app.use('/garcom', express.static(path.join(__dirname, 'frontend', 'garcom')));
app.use('/admin', express.static(path.join(__dirname, 'frontend', 'admin')));

app.put('/api/pedidos/:id/solicitar-fechamento', async (req, res) => {
  const { id } = req.params;
  const { mesa_id } = req.body;
  try {
    await query("UPDATE pedidos SET status = 'aguardando_fechamento' WHERE id = ?", [id]);
    await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
    pusher.trigger('garconnexpress', 'status-atualizado', { mesa_id, pedido_id: id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao solicitar fechamento' });
  }
});

app.put('/api/mesas/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await query("UPDATE mesas SET status = ? WHERE id = ?", [status, id]);
    pusher.trigger('garconnexpress', 'status-atualizado', { mesa_id: parseInt(id), status });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar status da mesa' });
  }
});

app.put('/api/mesas/:id/liberar', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Finaliza qualquer pedido aberto nesta mesa (manda para o histórico)
    await query("UPDATE pedidos SET status = 'entregue' WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado')", [id]);
    
    // 2. Libera a mesa
    await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [id]);
    
    pusher.trigger('garconnexpress', 'status-atualizado', { mesa_id: parseInt(id) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao liberar mesa' });
  }
});

app.get('/api/pedidos/mesa/:mesaId', async (req, res) => {
  const { mesaId } = req.params;
  try {
    const result = await query(`
      SELECT * FROM pedidos 
      WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') 
      ORDER BY created_at DESC LIMIT 1
    `, [mesaId]);
    res.json(result.rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pedido da mesa' });
  }
});

// Adicionar itens a um pedido existente
app.put('/api/pedidos/:id/adicionar', async (req, res) => {
  const { id } = req.params;
  const { itens } = req.body;
  if (!itens) return res.status(400).json({ error: 'Itens não informados' });

  try {
    for (const item of itens) {
      // Verificar se o item já existe no pedido (mesmo produto E mesma observação)
      const itemExistente = await query(
        'SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND observacao = ?',
        [id, item.menu_id, item.observacao || '']
      );

      if (itemExistente.rows.length > 0) {
        // Se já existe, soma a quantidade
        const novaQtd = itemExistente.rows[0].quantidade + item.quantidade;
        await query('UPDATE pedido_itens SET quantidade = ? WHERE id = ?', [novaQtd, itemExistente.rows[0].id]);
      } else {
        // Se não existe, insere como novo item
        await query(
          'INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao) VALUES (?, ?, ?, ?)',
          [id, item.menu_id, item.quantidade, item.observacao || '']
        );
      }
    }

    // 2. Recalcular o total total do pedido
    const itensAtuais = await query(`
      SELECT pi.quantidade, m.preco 
      FROM pedido_itens pi
      JOIN menu m ON pi.menu_id = m.id
      WHERE pi.pedido_id = ?
    `, [id]);

    const novoTotal = itensAtuais.rows.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    await query('UPDATE pedidos SET total = ? WHERE id = ?', [novoTotal, id]);

    pusher.trigger('garconnexpress', 'status-atualizado', { pedido_id: parseInt(id) });
    res.json({ success: true, total: novoTotal });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao adicionar itens' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { usuario, senha } = req.body;
  try {
    const result = await query('SELECT id, usuario FROM usuarios_admin WHERE usuario = ? AND senha = ?', [usuario, senha]);
    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ error: 'Usuário ou senha de admin incorretos' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rota de Login para Garçons
app.post('/api/login', async (req, res) => {
  const { usuario, senha } = req.body;
  try {
    const result = await query('SELECT id, nome, usuario FROM garcons WHERE usuario = ? AND senha = ?', [usuario, senha]);
    if (result.rows.length > 0) {
      res.json({ success: true, garcom: result.rows[0] });
    } else {
      res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Gerenciamento de Garçons
app.get('/api/garcons', async (req, res) => {
  const result = await query('SELECT id, nome, usuario, senha FROM garcons ORDER BY nome');
  res.json(result.rows);
});

app.post('/api/garcons', async (req, res) => {
  const { nome, usuario, senha } = req.body;
  try {
    await query('INSERT INTO garcons (nome, usuario, senha) VALUES (?, ?, ?)', [nome, usuario, senha || '123']);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao cadastrar garçom' });
  }
});

app.delete('/api/garcons/:id', async (req, res) => {
  await query('DELETE FROM garcons WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Gerenciamento de Mesas (Adicionar/Remover)
app.post('/api/mesas', async (req, res) => {
  const { numero } = req.body;
  await query('INSERT INTO mesas (numero, status) VALUES (?, ?)', [numero, 'livre']);
  res.json({ success: true });
});

app.delete('/api/mesas/:id', async (req, res) => {
  await query('DELETE FROM mesas WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Gerenciamento de Menu (Adicionar/Editar/Excluir)
app.post('/api/menu', async (req, res) => {
  const { nome, categoria, preco, imagem } = req.body;
  await query('INSERT INTO menu (nome, categoria, preco, imagem) VALUES (?, ?, ?, ?)', [nome, categoria, preco, imagem]);
  res.json({ success: true });
});

app.put('/api/menu/:id', async (req, res) => {
  const { nome, categoria, preco, imagem } = req.body;
  await query('UPDATE menu SET nome = ?, categoria = ?, preco = ?, imagem = ? WHERE id = ?', [nome, categoria, preco, imagem, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/menu/:id', async (req, res) => {
  await query('DELETE FROM menu WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/mesas', async (req, res) => {
  const result = await query('SELECT * FROM mesas ORDER BY numero');
  res.json(result.rows);
});

app.get('/api/menu', async (req, res) => {
  const result = await query('SELECT * FROM menu');
  res.json(result.rows);
});

app.get('/api/pedidos', async (req, res) => {
  const result = await query(`
    SELECT p.*, m.numero as mesa_numero 
    FROM pedidos p 
    JOIN mesas m ON p.mesa_id = m.id 
    WHERE p.status NOT IN ('entregue', 'cancelado')
    ORDER BY p.created_at DESC
  `);
  res.json(result.rows);
});

app.get('/api/pedidos/historico', async (req, res) => {
  const result = await query(`
    SELECT p.*, m.numero as mesa_numero 
    FROM pedidos p 
    JOIN mesas m ON p.mesa_id = m.id 
    WHERE p.status IN ('entregue', 'cancelado')
    ORDER BY p.created_at DESC
    LIMIT 50
  `);
  res.json(result.rows);
});

app.delete('/api/pedidos/limpar', async (req, res) => {
  try {
    await query('DELETE FROM pedido_itens');
    await query('DELETE FROM pedidos');
    await query("UPDATE mesas SET status = 'livre'");
    pusher.trigger('garconnexpress', 'status-atualizado', {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao limpar histórico' });
  }
});

// Novo endpoint: Editar Pedido Completo
app.put('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  const { itens } = req.body;
  if (!itens) return res.status(400).json({ error: 'Itens não informados' });

  try {
    const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    
    // 1. Remover itens antigos
    await query('DELETE FROM pedido_itens WHERE pedido_id = ?', [id]);

    // 2. Inserir novos itens
    for (const item of itens) {
      await query(
        'INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao) VALUES (?, ?, ?, ?)',
        [id, item.menu_id, item.quantidade, item.observacao || '']
      );
    }

    // 3. Atualizar total do pedido
    await query('UPDATE pedidos SET total = ? WHERE id = ?', [total, id]);

    pusher.trigger('garconnexpress', 'status-atualizado', { pedido_id: parseInt(id) });
    res.json({ success: true, total });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao editar pedido' });
  }
});

app.post('/api/pedidos', async (req, res) => {
  const { mesa_id, garcom_id, itens } = req.body;
  if (!mesa_id || !itens) return res.status(400).json({ error: 'Dados inválidos' });

  try {
    const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    
    // Inserir pedido com data local correta
    const agora = new Date();
    const dataAtual = agora.getFullYear() + '-' + 
      String(agora.getMonth() + 1).padStart(2, '0') + '-' + 
      String(agora.getDate()).padStart(2, '0') + ' ' + 
      String(agora.getHours()).padStart(2, '0') + ':' + 
      String(agora.getMinutes()).padStart(2, '0') + ':' + 
      String(agora.getSeconds()).padStart(2, '0');

    const resPedido = await query(
      'INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at) VALUES (?, ?, ?, ?, ?)',
      [mesa_id, garcom_id, total, 'recebido', dataAtual]
    );
    const pedidoId = resPedido.lastInsertRowid || resPedido.rows[0].id;

    // Atualizar status da mesa para ocupada
    await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesa_id]);

    // Inserir itens (mesclando se houver repetição)
    for (const item of itens) {
      const itemExistente = await query(
        'SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND observacao = ?',
        [pedidoId, item.menu_id, item.observacao || '']
      );

      if (itemExistente.rows.length > 0) {
        const novaQtd = itemExistente.rows[0].quantidade + item.quantidade;
        await query('UPDATE pedido_itens SET quantidade = ? WHERE id = ?', [novaQtd, itemExistente.rows[0].id]);
      } else {
        await query(
          'INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao) VALUES (?, ?, ?, ?)',
          [pedidoId, item.menu_id, item.quantidade, item.observacao || '']
        );
      }
    }

    const mesa = (await query('SELECT numero FROM mesas WHERE id = ?', [mesa_id])).rows[0];

    const pedidoData = {
      id: pedidoId,
      mesa_id: parseInt(mesa_id),
      garcom_id,
      status: "recebido",
      total,
      mesa_numero: mesa ? mesa.numero : mesa_id
    };

    pusher.trigger('garconnexpress', 'novo-pedido', { pedido: pedidoData });
    res.json({ id: pedidoId, success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar pedido' });
  }
});

app.put('/api/pedidos/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    pusher.trigger('garconnexpress', 'status-atualizado', { pedido_id: parseInt(id), status });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

app.get('/api/pedidos/:id/itens', async (req, res) => {
  const result = await query(`
    SELECT pi.*, m.nome, m.preco 
    FROM pedido_itens pi
    JOIN menu m ON pi.menu_id = m.id
    WHERE pi.pedido_id = ?
  `, [req.params.id]);
  res.json(result.rows);
});

// Rotas de arquivos estáticos para a Vercel
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin', 'index.html')));
app.get('/garcom', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'garcom', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'garcom', 'index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

