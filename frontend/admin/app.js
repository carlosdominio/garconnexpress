let pedidos = [];

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM carregado');
  carregarPedidos();
  configurarSocket();
});

async function carregarPedidos() {
  const res = await fetch('/api/pedidos');
  pedidos = await res.json();
  exibirPedidos();
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

function configurarSocket() {
  const socket = io({
    transports: ['polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    console.log('Socket conectado');
  });

  socket.on('disconnect', () => {
    console.log('Socket desconectado');
  });

  socket.on('reconnect', () => {
    console.log('Socket reconectado');
  });

  socket.on('novo-pedido', (pedido) => {
    console.log('Novo pedido recebido:', pedido);
    carregarPedidos();
    alert('Novo pedido recebido!');
  });

  socket.on('connect_error', (error) => {
    console.error('Erro de conexão:', error);
  });

  socket.on('error', (error) => {
    console.error('Erro do socket:', error);
  });
}
