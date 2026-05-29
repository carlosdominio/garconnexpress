const fs = require('fs');

const indexHtmlPath = 'C:\\Users\\Admin\\meu-zap-bot\\public\\index.html';
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

const targetFunction = `function renderMessage(msg) {`;
const idx = indexHtml.indexOf(targetFunction);

if (idx !== -1) {
    // Find the end of the content assignment block
    const audioBlockOld = `if (msg.audioUrl) {
            content = \`<audio controls class="audio-msg"><source src="\${msg.audioUrl}" type="audio/ogg"></audio>\`;        
        }`;
    
    // We can also just replace `div.innerHTML = \`\${content}`
    const innerHtmlIdx = indexHtml.indexOf("div.innerHTML = `${content}", idx);
    
    if (innerHtmlIdx !== -1) {
        const replacement = `
        if (msg.imageUrl) {
            content += \`<br><img src="\${msg.imageUrl}" style="max-width: 250px; border-radius: 8px; margin-top: 5px;">\`;
        }
        div.innerHTML = \`\${content}`;
        
        indexHtml = indexHtml.substring(0, innerHtmlIdx) + replacement + indexHtml.substring(innerHtmlIdx + 28);
        fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
        console.log('Successfully injected image rendering logic.');
    } else {
        console.log('Could not find innerHTML assignment.');
    }
} else {
    console.log('Could not find renderMessage function.');
}
