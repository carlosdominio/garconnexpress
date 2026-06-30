const fs = require('fs');
let content = fs.readFileSync('routes/mesas.js', 'utf8');

const target = "(SELECT p.fechamento_liberado FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as fechamento_liberado,";
const replacement = target + "\n          (SELECT p.forma_pagamento FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as forma_pagamento,";

content = content.replace(target, replacement);
fs.writeFileSync('routes/mesas.js', content);
console.log('routes/mesas.js updated.');
