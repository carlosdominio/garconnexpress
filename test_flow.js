const http = require('http');

async function req(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3005,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    const request = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data: data });
      });
    });
    request.on('error', (e) => reject(e));
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function runTests() {
  console.log('[1] Verificando se a API está online...');
  const diag = await req('/api/caixa/status');
  console.log('Status do Caixa:', diag.status, diag.data);
  
  if (diag.data === 'null' || !diag.data.includes('aberto')) {
      console.log('[2] Abrindo Caixa para o teste...');
      const abrir = await req('/api/caixa/abrir', 'POST', { valor_inicial: 100 });
      console.log('Caixa aberto:', abrir.data);
  } else {
      console.log('[2] Caixa já estava aberto.');
  }

  console.log('[3] Buscando Cardapio...');
  const menu = await req('/api/menu');
  let menuItens = [];
  try { menuItens = JSON.parse(menu.data); } catch(e){}
  console.log('Itens no cardápio:', menuItens.length);
  
  if (menuItens.length === 0) {
      console.log('Sem itens no cardápio para testar pedidos.');
      return;
  }
  
  console.log('[4] Criando pedido fake...');
  const pedido = {
    mesa_id: 999, // Mesa fake de delivery
    itens: [ { id: menuItens[0].id, quantidade: 1, preco: menuItens[0].preco || 10, observacao: 'TESTE AUTOMATIZADO' } ],
    forma_pagamento: 'pix',
    valor_recebido: 10,
    cobrar_taxa: false,
    observacao: 'Pedido de teste de homologação'
  };
  
  const resPedido = await req('/api/pedidos', 'POST', pedido);
  console.log('Status Criação Pedido:', resPedido.status);
  console.log('Resposta Pedido:', resPedido.data);

  console.log('[TESTE FINALIZADO]');
}
runTests().catch(console.error);
