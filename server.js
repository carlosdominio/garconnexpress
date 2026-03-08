const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const Pusher = require('pusher');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();

const saltRounds = 10;

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
    `CREATE TABLE IF NOT EXISTS menu (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, imagem TEXT, estoque INTEGER DEFAULT -1)`,
    `CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, mesa_id INTEGER, garcom_id TEXT, status TEXT DEFAULT 'recebido', total REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, forma_pagamento TEXT, desconto REAL DEFAULT 0, acrescimo REAL DEFAULT 0, valor_recebido REAL, troco REAL)`,
    `CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY, pedido_id INTEGER, menu_id INTEGER, quantidade INTEGER, observacao TEXT, status TEXT DEFAULT 'pendente')`,
    `CREATE TABLE IF NOT EXISTS garcons (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123', telefone TEXT)`,
    `CREATE TABLE IF NOT EXISTS usuarios_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS fluxo_caixa (id SERIAL PRIMARY KEY, data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP, data_fechamento TIMESTAMP, valor_inicial REAL NOT NULL, valor_final REAL, status TEXT DEFAULT 'aberto', total_dinheiro REAL DEFAULT 0, total_pix REAL DEFAULT 0, total_cartao REAL DEFAULT 0, total_vendas REAL DEFAULT 0)`
  ];
  for (let tableSql of tables) {
    if (isPostgres) await db.query(tableSql);
    else db.exec(tableSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
  }

  // Migração para bancos existentes
  try {
    if (isPostgres) {
      // Migração Postgres (Ignora erro se coluna já existir)
      const addCol = async (table, col, type) => {
        try { await db.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (e) {}
      };
      await addCol('pedidos', 'forma_pagamento', 'TEXT');
      await addCol('pedidos', 'desconto', 'REAL DEFAULT 0');
      await addCol('pedidos', 'acrescimo', 'REAL DEFAULT 0');
      await addCol('pedidos', 'valor_recebido', 'REAL');
      await addCol('pedidos', 'troco', 'REAL');
      await addCol('menu', 'estoque', 'INTEGER DEFAULT -1');
    } else {
      // Migração SQLite
      const tableInfo = db.prepare("PRAGMA table_info(pedidos)").all();
      const columns = tableInfo.map(c => c.name);
      if (!columns.includes('forma_pagamento')) db.exec("ALTER TABLE pedidos ADD COLUMN forma_pagamento TEXT");
      if (!columns.includes('desconto')) db.exec("ALTER TABLE pedidos ADD COLUMN desconto REAL DEFAULT 0");
      if (!columns.includes('acrescimo')) db.exec("ALTER TABLE pedidos ADD COLUMN acrescimo REAL DEFAULT 0");
      if (!columns.includes('valor_recebido')) db.exec("ALTER TABLE pedidos ADD COLUMN valor_recebido REAL");
      if (!columns.includes('troco')) db.exec("ALTER TABLE pedidos ADD COLUMN troco REAL");

      const menuInfo = db.prepare("PRAGMA table_info(menu)").all();
      const menuCols = menuInfo.map(c => c.name);
      if (!menuCols.includes('estoque')) db.exec("ALTER TABLE menu ADD COLUMN estoque INTEGER DEFAULT -1");

      const garcomInfo = db.prepare("PRAGMA table_info(garcons)").all();
      if (!garcomInfo.map(c => c.name).includes('telefone')) db.exec("ALTER TABLE garcons ADD COLUMN telefone TEXT");
    }
  } catch (e) {
    console.log('Migração concluída ou não necessária.');
  }

  // Garante que o usuário 'admin' tenha a senha solicitada pelo usuário
  const hashedPass = await bcrypt.hash('Admin#2026', saltRounds);
  const adminExists = await query('SELECT id FROM usuarios_admin WHERE usuario = ?', ['admin']);
  
  if (adminExists.rows.length === 0) {
    await query('INSERT INTO usuarios_admin (usuario, senha) VALUES (?, ?)', ['admin', hashedPass]);
    console.log('--- USUÁRIO ADMIN CRIADO (admin / Admin#2026) ---');
  } else {
    await query('UPDATE usuarios_admin SET senha = ? WHERE usuario = ?', [hashedPass, 'admin']);
    console.log('--- SENHA DO ADMIN ATUALIZADA PARA (Admin#2026) ---');
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
  const { mesa_id, forma_pagamento, desconto, acrescimo, valor_recebido, troco, total } = req.body;
  try {
    // Se o total não for enviado (solicitação simples do garçom), mantemos o total atual do banco
    if (total === undefined) {
      await query(`
        UPDATE pedidos 
        SET status = 'aguardando_fechamento'
        WHERE id = ?`, 
        [id]
      );
    } else {
      await query(`
        UPDATE pedidos 
        SET status = 'aguardando_fechamento', 
            forma_pagamento = ?, 
            desconto = ?, 
            acrescimo = ?, 
            valor_recebido = ?, 
            troco = ?,
            total = ?
        WHERE id = ?`, 
        [forma_pagamento, desconto || 0, acrescimo || 0, valor_recebido || 0, troco || 0, total, id]
      );
    }
    await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
    await notifyStatus(id, mesa_id, 'aguardando_fechamento');
    res.json({ success: true });
  } catch (error) { 
    console.error('ERRO NO FECHAMENTO:', error);
    res.status(500).json({ error: 'Erro interno no servidor' }); 
  }
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
    // 1. Verifica estoque antes de qualquer alteração
    for (const item of itens) {
      const p = (await query("SELECT nome, estoque FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (p && p.estoque !== -1 && p.estoque < item.quantidade) {
        return res.status(400).json({ error: `Estoque insuficiente: ${p.nome} (Restam ${p.estoque})` });
      }
    }

    const pedidoAtual = (await query("SELECT status FROM pedidos WHERE id = ?", [id])).rows[0];
    if (pedidoAtual && pedidoAtual.status !== 'recebido') {
      await query("UPDATE pedidos SET status = 'recebido', created_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    } else {
      await query("UPDATE pedidos SET status = 'recebido' WHERE id = ?", [id]);
    }
    
    for (const item of itens) {
      const exist = await query('SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND observacao = ? AND status = ?', [id, item.menu_id, item.observacao || '', 'pendente']);
      if (exist.rows.length > 0) await query('UPDATE pedido_itens SET quantidade = ? WHERE id = ?', [exist.rows[0].quantidade + item.quantidade, exist.rows[0].id]);
      else await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [id, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
      
      // Baixa no estoque
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    }
    
    await notifyStatus(id, null, 'itens_adicionados');
    // Notifica que o menu (estoque) mudou
    await pusher.trigger('garconnexpress', 'menu-atualizado', {});
    
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
    // 1. Valida se há estoque suficiente para a NOVA configuração do pedido
    // (Simulando o estoque final para validação)
    for (const itemNovo of itens) {
      const p = (await query("SELECT nome, estoque FROM menu WHERE id = ?", [itemNovo.menu_id])).rows[0];
      const itemAntigo = (await query("SELECT quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ?", [id, itemNovo.menu_id])).rows[0];
      const qtdAntiga = itemAntigo ? itemAntigo.quantidade : 0;
      const estoqueSimulado = p.estoque === -1 ? -1 : p.estoque + qtdAntiga;

      if (estoqueSimulado !== -1 && itemNovo.quantidade > estoqueSimulado) {
        return res.status(400).json({ error: `Estoque insuficiente: ${p.nome} (Máximo possível: ${estoqueSimulado})` });
      }
    }

    // 2. Devolve o estoque de todos os itens atuais antes de deletar
    const itensAtuais = (await query("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    for (const item of itensAtuais) {
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    }

    // 3. Deleta e insere os novos itens
    const temPendente = itens.some(i => i.status === 'pendente');
    const statusAntigo = (await query("SELECT status FROM pedidos WHERE id = ?", [id])).rows[0];

    await query('DELETE FROM pedido_itens WHERE pedido_id = ?', [id]);
    for (const item of itens) {
      await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [id, item.menu_id, item.quantidade, item.observacao || '', item.status || 'pendente']);
      // 4. Subtrai o novo estoque
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    }
    
    if (temPendente && statusAntigo && statusAntigo.status !== 'recebido') {
      await query("UPDATE pedidos SET status = 'recebido', created_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    } else if (!temPendente) {
      await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [id]);
    }

    await notifyStatus(id, null, 'itens_atualizados');
    await pusher.trigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/pedidos', async (req, res) => {
  const { mesa_id, garcom_id, itens } = req.body;
  try {
    // 1. Verifica estoque antes de criar o pedido
    for (const item of itens) {
      const p = (await query("SELECT nome, estoque FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (p && p.estoque !== -1 && p.estoque < item.quantidade) {
        return res.status(400).json({ error: `Estoque insuficiente: ${p.nome} (Restam ${p.estoque})` });
      }
    }

    const subtotal = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const total = subtotal * 1.10; // Adiciona 10% de taxa de serviço
    const resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id', [mesa_id, garcom_id, total, 'recebido', new Date().toISOString()]);
    const pedidoId = resPedido.lastInsertRowid || (resPedido.rows && resPedido.rows[0] ? resPedido.rows[0].id : null);
    await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesa_id]);
    
    for (const item of itens) {
      await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [pedidoId, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
      // Baixa no estoque (se não for -1)
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    }

    const mesa = (await query("SELECT numero FROM mesas WHERE id = ?", [mesa_id])).rows[0];
    const payload = { pedido: { id: pedidoId, mesa_id: mesa ? mesa.numero : mesa_id, mesa_numero: mesa ? mesa.numero : mesa_id, status: "recebido", total } };
    console.log('--- ENVIANDO PUSHER (NOVO) ---', payload);
    await pusher.trigger('garconnexpress', 'novo-pedido', payload);
    // Notifica que o menu (estoque) mudou
    await pusher.trigger('garconnexpress', 'menu-atualizado', {});
    
    res.json({ id: pedidoId, success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/pedidos/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    // Se estiver finalizando o pedido (entregue/pago), atualiza o caixa
    if (status === 'entregue') {
      const caixaAberto = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
      if (!caixaAberto) return res.status(400).json({ error: 'Não é possível receber: O CAIXA ESTÁ FECHADO!' });

      const pedido = (await query("SELECT total, forma_pagamento FROM pedidos WHERE id = ?", [id])).rows[0];
      if (pedido) {
        let coluna = 'total_cartao';
        if (pedido.forma_pagamento === 'Dinheiro') coluna = 'total_dinheiro';
        else if (pedido.forma_pagamento === 'Pix') coluna = 'total_pix';
        
        await query(`UPDATE fluxo_caixa SET ${coluna} = ${coluna} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [pedido.total, pedido.total, caixaAberto.id]);
      }
    }

    await query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    const pedidoMesa = (await query("SELECT mesa_id FROM pedidos WHERE id = ?", [id])).rows[0];
    if ((status === 'cancelado' || status === 'entregue') && pedidoMesa) {
       await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedidoMesa.mesa_id]);
    }
    await notifyStatus(id, null, status);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/garcons', async (req, res) => { res.json((await query('SELECT id, nome, usuario, telefone FROM garcons ORDER BY nome')).rows); });
app.post('/api/garcons', async (req, res) => {
  const { nome, usuario, senha, telefone } = req.body;
  const hashedSenha = await bcrypt.hash(senha || '123', saltRounds);
  await query('INSERT INTO garcons (nome, usuario, senha, telefone) VALUES (?, ?, ?, ?)', [nome, usuario, hashedSenha, telefone]);
  res.json({ success: true });
});
app.put('/api/garcons/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, usuario, senha, telefone } = req.body;
  try {
    if (senha && senha.trim() !== "") {
      const hashedSenha = await bcrypt.hash(senha, saltRounds);
      await query('UPDATE garcons SET nome = ?, usuario = ?, senha = ?, telefone = ? WHERE id = ?', [nome, usuario, hashedSenha, telefone, id]);
    } else {
      await query('UPDATE garcons SET nome = ?, usuario = ?, telefone = ? WHERE id = ?', [nome, usuario, telefone, id]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar garçom' });
  }
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
  const { nome, categoria, preco, imagem, estoque } = req.body;
  await query('INSERT INTO menu (nome, categoria, preco, imagem, estoque) VALUES (?, ?, ?, ?, ?)', [nome, categoria, preco, imagem, estoque || -1]);
  res.json({ success: true });
});
app.put('/api/menu/:id', async (req, res) => {
  const { nome, categoria, preco, imagem, estoque } = req.body;
  await query('UPDATE menu SET nome = ?, categoria = ?, preco = ?, imagem = ?, estoque = ? WHERE id = ?', [nome, categoria, preco, imagem, estoque, req.params.id]);
  res.json({ success: true });
});
app.delete('/api/menu/:id', async (req, res) => {
  await query('DELETE FROM menu WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/pedidos/mesa/:mesaId', async (req, res) => { res.json((await query(`SELECT * FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY created_at DESC LIMIT 1`, [req.params.mesaId])).rows[0] || null); });
app.get('/api/mesas', async (req, res) => { 
  const querySql = `
    SELECT m.*, 
           (CASE WHEN p.status = 'recebido' THEN p.created_at ELSE NULL END) as pedido_created_at, 
           p.garcom_id 
    FROM mesas m 
    LEFT JOIN pedidos p ON m.id = p.mesa_id AND p.status NOT IN ('entregue', 'cancelado')
    ORDER BY m.numero
  `;
  res.json((await query(querySql)).rows); 
});
app.get('/api/menu', async (req, res) => { res.json((await query('SELECT * FROM menu')).rows); });
app.get('/api/pedidos', async (req, res) => { res.json((await query(`SELECT p.*, m.numero as mesa_numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.status NOT IN ('entregue', 'cancelado') ORDER BY p.created_at DESC`)).rows); });
app.get('/api/pedidos/historico', async (req, res) => { res.json((await query(`SELECT p.*, m.numero as mesa_numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.status IN ('entregue', 'cancelado') ORDER BY p.created_at DESC LIMIT 50`)).rows); });
app.get('/api/pedidos/:id/itens', async (req, res) => { res.json((await query(`SELECT pi.*, m.nome, m.preco FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ? ORDER BY pi.status DESC, pi.id ASC`, [req.params.id])).rows); });

app.delete('/api/pedidos/itens/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Busca os dados do item antes de deletar
    const item = (await query("SELECT pedido_id, menu_id, quantidade FROM pedido_itens WHERE id = ?", [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    const pedidoId = item.pedido_id;

    // 2. Devolve o estoque
    await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);

    // 3. Deleta o item
    await query("DELETE FROM pedido_itens WHERE id = ?", [id]);

    // 4. Verifica quantos itens restam no pedido
    const itensRestantes = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [pedidoId])).rows;
    
    if (itensRestantes.length === 0) {
      const pedido = (await query("SELECT mesa_id FROM pedidos WHERE id = ?", [pedidoId])).rows[0];
      await query("DELETE FROM pedidos WHERE id = ?", [pedidoId]);
      if (pedido) await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
      await notifyStatus(pedidoId, pedido ? pedido.mesa_id : null, 'cancelado');
    } else {
      const temPendente = itensRestantes.some(i => i.status === 'pendente');
      if (!temPendente) {
        await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [pedidoId]);
        await notifyStatus(pedidoId, null, 'servido');
      } else {
        await notifyStatus(pedidoId, null, 'itens_atualizados');
      }
    }

    await pusher.trigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) {
    console.error('ERRO AO EXCLUIR ITEM:', error);
    res.status(500).json({ error: 'Erro ao excluir item' });
  }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pedido = (await query("SELECT mesa_id, status FROM pedidos WHERE id = ?", [id])).rows[0];
    
    // Devolve o estoque de todos os itens do pedido
    const itens = (await query("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    for (const item of itens) {
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    }

    await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [id]);
    await query("DELETE FROM pedidos WHERE id = ?", [id]);
    
    if (pedido && pedido.status !== 'entregue' && pedido.status !== 'cancelado') {
      await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
    }
    
    await pusher.trigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir pedido' });
  }
});

app.delete('/api/pedidos/limpar', async (req, res) => {
  try {
    // Primeiro removemos os itens dos pedidos entregues/cancelados para manter a integridade
    await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE status IN ('entregue', 'cancelado'))");
    // Depois removemos os pedidos
    await query("DELETE FROM pedidos WHERE status IN ('entregue', 'cancelado')");
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao limpar histórico' });
  }
});

app.post('/api/login', async (req, res) => {
  const { usuario, senha } = req.body;
  const result = await query('SELECT id, nome, senha FROM garcons WHERE usuario = ?', [usuario]);
  if (result.rows.length > 0) {
    const garcom = result.rows[0];
    const match = await bcrypt.compare(senha, garcom.senha);
    if (match) {
      delete garcom.senha;
      return res.json({ success: true, garcom });
    }
  }
  res.status(401).json({ error: 'Usuário ou senha incorretos' });
});

app.post('/api/admin/login', async (req, res) => {
  const { usuario, senha } = req.body;
  try {
    const result = await query('SELECT id, usuario, senha FROM usuarios_admin WHERE usuario = ?', [usuario]);
    if (result.rows.length > 0) {
      const admin = result.rows[0];
      const match = await bcrypt.compare(senha, admin.senha);
      if (match) {
        delete admin.senha;
        return res.json({ success: true, admin });
      }
    }
    res.status(401).json({ error: 'Usuário ou senha incorretos' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// --- ROTAS DE CAIXA ---
app.get('/api/caixa/status', async (req, res) => {
  const result = await query("SELECT * FROM fluxo_caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1");
  res.json(result.rows[0] || null);
});

app.post('/api/caixa/abrir', async (req, res) => {
  const { valor_inicial } = req.body;
  try {
    const aberto = await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'");
    if (aberto.rows.length > 0) return res.status(400).json({ error: 'Já existe um caixa aberto' });
    
    await query("INSERT INTO fluxo_caixa (valor_inicial, status) VALUES (?, 'aberto')", [valor_inicial || 0]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao abrir caixa' }); }
});

app.post('/api/caixa/fechar', async (req, res) => {
  const { valor_final, id } = req.body;
  try {
    await query("UPDATE fluxo_caixa SET valor_final = ?, status = 'fechado', data_fechamento = ? WHERE id = ?", [valor_final, new Date().toISOString(), id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao fechar caixa' }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
