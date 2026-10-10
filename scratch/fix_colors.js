const fs = require('fs');
let content = fs.readFileSync('frontend/cardapio/index.html', 'utf8');
content = content.replace(/confirmButtonColor:\s*'#ff4757',\s*cancelButtonColor:\s*'#ff4757'/g, "confirmButtonColor: '#ff4757',\n                cancelButtonColor: '#95a5a6'");
fs.writeFileSync('frontend/cardapio/index.html', content);
