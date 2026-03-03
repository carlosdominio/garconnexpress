let menu = [];
let mesas = [];
let mesaAtual = null;
let pedidoAtual = [];

document.addEventListener('DOMContentLoaded', async () => {
  await carregarMenu();
  await carregarMesas();
  configurarEventos();
});

async function carregarMenu() {
  const res = await fetch('/api/menu');
  menu = await res.json();
  exibirMenu('todas');
}

async function carregarMesas() {
  const res = await fetch('/api/mesas');
  mesas = await res.json();
  exibirMesas();
}

function exibirMesas() {
  const grid = document.getElementById('mesas-grid');
  grid.innerHTML = mesas.map(mesa => `
    <div class="mesa ${mesa.status}" data-id="${mesa.id}">
      <h3>Mesa ${mesa.numero}</h3>
      <p>${mesa.status}</p>
    </div>
  `).join('');

  document.querySelectorAll('.mesa').forEach(mesa => {
    mesa.addEventListener('click', () => {
      mesaAtual = mesas.find(m => m.id == mesa.dataset.id);
      document.getElementById('mesa-atual').textContent = mesaAtual.numero;
      document.getElementById('mesas').classList.add('hidden');
      document.getElementById('pedido').classList.remove('hidden');
      exibirMenu('todas');
    });
  });
}

function exibirMenu(categoria) {
  const grid = document.getElementById('menu-grid');
  const itens = categoria === 'todas' ? menu : menu.filter(item => item.categoria === categoria);
  grid.innerHTML = itens.map(item => `
    <div class="item-menu" data-id="${item.id}">
      <img src="${item.imagem}" alt="${item.nome}">
      <h3>${item.nome}</h3>
      <p>R$ ${item.preco.toFixed(2)}</p>
    </div>
  `).join('');

  document.querySelectorAll('.item-menu').forEach(item => {
    item.addEventListener('click', () => {
      const menuItem = menu.find(m => m.id == item.dataset.id);
      adicionarItemPedido(menuItem);
    });
  });
}

function adicionarItemPedido(item) {
  const existing = pedidoAtual.find(p => p.menu_id === item.id);
  if (existing) {
    existing.quantidade++;
  } else {
    pedidoAtual.push({
      menu_id: item.id,
      nome: item.nome,
      preco: item.preco,
      quantidade: 1,
      observacao: ''
    });
  }
  exibirResumoPedido();
}

function exibirResumoPedido() {
  const container = document.getElementById('itens-pedido');
  container.innerHTML = pedidoAtual.map((item, index) => `
    <div class="item-pedido">
      <div>
        <p>${item.nome} (x${item.quantidade})</p>
        <input type="text" placeholder="Observação" value="${item.observacao}" 
          onchange="pedidoAtual[${index}].observacao = this.value">
      </div>
      <div>
        <p>R$ ${(item.preco * item.quantidade).toFixed(2)}</p>
        <button onclick="removerItemPedido(${index})">Remover</button>
      </div>
    </div>
  `).join('');

  const total = pedidoAtual.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
  document.getElementById('total-pedido').textContent = `Total: R$ ${total.toFixed(2)}`;
}

function removerItemPedido(index) {
  pedidoAtual.splice(index, 1);
  exibirResumoPedido();
}

async function enviarPedido() {
  if (pedidoAtual.length === 0) return alert('Adicione pelo menos um item');

  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mesa_id: mesaAtual.id,
        garcom_id: 'garcom-1',
        itens: pedidoAtual
      })
    });

    if (res.ok) {
      alert('Pedido enviado!');
      pedidoAtual = [];
      exibirResumoPedido();
      document.getElementById('pedido').classList.add('hidden');
      document.getElementById('mesas').classList.remove('hidden');
      carregarMesas();
    } else {
      const error = await res.json();
      alert('Erro: ' + (error.error || 'Erro desconhecido'));
    }
  } catch (error) {
    console.error('Erro:', error);
    alert('Erro de conexão com o servidor');
  }
}

function configurarEventos() {
  const categorias = ['todas', ...new Set(menu.map(item => item.categoria))];
  const container = document.getElementById('categorias');
  container.innerHTML = categorias.map(cat => `
    <div class="categoria ${cat === 'todas' ? 'ativa' : ''}" data-categoria="${cat}">
      ${cat === 'todas' ? 'Todos' : cat}
    </div>
  `).join('');

  document.querySelectorAll('.categoria').forEach(cat => {
    cat.addEventListener('click', () => {
      document.querySelectorAll('.categoria').forEach(c => c.classList.remove('ativa'));
      cat.classList.add('ativa');
      exibirMenu(cat.dataset.categoria);
    });
  });

  document.getElementById('enviar-pedido').addEventListener('click', enviarPedido);
  document.getElementById('voltar-mesas').addEventListener('click', () => {
    document.getElementById('pedido').classList.add('hidden');
    document.getElementById('mesas').classList.remove('hidden');
  });
}
