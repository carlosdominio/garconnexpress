const fs = require('fs');
const files = [
  'garcom-app-nativo/www/app.js',
  'frontend/garcom/app.js'
];
const regex = /\} else if \(mesa\.solicitou_fechamento && mesa\.status !== 'fechando'\) \{\s*classeAlerta = 'solicitacao-fechamento';\s*statusTexto = '💳 🛎️ SOLICITAÇÃO DE FECHAMENTO';/g;

const replacement = "} else if (mesa.solicitou_fechamento && mesa.status !== 'fechando') {\n        classeAlerta = 'solicitacao-fechamento';\n        let iconePagamento = '🛎️';\n        if (mesa.forma_pagamento === 'Pix') iconePagamento = '💠';\n        else if (mesa.forma_pagamento === 'Cartão') iconePagamento = '💳';\n        else if (mesa.forma_pagamento === 'Dinheiro') iconePagamento = '💵';\n        else if (mesa.forma_pagamento === 'Múltiplas') iconePagamento = '🧾';\n        statusTexto = iconePagamento + ' SOLICITAÇÃO DE FECHAMENTO (' + (mesa.forma_pagamento || '...') + ')';";

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content);
  console.log(file, 'updated.');
}
