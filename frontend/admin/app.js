let pedidos = [];
let lastUpdateTime = 0;
const POLLING_INTERVAL = 2000;

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM carregado');
  carregarPedidos();
  startPolling();
});

async function carregarPedidos() {
  const res = await fetch('/api/pedidos');
  const novosPedidos = await res.json();
  
  if (JSON.stringify(pedidos) !== JSON.stringify(novosPedidos)) {
    pedidos = novosPedidos;
    exibirPedidos();
    console.log('Pedidos atualizados');
  }
  
  lastUpdateTime = Date.now();
}

async function exibirPedidos() {
  const container = document.getElementById('pedidos-list');
  container.innerHTML = '';

  for (const pedido of pedidos.filter(p => p.status !== 'entregue')) {
    const itens = await fetch(`/api/pedidos/${pedido.id}/itens`).then(res => res.json());
    container.innerHTML += `
      <div class="pedido-card" data-id="${pedido.id}">
        <div class="pedido-header">
          <h3>Mesa ${pedido.mesa_numero}</h3>
          <p>Status: ${pedido.status}</p>
        </div>
        <div class="pedido-itens">
          ${itens.map(item => `
            <div class="pedido-item">
              <p>${item.nome} (x${item.quantidade})</p>
              ${item.observacao ? `<p>Observação: ${item.observacao}</p>` : ''}
            </div>
          `).join('')}
        </div>
        <div class="pedido-actions">
          ${pedido.status === 'recebido' ? `<button class="preparando" onclick="atualizarStatus(${pedido.id}, 'preparando')">Preparando</button>` : ''}
          ${pedido.status === 'preparando' ? `<button class="pronto" onclick="atualizarStatus(${pedido.id}, 'pronto')">Pronto</button>` : ''}
          ${pedido.status === 'pronto' ? `<button class="entregue" onclick="atualizarStatus(${pedido.id}, 'entregue')">Entregue</button>` : ''}
        </div>
      </div>
    `;
  }
}

async function atualizarStatus(id, status) {
  await fetch(`/api/pedidos/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  carregarPedidos();
}

function startPolling() {
  setInterval(() => {
    carregarPedidos();
  }, POLLING_INTERVAL);
  console.log('Polling iniciado a cada', POLLING_INTERVAL, 'ms');
}
