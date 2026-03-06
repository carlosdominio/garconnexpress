const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const Pusher = require('pusher');
require('dotenv').config();

const app = express();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_APP_KEY,
  secret: process.env.PUSHER_APP_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

const isPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let db;

if (isPostgres) {
  db = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });
} else {
  db = new Database('garconnexpress.db');
}

async function query(text, params) {
  try {
    if (isPostgres) {
      let i = 1;
      const pgText = text.replace(/\?/g, () => `$${i++}`);
      const res = await db.query(pgText, params);
      return { rows: res.rows || [], changes: res.rowCount, lastInsertRowid: res.rows && res.rows[0] ? res.rows[0].id : null };
    } else {
      const stmt = db.prepare(text);
      if (text.trim().toUpperCase().startsWith('SELECT') || text.trim().toUpperCase().includes('RETURNING')) {
        return { rows: stmt.all(...(params || [])) };
      } else {
        const info = stmt.run(...(params || []));
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
      }
    }
  } catch (err) {
    console.error('DATABASE ERROR:', err.message);
    throw err;
  }
}

async function initDb() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS mesas (id SERIAL PRIMARY KEY, numero INTEGER NOT NULL, status TEXT DEFAULT 'livre')`,
    `CREATE TABLE IF NOT EXISTS menu (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, imagem TEXT)`,
    `CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, mesa_id INTEGER, garcom_id TEXT, status TEXT DEFAULT 'recebido', total REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY, pedido_id INTEGER, menu_id INTEGER, quantidade INTEGER, observacao TEXT, status TEXT DEFAULT 'pendente')`,
    `CREATE TABLE IF NOT EXISTS garcons (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123')`,
    `CREATE TABLE IF NOT EXISTS usuarios_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)`
  ];
  for (let tableSql of tables) {
    if (isPostgres) await db.query(tableSql);
    else db.exec(tableSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
  }
}

initDb().catch(console.error);

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://js.pusher.com; " +
    "connect-src 'self' https://*.pusher.com wss://*.pusher.com https://vercel.live; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com https://vercel.live; " +
    "img-src 'self' data: https://*; " +
    "media-src 'self' https://assets.mixkit.co; " +
    "frame-src 'self' https://vercel.live;"
  );
  next();
});

app.use(express.json());
app.use('/garcom', express.static(path.join(__dirname, 'frontend', 'garcom')));
app.use('/admin', express.static(path.join(__dirname, 'frontend', 'admin')));

app.get('/', (req, res) => {
  res.redirect('/garcom');
});

// Helper para disparar status-atualizado com NÚMERO DA MESA garantido em mesa_numero e mesa_id
async function notifyStatus(pedidoId, mesaDbId, status) {
  try {
    let mesaNum = 'X';
    if (mesaDbId) {
      const res = await query("SELECT numero FROM mesas WHERE id = ?", [mesaDbId]);
      mesaNum = res.rows[0] ? res.rows[0].numero : 'X';
    } else if (pedidoId) {
      const res = await query("SELECT m.numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [pedidoId]);
      mesaNum = res.rows[0] ? res.rows[0].numero : 'X';
    }
    
    const payload = { 
      pedido_id: pedidoId, 
      mesa_id: mesaNum, 
      mesa_numero: mesaNum, 
      status: status 
    };
    
    console.log('--- ENVIANDO PUSHER ---', payload);
    await pusher.trigger('garconnexpress', 'status-atualizado', payload);
  } catch (e) {
    console.error('Erro ao notificar:', e);
  }
}

app.put('/api/pedidos/:id/solicitar-fechamento', async (req, res) => {
  const { id } = req.params;
  const { mesa_id } = req.body;
  try {
    await query("UPDATE pedidos SET status = 'aguardando_fechamento' WHERE id = ?", [id]);
    await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
    await notifyStatus(id, mesa_id, 'aguardando_fechamento');
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/mesas/:id/liberar', async (req, res) => {
  const { id } = req.params;
  try {
    await query("UPDATE pedidos SET status = 'entregue' WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado')", [id]);
    await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [id]);
    await notifyStatus(null, id, 'liberada');
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/pedidos/:id/adicionar', async (req, res) => {
  const { id } = req.params;
  const { itens } = req.body;
  try {
    // Voltamos o status para 'recebido' e atualizamos o horário para o cronômetro reiniciar no app do garçom
    await query("UPDATE pedidos SET status = 'recebido', created_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    
    for (const item of itens) {
      const exist = await query('SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND observacao = ? AND status = ?', [id, item.menu_id, item.observacao || '', 'pendente']);
      if (exist.rows.length > 0) await query('UPDATE pedido_itens SET quantidade = ? WHERE id = ?', [exist.rows[0].quantidade + item.quantidade, exist.rows[0].id]);
      else await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [id, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
    }
    await notifyStatus(id, null, 'itens_adicionados');
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/pedidos/:id/marcar-entregue', async (req, res) => {
  const { id } = req.params;
  try {
    await query("UPDATE pedido_itens SET status = 'entregue' WHERE pedido_id = ? AND status = 'pendente'", [id]);
    await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [id]);
    await notifyStatus(id, null, 'servido');
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  const { itens } = req.body;
  try {
    await query('DELETE FROM pedido_itens WHERE pedido_id = ?', [id]);
    for (const item of itens) await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [id, item.menu_id, item.quantidade, item.observacao || '', item.status || 'pendente']);
    await notifyStatus(id, null, 'itens_atualizados');
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/pedidos', async (req, res) => {
  const { mesa_id, garcom_id, itens } = req.body;
  try {
    const total = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id', [mesa_id, garcom_id, total, 'recebido', new Date().toISOString()]);
    const pedidoId = resPedido.lastInsertRowid || (resPedido.rows && resPedido.rows[0] ? resPedido.rows[0].id : null);
    await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesa_id]);
    for (const item of itens) await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [pedidoId, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
    const mesa = (await query("SELECT numero FROM mesas WHERE id = ?", [mesa_id])).rows[0];
    const payload = { pedido: { id: pedidoId, mesa_id: mesa ? mesa.numero : mesa_id, mesa_numero: mesa ? mesa.numero : mesa_id, status: "recebido", total } };
    console.log('--- ENVIANDO PUSHER (NOVO) ---', payload);
    await pusher.trigger('garconnexpress', 'novo-pedido', payload);
    res.json({ id: pedidoId, success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/pedidos/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    const pedido = (await query("SELECT mesa_id FROM pedidos WHERE id = ?", [id])).rows[0];
    if (status === 'cancelado' && pedido) await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
    await notifyStatus(id, null, status);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/garcons', async (req, res) => { res.json((await query('SELECT id, nome, usuario FROM garcons ORDER BY nome')).rows); });
app.post('/api/garcons', async (req, res) => {
  const { nome, usuario, senha } = req.body;
  await query('INSERT INTO garcons (nome, usuario, senha) VALUES (?, ?, ?)', [nome, usuario, senha]);
  res.json({ success: true });
});
app.delete('/api/garcons/:id', async (req, res) => {
  await query('DELETE FROM garcons WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.post('/api/mesas', async (req, res) => {
  await query('INSERT INTO mesas (numero) VALUES (?)', [req.body.numero]);
  res.json({ success: true });
});
app.delete('/api/mesas/:id', async (req, res) => {
  await query('DELETE FROM mesas WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

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

app.get('/api/pedidos/mesa/:mesaId', async (req, res) => { res.json((await query(`SELECT * FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY created_at DESC LIMIT 1`, [req.params.mesaId])).rows[0] || null); });
app.get('/api/mesas', async (req, res) => { 
  const querySql = `
    SELECT m.*, p.created_at as pedido_created_at 
    FROM mesas m 
    LEFT JOIN pedidos p ON m.id = p.mesa_id AND p.status = 'recebido'
    ORDER BY m.numero
  `;
  res.json((await query(querySql)).rows); 
});
app.get('/api/menu', async (req, res) => { res.json((await query('SELECT * FROM menu')).rows); });
app.get('/api/pedidos', async (req, res) => { res.json((await query(`SELECT p.*, m.numero as mesa_numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.status NOT IN ('entregue', 'cancelado') ORDER BY p.created_at DESC`)).rows); });
app.get('/api/pedidos/historico', async (req, res) => { res.json((await query(`SELECT p.*, m.numero as mesa_numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.status IN ('entregue', 'cancelado') ORDER BY p.created_at DESC LIMIT 50`)).rows); });
app.get('/api/pedidos/:id/itens', async (req, res) => { res.json((await query(`SELECT pi.*, m.nome, m.preco FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ? ORDER BY pi.status DESC, pi.id ASC`, [req.params.id])).rows); });
app.post('/api/login', async (req, res) => {
  const result = await query('SELECT id, nome FROM garcons WHERE usuario = ? AND senha = ?', [req.body.usuario, req.body.senha]);
  if (result.rows.length > 0) res.json({ success: true, garcom: result.rows[0] });
  else res.status(401).json({ error: 'Erro' });
});

app.post('/api/admin/login', async (req, res) => {
  const { usuario, senha } = req.body;
  try {
    const result = await query('SELECT id, usuario FROM usuarios_admin WHERE usuario = ? AND senha = ?', [usuario, senha]);
    if (result.rows.length > 0) {
      res.json({ success: true, admin: result.rows[0] });
    } else {
      res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
