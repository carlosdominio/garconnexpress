const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const replacements = [
  // Pedidos e Itens (Garçom, Cozinha, Admin)
  { from: "app.put('/api/pedidos/:id/marcar-entregue', statusLimiter, async", to: "app.put('/api/pedidos/:id/marcar-entregue', statusLimiter, isAuthenticated, async" },
  { from: "app.put('/api/itens/:id/pronto', async", to: "app.put('/api/itens/:id/pronto', isAuthenticated, async" },
  { from: "app.put('/api/pedidos/:id/taxa', async", to: "app.put('/api/pedidos/:id/taxa', isAuthenticated, async" },
  { from: "app.delete('/api/pedidos/itens/:id', async", to: "app.delete('/api/pedidos/itens/:id', isAuthenticated, async" },
  { from: "app.put('/api/pedidos/:id/atualizar-itens', async", to: "app.put('/api/pedidos/:id/atualizar-itens', isAuthenticated, async" },
  { from: "app.post('/api/pedidos/:id/pagamento-fracao', async", to: "app.post('/api/pedidos/:id/pagamento-fracao', isAuthenticated, async" },
  { from: "app.post('/api/pedidos/:id/pagamento-parcial', async", to: "app.post('/api/pedidos/:id/pagamento-parcial', isAuthenticated, async" },
  { from: "app.put('/api/pedidos/:id/pessoas', async", to: "app.put('/api/pedidos/:id/pessoas', isAuthenticated, async" },
  { from: "app.put('/api/pedidos/:id/solicitar-fechamento', async", to: "app.put('/api/pedidos/:id/solicitar-fechamento', isAuthenticated, async" },
  
  // Apenas Admin
  { from: "app.post('/api/caixa/abrir', async", to: "app.post('/api/caixa/abrir', isAdmin, async" },
  { from: "app.post('/api/caixa/fechar', async", to: "app.post('/api/caixa/fechar', isAdmin, async" },
  { from: "app.delete('/api/pedidos/limpar', async", to: "app.delete('/api/pedidos/limpar', isAdmin, async" },
  { from: "app.put('/api/menu/:id', async", to: "app.put('/api/menu/:id', isAdmin, async" },
  { from: "app.post('/api/menu', async", to: "app.post('/api/menu', isAdmin, async" },
  { from: "app.delete('/api/menu/:id', async", to: "app.delete('/api/menu/:id', isAdmin, async" },
  { from: "app.delete('/api/menu/categoria/:categoria', async", to: "app.delete('/api/menu/categoria/:categoria', isAdmin, async" },
  { from: "app.put('/api/menu/categoria/:categoria', async", to: "app.put('/api/menu/categoria/:categoria', isAdmin, async" },
  { from: "app.post('/api/garcons', async", to: "app.post('/api/garcons', isAdmin, async" },
  { from: "app.put('/api/garcons/:id', async", to: "app.put('/api/garcons/:id', isAdmin, async" },
  { from: "app.delete('/api/garcons/:id', async", to: "app.delete('/api/garcons/:id', isAdmin, async" },
  { from: "app.post('/api/config/ordem-categorias', async", to: "app.post('/api/config/ordem-categorias', isAdmin, async" },
  { from: "app.post('/api/config/categorias-cozinha', async", to: "app.post('/api/config/categorias-cozinha', isAdmin, async" },
  { from: "app.post('/api/whatsapp-toggle', async", to: "app.post('/api/whatsapp-toggle', isAdmin, async" },
  { from: "app.post('/api/whatsapp-number', async", to: "app.post('/api/whatsapp-number', isAdmin, async" },
];

let replaced = 0;
replacements.forEach(r => {
  if (content.includes(r.from)) {
    content = content.replace(r.from, r.to);
    replaced++;
  } else {
    console.log('Not found:', r.from);
  }
});

fs.writeFileSync('server.js', content);
console.log('Successfully replaced', replaced, 'endpoints.');
