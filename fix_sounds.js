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

  // Inject deveTocarSom(evento)
  if (!content.includes('function deveTocarSom')) {
    content = content.replace(
      'function dispararToastSistema', 
      "function deveTocarSom(evento) {\n  const c = _toastTemplates.find(x => x.evento === evento);\n  return c ? c.som !== false : true;\n}\n\nfunction dispararToastSistema"
    );
  }

  // Replace tocarCampainha() with if (deveTocarSom('evento')) tocarCampainha()
  // We need to map events to their tocarCampainha calls...
  // This might be tricky with regex. 
  
  fs.writeFileSync(p, content, 'utf8');
  console.log('Injected deveTocarSom in', f);
}
