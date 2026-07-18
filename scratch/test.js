const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'garconnexpress.db');
console.log('Connecting to database at:', dbPath);

const db = new Database(dbPath);

const oldSql = `
  SELECT m.*, 
    (SELECT p.id FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_id,
    (SELECT p.created_at FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_created_at, 
    COALESCE(
      (SELECT p.garcom_id FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1),
      m.garcom_id
    ) as garcom_id,
    (SELECT p.status FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_status,
    (SELECT p.solicitou_fechamento FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as solicitou_fechamento,
    (SELECT p.fechamento_solicitado_em FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as fechamento_solicitado_em,
    (SELECT p.fechamento_liberado FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as fechamento_liberado,
    (SELECT p.forma_pagamento FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as forma_pagamento,
    (SELECT ca.codigo FROM codigos_acesso ca WHERE ca.mesa_id = m.id AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1) as codigo_acesso,
    (SELECT ca.criado_at FROM codigos_acesso ca WHERE ca.mesa_id = m.id AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1) as codigo_criado_at
  FROM mesas m ORDER BY m.numero
`;

const newSql = `
  SELECT m.*,
    p.id as pedido_id,
    p.created_at as pedido_created_at,
    COALESCE(p.garcom_id, m.garcom_id) as garcom_id,
    p.status as pedido_status,
    p.solicitou_fechamento as solicitou_fechamento,
    p.fechamento_solicitado_em as fechamento_solicitado_em,
    p.fechamento_liberado as fechamento_liberado,
    p.forma_pagamento as forma_pagamento,
    ca.codigo as codigo_acesso,
    ca.criado_at as codigo_criado_at
  FROM mesas m
  LEFT JOIN (
    SELECT p1.*
    FROM pedidos p1
    INNER JOIN (
      SELECT mesa_id, MAX(id) as max_id
      FROM pedidos
      WHERE status NOT IN ('entregue', 'cancelado', 'rascunho')
      GROUP BY mesa_id
    ) p2 ON p1.id = p2.max_id
  ) p ON p.mesa_id = m.id
  LEFT JOIN (
    SELECT ca1.*
    FROM codigos_acesso ca1
    INNER JOIN (
      SELECT mesa_id, MAX(id) as max_id
      FROM codigos_acesso
      WHERE status = 'ativo'
      GROUP BY mesa_id
    ) ca2 ON ca1.id = ca2.max_id
  ) ca ON ca.mesa_id = m.id
  ORDER BY m.numero
`;

// Warmup
db.prepare(oldSql).all();
db.prepare(newSql).all();

console.time('Old SQL Query');
const oldRows = db.prepare(oldSql).all();
console.timeEnd('Old SQL Query');

console.time('New SQL Query');
const newRows = db.prepare(newSql).all();
console.timeEnd('New SQL Query');

console.log(`Old rows: ${oldRows.length}, New rows: ${newRows.length}`);

// Compare output to verify correctness
let matches = true;
if (oldRows.length !== newRows.length) {
  matches = false;
  console.log('Row count mismatch!');
} else {
  for (let i = 0; i < oldRows.length; i++) {
    const rOld = oldRows[i];
    const rNew = newRows[i];
    for (const key of Object.keys(rOld)) {
      if (rOld[key] !== rNew[key]) {
        console.log(`Mismatch at row ${i}, key "${key}": Old="${rOld[key]}", New="${rNew[key]}"`);
        matches = false;
      }
    }
  }
}

if (matches) {
  console.log('SUCCESS: Queries return EXACTLY the same results!');
} else {
  console.log('FAIL: Queries return different results.');
}

db.close();
