let pedidos = [];
const PUSHER_APP_KEY = 'c4a9b50fe10859f2107a';
const PUSHER_CLUSTER = 'sa1';

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM carregado');
  carregarPedidos();
  configurarPusher();
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

function configurarPusher() {
  const pusher = new Pusher(PUSHER_APP_KEY, {
    cluster: PUSHER_CLUSTER,
    encrypted: true,
    activity_timeout: 60000,
    pong_timeout: 30000,
    reconnectionDelay: 5000,
    reconnectionAttempts: Infinity
  });

  const channel = pusher.subscribe('pedidos');

  channel.bind('novo-pedido', (pedido) => {
    console.log('Novo pedido recebido:', pedido);
    carregarPedidos();
    alert('Novo pedido recebido!');
  });

  pusher.connection.bind('connected', () => {
    console.log('Pusher conectado');
  });

  pusher.connection.bind('disconnected', () => {
    console.log('Pusher desconectado');
  });

  pusher.connection.bind('reconnecting', () => {
    console.log('Pusher reconectando...');
  });

  pusher.connection.bind('reconnected', () => {
    console.log('Pusher reconectado');
  });

  pusher.connection.bind('error', (error) => {
    console.error('Erro do Pusher:', error);
  });
}
