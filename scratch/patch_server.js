const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');
content = content.replace(
  "SELECT id, total, status, cobrar_taxa, desconto, acrescimo, solicitou_fechamento, fechamento_solicitado_em, fechamento_liberado",
  "SELECT id, total, status, cobrar_taxa, desconto, acrescimo, solicitou_fechamento, fechamento_solicitado_em, fechamento_liberado, forma_pagamento, valor_recebido, troco"
);
fs.writeFileSync('server.js', content);
