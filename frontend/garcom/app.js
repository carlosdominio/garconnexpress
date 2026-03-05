let menu = [];
let mesas = [];
let mesaAtual = null;
let pedidoAtual = [];
let pedidoAbertoNaMesa = null;
let garcomLogado = null;

document.addEventListener('DOMContentLoaded', async () => {
  verificarSessao();
});

function verificarSessao() {
  const salvo = localStorage.getItem('garcom_logado');
  if (salvo) {
    garcomLogado = JSON.parse(salvo);
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('garcom-nome-exibicao').textContent = `Garçom: ${garcomLogado.nome}`;
    iniciarApp();
  }
}

async function realizarLogin() {
  const usuario = document.getElementById('login-usuario').value;
  const senha = document.getElementById('login-senha').value;
  
  if (!usuario || !senha) return alert("Preencha todos os campos");

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });

  if (res.ok) {
    const data = await res.json();
    garcomLogado = data.garcom;
    localStorage.setItem('garcom_logado', JSON.stringify(garcomLogado));
    location.reload(); // Recarregar para iniciar tudo limpo
  } else {
    alert("Usuário ou senha incorretos");
  }
}

function logout() {
  localStorage.removeItem('garcom_logado');
  location.reload();
}

async function iniciarApp() {
  await carregarMenu();
  await carregarMesas();
  configurarEventos();
  configurarPusher();
}

function configurarPusher() {
  const pusher = new Pusher('c4a9b50fe10859f2107a', { cluster: 'sa1' });
  const channel = pusher.subscribe('garconnexpress');
  
  channel.bind('novo-pedido', () => carregarMesas());
  
  channel.bind('status-atualizado', (data) => {
    carregarMesas();
    
    // Se a mesa foi liberada pelo admin
    if (data && data.status === 'liberada') {
      mostrarToast(`✅ Mesa- ${data.mesa_id} - liberada`);
    }
  });
}

function mostrarToast(mensagem) {
  const toastExistente = document.querySelector('.toast-notificacao');
  if (toastExistente) toastExistente.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notificacao';
  toast.innerText = mensagem;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 500);
    }, 4000); // 4 segundos para o garçom ver
  }, 100);
}

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
      <p>${mesa.status.toUpperCase()}</p>
    </div>
  `).join('');

  document.querySelectorAll('.mesa').forEach(mesa => {
    mesa.addEventListener('click', async () => {
      const mesaSelecionada = mesas.find(m => m.id == mesa.dataset.id);
      mesaAtual = mesaSelecionada;
      
      if (mesaSelecionada.status === 'ocupada') {
        mostrarOpcoesMesa(mesaSelecionada);
      } else {
        pedidoAbertoNaMesa = null;
        abrirCardapio();
      }
    });
  });
}

async function mostrarOpcoesMesa(mesa) {
  const res = await fetch(`/api/pedidos/mesa/${mesa.id}`);
  pedidoAbertoNaMesa = await res.json();
  
  if (!pedidoAbertoNaMesa) {
    alert("Erro: Mesa marcada como ocupada mas sem pedido ativo. Liberando...");
    await fetch(`/api/mesas/${mesa.id}/liberar`, { method: 'PUT' });
    return carregarMesas();
  }

  document.getElementById('modal-mesa-titulo').textContent = `Mesa ${mesa.numero}`;
  document.getElementById('modal-opcoes').style.display = 'block';
}

function fecharOpcoes() {
  document.getElementById('modal-opcoes').style.display = 'none';
}

function abrirCardapioAdicionar() {
  fecharOpcoes();
  abrirCardapio();
}

function abrirCardapio() {
  document.getElementById('mesa-atual').textContent = pedidoAbertoNaMesa ? `${mesaAtual.numero} (+ itens)` : mesaAtual.numero;
  document.getElementById('mesas').classList.add('hidden');
  document.getElementById('pedido').classList.remove('hidden');
  pedidoAtual = [];
  exibirResumoPedido();
  exibirMenu('todas');
}

async function finalizarEDesocupar() {
  if (confirm(`Solicitar fechamento da Mesa ${mesaAtual.numero}?`)) {
    await fetch(`/api/pedidos/${pedidoAbertoNaMesa.id}/solicitar-fechamento`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesa_id: mesaAtual.id })
    });

    alert("Solicitação enviada ao Admin. Aguarde a liberação da mesa.");
    fecharOpcoes();
    carregarMesas();
  }
}

function exibirMenu(categoria) {
  const grid = document.getElementById('menu-grid');
  const itens = categoria === 'todas' ? menu : menu.filter(item => item.categoria === categoria);
  
  grid.innerHTML = itens.map(item => {
    // Verificar se o item já está no pedido para mostrar a quantidade
    const itemNoPedido = pedidoAtual.find(p => p.menu_id === item.id);
    const qtdBadge = itemNoPedido ? `<div class="badge-qtd">${itemNoPedido.quantidade}</div>` : '';

    return `
      <div class="item-menu" data-id="${item.id}">
        ${qtdBadge}
        <img src="${item.imagem}" alt="${item.nome}">
        <h3>${item.nome}</h3>
        <p>R$ ${item.preco.toFixed(2)}</p>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.item-menu').forEach(item => {
    item.addEventListener('click', () => {
      const menuItem = menu.find(m => m.id == item.dataset.id);
      adicionarItemPedido(menuItem);
      // Re-renderiza o menu para atualizar o badge sem perder o scroll
      exibirMenu(categoria);
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
      <div style="flex-grow: 1; padding-right: 10px;">
        <p><strong>${item.nome}</strong></p>
        <input type="text" placeholder="Obs..." value="${item.observacao}" 
          onchange="pedidoAtual[${index}].observacao = this.value">
      </div>
      <div class="controle-qtd-container">
        <div class="seletor-qtd">
          <button class="btn-qtd" onclick="alterarQuantidadeItem(${index}, -1)">-</button>
          <span class="valor-qtd">${item.quantidade}</span>
          <button class="btn-qtd" onclick="alterarQuantidadeItem(${index}, 1)">+</button>
        </div>
        <p class="subtotal-item">R$ ${(item.preco * item.quantidade).toFixed(2)}</p>
        <button class="btn-remover-item" onclick="removerItemPedido(${index})">Remover</button>
      </div>
    </div>
  `).join('');

  const total = pedidoAtual.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
  document.getElementById('total-pedido').textContent = `Total: R$ ${total.toFixed(2)}`;
}

function alterarQuantidadeItem(index, delta) {
  const novoValor = pedidoAtual[index].quantidade + delta;
  if (novoValor > 0) {
    pedidoAtual[index].quantidade = novoValor;
    exibirResumoPedido();
    // Atualiza os badges no menu também
    const catAtiva = document.querySelector('.categoria.ativa').dataset.categoria;
    exibirMenu(catAtiva);
  } else {
    removerItemPedido(index);
  }
}

function removerItemPedido(index) {
  pedidoAtual.splice(index, 1);
  exibirResumoPedido();
  // Atualiza o menu para remover o badge se necessário
  const catAtiva = document.querySelector('.categoria.ativa').dataset.categoria;
  exibirMenu(catAtiva);
}

async function enviarPedido() {
  if (pedidoAtual.length === 0) return alert('Adicione pelo menos um item');

  try {
    const url = pedidoAbertoNaMesa ? `/api/pedidos/${pedidoAbertoNaMesa.id}/adicionar` : '/api/pedidos';
    const method = pedidoAbertoNaMesa ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mesa_id: mesaAtual.id,
        garcom_id: garcomLogado ? garcomLogado.nome : 'garcom-desconhecido',
        itens: pedidoAtual
      })
    });

    if (res.ok) {
      alert(pedidoAbertoNaMesa ? 'Itens adicionados ao pedido!' : 'Pedido enviado!');
      pedidoAtual = [];
      pedidoAbertoNaMesa = null;
      document.getElementById('pedido').classList.add('hidden');
      document.getElementById('mesas').classList.remove('hidden');
      carregarMesas();
    }
  } catch (error) {
    alert('Erro ao enviar pedido');
  }
}

function configurarEventos() {
  document.getElementById('enviar-pedido').addEventListener('click', enviarPedido);
  document.getElementById('voltar-mesas').addEventListener('click', () => {
    document.getElementById('pedido').classList.add('hidden');
    document.getElementById('mesas').classList.remove('hidden');
  });

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
}