const fs = require('fs');
let text = fs.readFileSync('app.js', 'utf8');

// 1. Fix encodings
const map = {
  "Ã§": "ç", "Ã£": "ã", "Ãµ": "õ", "Ã©": "é", "Ã­": "í", "Ã¡": "á", "Ã³": "ó", "Ãº": "ú",
  "ÃÇ": "Ç", "Ãƒ": "Ã", "ÃÕ": "Õ", "ÃÉ": "É", "ÃÍ": "Í", "ÃÁ": "Á", "ÃÓ": "Ó", "ÃÚ": "Ú",
  "Ã¢": "â", "Ãª": "ê", "Ã®": "î", "Ã´": "ô", "Ã»": "û", "ÃÀ": "À", "Ã¨": "è",
  "AÃ§Ã£o": "Ação", "AÃ§Ãµes": "Ações", "NotificaÃ§Ãµes": "Notificações"
};

for (const [bad, good] of Object.entries(map)) {
    text = text.split(bad).join(good);
}

const lines = text.split('\n');
const newLines = [];
let skipNext = false;

for (let i = 0; i < lines.length; i++) {
    if (skipNext) {
        skipNext = false;
        continue;
    }
    const line = lines[i];
    
    // Se achou um mostrarToast
    if (line.includes('mostrarToast(')) {
        newLines.push(line);
        // Verifica se as próximas linhas contêm a chamada duplicada de nativa
        if (i + 1 < lines.length && lines[i+1].includes('exibirNotificacaoNativa(') && !lines[i+1].includes('function')) {
            skipNext = true; // pula a linha do exibirNotificacaoNativa
        }
        else if (i + 2 < lines.length && lines[i+1].trim() === '' && lines[i+2].includes('exibirNotificacaoNativa(') && !lines[i+2].includes('function')) {
            lines[i+1] = '';
            lines[i+2] = '';
        }
    } else {
        newLines.push(line);
    }
}

text = newLines.join('\n');

// Redefine mostrarToast to include Capacitor Logic
const novoToast = `function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
  // --- INTEGRAÇÃO NATIVA (FCM/Local) ---
  if (window.Capacitor && window.Capacitor.Plugins.LocalNotifications) {
      let nativoTitulo = titulo;
      if (!nativoTitulo) {
         if (tipo === 'success') nativoTitulo = '✅ Sucesso';
         else if (tipo === 'error') nativoTitulo = '❌ Erro';
         else if (tipo === 'warning') nativoTitulo = '⚠️ Atenção';
         else nativoTitulo = 'ℹ️ Informação';
      }
      window.Capacitor.Plugins.LocalNotifications.schedule({
          notifications: [{
              title: nativoTitulo,
              body: msg,
              id: new Date().getTime() % 1000000,
              schedule: { at: new Date(Date.now() + 100) },
              sound: 'notificacao.wav',
              actionTypeId: "",
              extra: null
          }]
      }).catch(e => console.log(e));
  }
  // --- FIM INTEGRAÇÃO NATIVA ---

  let container = document.getElementById('toast-container');`;

text = text.replace(/function mostrarToast\(msg,\s*tipo\s*=\s*'success',\s*titulo\s*=\s*'',\s*duracao\s*=\s*5000\)\s*\{\s*let container = document.getElementById\('toast-container'\);/g, novoToast);

// Redefine exibirNotificacaoNativa to just call mostrarToast
const novaNativa = `function exibirNotificacaoNativa(tit, msg, tagId = 'geral') {
  mostrarToast(msg, 'info', tit);
}`;

text = text.replace(/function exibirNotificacaoNativa\(tit,\s*msg,\s*tagId\s*=\s*'geral'\)\s*\{[\s\S]*?\}\s*(?=\/\/)/, novaNativa + '\n\n');

fs.writeFileSync('app.js', text);
console.log('App.js patched perfectly!');
