let pedidos = [];
const PUSHER_APP_KEY = 'c4a9b50fe10859f2107a';
const PUSHER_CLUSTER = 'sa1';

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM carregado');
  carregarPedidos();
  configurarPusher();
});

async function carregarPedidos() {
  console.log('Carregando pedidos...');
  try {
    const res = await fetch('/api/pedidos');
    if (!res.ok) {
      console.error('Erro na API:', res.status, res.statusText);
      return;
    }
    pedidos = await res.json();
    console.log('Pedidos carregados:', pedidos);
    exibirPedidos();
  } catch (error) {
    console.error('Erro ao carregar pedidos:', error);
  }
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
  console.log('Atualizando status:', id, status);
  try {
    const res = await fetch(`/api/pedidos/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      console.error('Erro ao atualizar status:', res.status, res.statusText);
      return;
    }
    carregarPedidos();
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
  }
}

function configurarPusher() {
  try {
    console.log('Configurando Pusher...');
    const pusher = new Pusher(PUSHER_APP_KEY, {
      cluster: PUSHER_CLUSTER,
      encrypted: true
    });

    console.log('Pusher instanciado:', pusher);

    const channel = pusher.subscribe('pedidos');
    console.log('Canal pedidos inscrito');

    channel.bind('novo-pedido', (pedido) => {
      console.log('Evento novo-pedido recebido:', pedido);
      carregarPedidos();
      alert('Novo pedido recebido!');
    });

    channel.bind('pusher:subscription_error', (error) => {
      console.error('Erro de assinatura:', error);
    });

    channel.bind('pusher:subscription_succeeded', () => {
      console.log('Assinatura bem-sucedida');
    });

    channel.bind('pusher:error', (error) => {
      console.error('Erro do Pusher:', error);
    });

    console.log('Pusher configurado com sucesso');
  } catch (error) {
    console.error('Erro ao configurar Pusher:', error);
  }
}
