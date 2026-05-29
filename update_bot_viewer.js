const fs = require('fs');
const filePath = 'C:\\Users\\Admin\\meu-zap-bot\\public\\index.html';
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = 'function abrirImagem(url, msgId, fromMe) {';
const startIdx = content.indexOf(targetStr);

if (startIdx !== -1) {
    // We need to find the end of the original function.
    // Based on previous cat/read, it's a few lines long.
    // Let's find the closing brace.
    let braceCount = 0;
    let endIdx = -1;
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') braceCount++;
        if (content[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
                endIdx = i + 1;
                break;
            }
        }
    }

    if (endIdx !== -1) {
        const newFn = `function abrirImagem(url, msgId, fromMe) {
        // Salva para possível exclusão (caso precise apagar enquanto vê)
        currentViewerMsgId = msgId;
        currentViewerFromMe = fromMe;

        // Envia para o Painel Admin (Pai) abrir em TELA CHEIA REAL fora do iframe
        window.parent.postMessage({ type: 'open_image_fullscreen', url: url }, '*');
    }`;
        
        content = content.substring(0, startIdx) + newFn + content.substring(endIdx);
        
        // Also cleanup: we no longer need the internal overlay in the bot if we use the global one.
        // But for safety and the delete feature, we'll keep the internal logic available but triggered differently if needed.
        // Actually, the user asked for fullscreen, so the internal one is now redundant.
        
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Successfully updated abrirImagem to use parent fullscreen viewer.');
    } else {
        console.log('Could not find end of function.');
    }
} else {
    console.log('Could not find abrirImagem function.');
}
