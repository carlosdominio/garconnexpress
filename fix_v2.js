const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(/_v2/g, ''); // Removes all occurrences of _v2
fs.writeFileSync('server.js', code);
console.log('Fixed server.js');
