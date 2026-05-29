const fs = require('fs');

const indexJsPath = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';
let indexJs = fs.readFileSync(indexJsPath, 'utf8');

const ioOld = 'const io = new Server(server, { cors: { origin: "*" } });';
const ioNew = 'const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e8 }); // 100 MB Limit for images/audio';

if (indexJs.includes(ioOld)) {
    indexJs = indexJs.replace(ioOld, ioNew);
    fs.writeFileSync(indexJsPath, indexJs, 'utf8');
    console.log('Fixed Socket.io buffer size limit.');
} else {
    console.log('Could not find socket.io initialization.');
}

const htmlPath = 'C:\\Users\\Admin\\meu-zap-bot\\public\\index.html';
let html = fs.readFileSync(htmlPath, 'utf8');

// Fix the CSS to ensure scrolling works
html = html.replace('#messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }', '#messages { flex: 1; min-height: 0; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }');
html = html.replace('#main-chat { flex: 1; display: flex; flex-direction: column; background: #efeae2; position: relative; }', '#main-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #efeae2; position: relative; }');

// Clean up the innerHTML again just to be absolutely sure there are no typos
// The user says they see: small style="display:block; text-align:right; font-size:10px; margin-top:5px; opacity:0.6;">17:18
// This implies the `<` before small is MISSING in their browser.
// Let's force rewrite the renderMessage function just in case.

const renderStart = html.indexOf('function renderMessage(msg) {');
const renderEnd = html.indexOf('function scrollToBottom() {');

const newRender = `function renderMessage(msg) {
        if (document.getElementById(\`msg-\${msg.id}\`)) return;
        const div = document.createElement('div');
        div.id = \`msg-\${msg.id}\`;
        div.className = 'msg ' + (msg.fromMe ? 'msg-enviada' : 'msg-recebida');
        
        let msgContent = '';
        if (msg.text) {
            msgContent += \`<p>\${msg.text}</p>\`;
        }
        if (msg.audioUrl) {
            msgContent += \`<audio controls class="audio-msg"><source src="\${msg.audioUrl}" type="audio/ogg"></audio>\`;
        }
        if (msg.imageUrl) {
            msgContent += \`<br><img src="\${msg.imageUrl}" style="max-width: 250px; border-radius: 8px; margin-top: 5px;">\`;
        }
        
        div.innerHTML = msgContent + '<small style="display:block; text-align:right; font-size:10px; margin-top:5px; opacity:0.6;">' + msg.time + '</small>';
        
        document.getElementById('messages').appendChild(div);
        scrollToBottom();
    }

    `;

if (renderStart !== -1 && renderEnd !== -1) {
    html = html.substring(0, renderStart) + newRender + html.substring(renderEnd);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('Fixed renderMessage and CSS scroll.');
} else {
    console.log('Could not find renderMessage bounds.');
}

