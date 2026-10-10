  // --- Lógica de parse para pagamento/troco ---
  let exibForma = pedido.forma_pagamento || '';
  let valRecExib = pedido.valor_recebido ? Number(pedido.valor_recebido) : 0;
  let trocoCalcExib = pedido.troco ? Number(pedido.troco) : 0;

  const trocoMatchAdm = exibForma.match(/Dinheiro \(Troco para R\$ ([\d.]+)\)/);
  if (trocoMatchAdm) {
      exibForma = 'Dinheiro';
      if (!valRecExib) valRecExib = Number(trocoMatchAdm[1]);
  }
  
  if (!exibForma) exibForma = 'N/A';
  let isDinheiroExib = (exibForma === 'Dinheiro' || exibForma.toLowerCase().includes('dinheiro'));

  if (isDinheiroExib && valRecExib > 0 && trocoCalcExib === 0) {
      trocoCalcExib = Math.max(0, valRecExib - pagoAgora);
  }
  
  const exibirBlocoPagamento = (!isConferencia) || (pedido.forma_pagamento && pedido.forma_pagamento !== 'N/A');
  // --------------------------------------------
