const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// Fix 1: atualizar-itens (quantidades negativas)
let target1 = "const p = (await query(\"SELECT nome, estoque FROM menu WHERE id = ?\", [item.menu_id])).rows[0];";
let replacement1 = "if (!item.quantidade || item.quantidade <= 0) return res.status(400).json({ error: 'Quantidade inválida (negativa ou zero)' });\n        const p = (await query(\"SELECT nome, estoque FROM menu WHERE id = ?\", [item.menu_id])).rows[0];";
content = content.replace(target1, replacement1);

// Fix 2: pagamento-fracao (valor negativo)
let target2 = "const cx = (await query(\"SELECT id FROM fluxo_caixa WHERE status = 'aberto'\")).rows[0];";
let replacement2 = "if (valor_pago <= 0) return res.status(400).json({ error: 'Valor de pagamento não pode ser negativo ou zero' });\n    const cx = (await query(\"SELECT id FROM fluxo_caixa WHERE status = 'aberto'\")).rows[0];";
content = content.replace(target2, replacement2);

// Fix 3: pagamento-parcial (total negativo)
let target3 = "const { mesa_id, itens, forma_pagamento, total, num_pessoas, valor_por_pessoa } = req.body;\n  try {\n    const cx = (await query(\"SELECT id FROM fluxo_caixa WHERE status = 'aberto'\")).rows[0];";
let replacement3 = "const { mesa_id, itens, forma_pagamento, total, num_pessoas, valor_por_pessoa } = req.body;\n  if (total <= 0) return res.status(400).json({ error: 'O valor total do pagamento parcial não pode ser negativo' });\n  try {\n    const cx = (await query(\"SELECT id FROM fluxo_caixa WHERE status = 'aberto'\")).rows[0];";
content = content.replace(target3, replacement3);

// Fix 4: status entregue (valorParte negativo)
let target4 = "if (!valorParte || isNaN(valorParte)) valorParte = 0;";
let replacement4 = "if (!valorParte || isNaN(valorParte)) valorParte = 0;\n            if (valorParte < 0) return res.status(400).json({ error: 'Valor fracionado negativo detectado' });";
content = content.replace(target4, replacement4);

// Fix 5: solicitar-fechamento (totalFinal negativo)
let target5 = "totalFinal = deveTaxa ? Math.round(sub * taxaMultiplicador * 100) / 100 : sub;\n    }";
let replacement5 = "totalFinal = deveTaxa ? Math.round(sub * taxaMultiplicador * 100) / 100 : sub;\n    }\n    if (totalFinal < 0) return res.status(400).json({ error: 'Total negativo não é permitido' });";
content = content.replace(target5, replacement5);

fs.writeFileSync('server.js', content);
console.log('Patch complete.');
