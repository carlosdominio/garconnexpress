const fs = require('fs');

const files = [
  'garcom-app-nativo/www/app.js',
  'frontend/garcom/app.js'
];

const target = "} else if (mesa.status === 'fechando') {\\n        statusTexto = '⏳ AGUARDANDO CAIXA';\\n        classeAlerta = 'aguardando-fechamento';";

const replacement = "} else if (mesa.status === 'fechando') {\\n        let iconePagamento = '⏳';\\n        if (mesa.forma_pagamento === 'Pix') iconePagamento = '💠';\\n        else if (mesa.forma_pagamento === 'Cartão') iconePagamento = '💳';\\n        else if (mesa.forma_pagamento === 'Dinheiro') iconePagamento = '💵';\\n        else if (mesa.forma_pagamento === 'Múltiplas') iconePagamento = '🧾';\\n        statusTexto = iconePagamento + ' AGUARD. CAIXA (' + (mesa.forma_pagamento || '...') + ')';\\n        classeAlerta = 'aguardando-fechamento';";

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  // Need to replace exact matches. Since we used \\n in strings, we can just replace the string.
  // Wait, reading from file will have \r\n on Windows usually. So we use regex.
  const regex = /\} else if \(mesa\.status === 'fechando'\) \{\s*statusTexto = '⏳ AGUARDANDO CAIXA';\s*classeAlerta = 'aguardando-fechamento';/g;
  
  content = content.replace(regex, "} else if (mesa.status === 'fechando') {\n        let iconePagamento = '⏳';\n        if (mesa.forma_pagamento === 'Pix') iconePagamento = '💠';\n        else if (mesa.forma_pagamento === 'Cartão') iconePagamento = '💳';\n        else if (mesa.forma_pagamento === 'Dinheiro') iconePagamento = '💵';\n        else if (mesa.forma_pagamento === 'Múltiplas') iconePagamento = '🧾';\n        statusTexto = iconePagamento + ' AGUARD. CAIXA (' + (mesa.forma_pagamento || '...') + ')';\n        classeAlerta = 'aguardando-fechamento';");
  fs.writeFileSync(file, content);
  console.log(file, 'updated.');
}
