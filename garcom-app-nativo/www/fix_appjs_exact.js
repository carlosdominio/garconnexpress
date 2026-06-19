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

// 2. Exact replacement of exibirNotificacaoNativa
const oldNativa = `function exibirNotificacaoNativa(tit, msg, tagId = 'geral') {
  if ("Notification" in window && Notification.permission === "granted") {
    const options = {
      body: msg,
      tag: tagId,
      renotify: true,
      vibrate: [200, 100, 200],
      icon: '/garcom/favicon.svg',
      badge: '/garcom/favicon.svg'
    };
    
    const n = new Notification(tit, options);
    
    n.onclick = () => {
      window.focus();
      n.close();
    };

    // Auto-fecha a notificação do sistema após 8 segundos para não travar no topo
    setTimeout(() => n.close(), 8000);
  }
}`;

const newNativa = `function exibirNotificacaoNativa(tit, msg, tagId = 'geral') {
  // Redireciona tudo para mostrarToast
  mostrarToast(msg, 'info', tit);
}`;

text = text.replace(oldNativa, newNativa);

// 3. Add Native logic to mostrarToast
const oldToastDef = `function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
  let container = document.getElementById('toast-container');`;

const newToastDef = `function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
  // --- INÍCIO INTEGRAÇÃO NATIVA SÍNCRONA ---
  let nativoTitulo = titulo;
  if (!nativoTitulo) {
      if (tipo === 'success') nativoTitulo = '✅ Sucesso';
      else if (tipo === 'error') nativoTitulo = '❌ Erro';
      else if (tipo === 'warning') nativoTitulo = '⚠️ Atenção';
      else nativoTitulo = 'ℹ️ Informação';
  }

  // Capacitor LocalNotifications (Nativo real)
  if (window.Capacitor && window.Capacitor.Plugins.LocalNotifications) {
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
  } else if ("Notification" in window && Notification.permission === "granted") {
      // HTML5 API (Fallback)
      const options = { body: msg, tag: 'toast-' + Date.now(), renotify: true, vibrate: [200, 100, 200], icon: '/garcom/favicon.svg' };
      const n = new Notification(nativoTitulo, options);
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(() => n.close(), 8000);
  }
  // --- FIM INTEGRAÇÃO NATIVA ---

  let container = document.getElementById('toast-container');`;

text = text.replace(oldToastDef, newToastDef);

// 4. Remove the lines calling exibirNotificacaoNativa right after mostrarToast
// These specific lines are safe to delete because they are duplicates now.
const duplicatesToRemove = [
  "      exibirNotificacaoNativa('🍳 COZINHA: PEDIDO PRONTO!', data.mensagem, `pronto-${Date.now()}`);",
  "      exibirNotificacaoNativa(`✨ ${mesaStr}: NOVO PEDIDO`, `Um novo pedido foi realizado na ${mesaStr}.`, `novo-${Date.now()}`);",
  "            exibirNotificacaoNativa('📢 ATUALIZAÇÃO DE PEDIDO', msg, tagId);",
  "      exibirNotificacaoNativa(`❌ ${mesaStr}: PEDIDO REMOVIDO`, msg, `cancel-${data.pedido_id}`);"
];

for (const dup of duplicatesToRemove) {
    text = text.replace(dup, "");
}

fs.writeFileSync('app.js', text);
console.log('App.js patched perfectly and safely!');
