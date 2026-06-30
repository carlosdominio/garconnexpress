const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const replacements = [
  { from: "app.post('/api/bot-responses', async", to: "app.post('/api/bot-responses', isAdmin, async" }
];

let replaced = 0;
replacements.forEach(r => {
  if (content.includes(r.from)) {
    content = content.replace(r.from, r.to);
    replaced++;
  }
});

fs.writeFileSync('server.js', content);
console.log('Successfully replaced', replaced, 'endpoints.');
