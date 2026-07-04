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

  // Inject deveTocarSom
  if (!content.includes('function deveTocarSom')) {
    content = content.replace(
      'function dispararToastSistema', 
      "function deveTocarSom(evento) {\n  const c = typeof _toastTemplates !== 'undefined' ? _toastTemplates.find(x => x.evento === evento) : null;\n  return c ? c.som !== false : true;\n}\n\nfunction dispararToastSistema"
    );
  }

  // Regex to match channel.bind('event', ...) up to the sound playing function
  // We make sure it does not cross another bind by using (?!channel\.bind|canal\.bind)
  
  const funcNames = ['tocarCampainha', 'tocarSomNotificacao', 'App\\\\.audio\\\\.playBell'];
  
  for (const func of funcNames) {
    // Keep replacing until no more matches (for multiple occurrences in the same bind, though rare)
    // Actually, just replace one per bind. We can iterate over all binds.
    const re = new RegExp(`((?:channel|canal)\\.bind\\('([^']+)',(?:(?!(?:channel|canal)\\.bind)[\\s\\S])*?)(?<!if \\(deveTocarSom\\('[^']+'\\)\\) )(${func}\\([^)]*\\);)`, 'g');
    
    content = content.replace(re, (match, prefix, eventName, funcCall) => {
       return `${prefix}if (deveTocarSom('${eventName}')) ${funcCall}`;
    });
  }

  // Also catch one specific case: 
  // In cozinha, there's `tocarCampainha()` inside `tocarSomNotificacao` itself, that's fine, it will play.
  // We just want to guard the calls to the sound functions.
  
  fs.writeFileSync(p, content, 'utf8');
  console.log('Fixed events in', f);
}
