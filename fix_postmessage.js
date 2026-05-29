const fs = require('fs');
const filePath = 'C:\\Users\\Admin\\meu-zap-bot\\public\\index.html';
let content = fs.readFileSync(filePath, 'utf8');

const s = content.indexOf('// FIX: Notificar sempre o pai');
if (s !== -1) {
    const startOfBlock = s;
    const endOfBlock = content.indexOf('}', s) + 1;
    
    const newBlock = `// FIX: Notificar sempre o pai (Admin) sobre novas mensagens e mensagens enviadas
            window.parent.postMessage({ type: 'whatsapp_new_activity', jid: jid, active: (jid === currentJid), fromMe: msg.fromMe }, '*');`;
            
    content = content.substring(0, startOfBlock) + newBlock + content.substring(endOfBlock);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed postMessage logic successfully.');
} else {
    console.log('Could not find the target block.');
}