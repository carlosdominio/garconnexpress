const fs = require('fs');
const path = require('path');

const files = [
  'frontend/garcom/app.js',
  'frontend/cozinha/app.js',
  'frontend/motoboy/app.js',
  'garcom-app-nativo/www/app.js',
  'cozinha-app-nativo/www/app.js',
  'motoboy-app-nativo/www/app.js'
];

for (const f of files) {
  const p = path.join('C:/Users/Admin/.verdent/verdent-projects/new-project', f);
  if (!fs.existsSync(p)) continue;
  
  let content = fs.readFileSync(p, 'utf8');

  let newContent = content;
  const events = ['teste-toast', 'comunicado-geral', 'fechamento-atrasado', 'pedido-atrasado-garcom', 'pedido-atrasado-cozinha', 'pedido-pronto', 'novo-pedido', 'mesa-liberada', 'pedido-cancelado', 'status-caixa-atualizado', 'chamado-garcom', 'rascunho-recebido', 'solicitacao-fechamento-cliente', 'item-adicionado', 'item-removido', 'pedido-atrasado-motoboy', 'motoboy-chamado', 'motoboy-cancelado'];

  for (const ev of events) {
    const regexes = [
      new RegExp(`(channel\\.bind\\('${ev}',.*?\\{.*?)(tocarCampainha\\([^)]*\\);)`, 's'),
      new RegExp(`(channel\\.bind\\('${ev}',.*?\\{.*?)(App\\.audio\\.playBell\\([^)]*\\);)`, 's'),
      new RegExp(`(channel\\.bind\\('${ev}',.*?\\{.*?)(tocarSomNotificacao\\([^)]*\\);)`, 's'),
      new RegExp(`(canal\\.bind\\('${ev}',.*?\\{.*?)(tocarSomNotificacao\\([^)]*\\);)`, 's'),
      new RegExp(`(canal\\.bind\\('${ev}',.*?\\{.*?)(tocarCampainha\\([^)]*\\);)`, 's'),
      new RegExp(`(canal\\.bind\\('${ev}',.*?\\{.*?)(App\\.audio\\.playBell\\([^)]*\\);)`, 's')
    ];
    
    for (const re of regexes) {
      if (re.test(newContent)) {
        newContent = newContent.replace(re, `$1if (deveTocarSom('${ev}')) $2`);
      }
    }
  }
  
  fs.writeFileSync(p, newContent, 'utf8');
  console.log('Fixed events in', f);
}
