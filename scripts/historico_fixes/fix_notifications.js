const fs = require('fs');
let appJs = fs.readFileSync('app.js', 'utf8');

// Remove as chamadas duplicadas de exibirNotificacaoNativa logo após mostrarToast
appJs = appJs.replace(/mostrarToast\([\s\S]*?\);\s*exibirNotificacaoNativa\([\s\S]*?\);/g, (match) => {
    // Fica apenas com o mostrarToast
    return match.split(';')[0] + ';';
});

// Em lugares onde apenas exibirNotificacaoNativa é chamado, nós deixamos.
// Mas vamos alterar a definição de mostrarToast para fazer as duas coisas.

// Adicionar a lógica nativa dentro de mostrarToast
const novoMostrarToast = `function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
  // --- INÍCIO: INTEGRAÇÃO NATIVA (FCM/Local) ---
  if (window.Capacitor && window.Capacitor.Plugins.LocalNotifications) {
      let nativoTitulo = titulo;
      if (!nativoTitulo) {
         if (tipo === 'success') nativoTitulo = '✅ Sucesso';
         else if (tipo === 'error') nativoTitulo = '❌ Erro';
         else if (tipo === 'warning') nativoTitulo = '⚠️ Atenção';
         else nativoTitulo = 'ℹ️ Informação';
      }
      
      // Aciona o push nativo idêntico ao toast
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
      }).catch(err => console.log('Erro ao disparar notificação nativa:', err));
  }
  // --- FIM: INTEGRAÇÃO NATIVA ---

  let container = document.getElementById('toast-container');`;

appJs = appJs.replace(/function mostrarToast\(msg,\s*tipo\s*=\s*'success',\s*titulo\s*=\s*'',\s*duracao\s*=\s*5000\)\s*\{\s*let container = document.getElementById\('toast-container'\);/g, novoMostrarToast);

// E também vamos garantir que a exibirNotificacaoNativa original seja mantida apenas para onde o mostrarToast NÃO foi chamado,
// mas para que também exiba o Toast, garantindo sincronia total:
const novaNotificacaoNativa = `function exibirNotificacaoNativa(tit, msg, tagId = 'geral') {
    // Redireciona para o mostrarToast para garantir que o Toast visual E o nativo apareçam idênticos!
    mostrarToast(msg, 'info', tit);
}`;

appJs = appJs.replace(/function exibirNotificacaoNativa\(tit,\s*msg,\s*tagId\s*=\s*'geral'\)\s*\{[\s\S]*?\}\s*(?=\/\/)/, novaNotificacaoNativa + '\n\n');

fs.writeFileSync('app.js', appJs);
console.log('Script aplicado com sucesso!');
