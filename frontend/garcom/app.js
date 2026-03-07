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
    const telaLogin = document.getElementById('tela-login');
    if (telaLogin) telaLogin.style.display = 'none';
    const nomeExib = document.getElementById('garcom-nome-exibicao');
    if (nomeExib) nomeExib.textContent = `Garçom: ${garcomLogado.nome}`;
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
    location.reload();
  } else alert("Usuário ou senha incorretos");
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

let timeoutPusher = null;
function configurarPusher() {
  const pusher = new Pusher('c4a9b50fe10859f2107a', { cluster: 'sa1' });
  const channel = pusher.subscribe('garconnexpress');
  
  channel.bind('novo-pedido', (data) => {
    console.log('NOVO PEDIDO RECEBIDO:', data);
    clearTimeout(timeoutPusher);
    timeoutPusher = setTimeout(() => carregarMesas(), 500);
  });

  channel.bind('status-atualizado', (data) => {
    console.log('STATUS ATUALIZADO RECEBIDO:', data);
    clearTimeout(timeoutPusher);
    timeoutPusher = setTimeout(() => carregarMesas(), 500);
    if (!data) return;
    const nMesa = data.mesa_numero || data.mesa_id || 'X';
    if (data.status === 'liberada') mostrarToast(`✅ Mesa ${nMesa} liberada`);
    if (data.status === 'itens_atualizados') mostrarToast(`📝 Pedido da Mesa ${nMesa} atualizado pelo Admin`);
    if (data.status === 'cancelado') mostrarToast(`❌ Pedido da Mesa ${nMesa} CANCELADO pelo Admin`);
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
    }, 4000);
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

async function iniciarApp() {
  await carregarMenu();
  await carregarMesas();
  configurarEventos();
  configurarPusher();

  // Atualiza o cronômetro a cada minuto
  setInterval(() => {
    exibirMesas();
  }, 60000);
}

function calcularMinutos(dataIso) {
  if (!dataIso) return 0;
  const data = new Date(dataIso.replace(' ', 'T'));
  const agora = new Date();
  const diffMs = agora - data;
  return Math.floor(diffMs / 60000);
}

function exibirMesas() {
  const grid = document.getElementById('mesas-grid');
  if (!grid) return;

  grid.innerHTML = mesas.map(mesa => {
    let cronometroHtml = '';
    let classeAlerta = '';

    if (mesa.status === 'ocupada' && mesa.pedido_created_at) {
      const minutos = calcularMinutos(mesa.pedido_created_at);
      cronometroHtml = `<div class="cronometro">⏱️ ${minutos} min</div>`;
      if (minutos >= 10) classeAlerta = 'alerta-atraso';
    }

    return `
      <div class="mesa ${mesa.status} ${classeAlerta}" data-id="${mesa.id}">
        <h3>Mesa ${mesa.numero}</h3>
        <p>${mesa.status.toUpperCase()}</p>
        ${cronometroHtml}
      </div>
    `;
  }).join('');

  document.querySelectorAll('.mesa').forEach(mesa => {
    mesa.addEventListener('click', async () => {
      const mesaSelecionada = mesas.find(m => m.id == mesa.dataset.id);
      mesaAtual = mesaSelecionada;
      if (mesaSelecionada.status === 'ocupada') mostrarOpcoesMesa(mesaSelecionada);
      else { pedidoAbertoNaMesa = null; abrirCardapio(); }
    });
  });
}

async function mostrarOpcoesMesa(mesa) {
  const res = await fetch(`/api/pedidos/mesa/${mesa.id}`);
  pedidoAbertoNaMesa = await res.json();
  if (!pedidoAbertoNaMesa) {
    alert("Erro: Mesa ocupada sem pedido. Liberando...");
    await fetch(`/api/mesas/${mesa.id}/liberar`, { method: 'PUT' });
    return carregarMesas();
  }
  document.getElementById('modal-mesa-titulo').textContent = `Mesa ${mesa.numero}`;
  document.getElementById('modal-opcoes').style.display = 'block';
}

async function verItensDaMesa() {
  if (!mesaAtual) return;
  try {
    const resPedido = await fetch(`/api/pedidos/mesa/${mesaAtual.id}`);
    pedidoAbertoNaMesa = await resPedido.json();
    if (!pedidoAbertoNaMesa) return alert("Nenhum pedido ativo.");
    const resItens = await fetch(`/api/pedidos/${pedidoAbertoNaMesa.id}/itens`);
    const itens = await resItens.json();
    
    const pendentes = itens.filter(i => i.status === 'pendente');
    const entregues = itens.filter(i => i.status === 'entregue');

    let html = '';
    if (pendentes.length > 0) {
      html += `<h4 style="color:#e74c3c; margin-bottom:10px; border-bottom:2px solid #e74c3c;">⏳ PARA ENTREGAR AGORA</h4>`;
      html += pendentes.map(item => `
        <div style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; background:#fff5f5;">
          <div><p><strong>${item.quantidade}x ${item.nome}</strong></p>${item.observacao ? `<small style="color:#e67e22;">Obs: ${item.observacao}</small>` : ''}</div>
          <p>R$ ${(item.preco * item.quantidade).toFixed(2)}</p>
        </div>
      `).join('');
      html += `<button class="btn-opcoes" onclick="marcarComoServido(${pedidoAbertoNaMesa.id})" style="background-color: #27ae60; margin: 1rem 0;">🚚 ENTREGUEI ESTES ITENS</button>`;
    }

    if (entregues.length > 0) {
      html += `<h4 style="color:#27ae60; margin: 20px 0 10px 0; border-bottom:2px solid #27ae60;">✅ JÁ ESTÃO NA MESA</h4>`;
      html += entregues.map(item => `
        <div style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; opacity:0.7;">
          <div><p>${item.quantidade}x ${item.nome}</p></div>
          <p>R$ ${(item.preco * item.quantidade).toFixed(2)}</p>
        </div>
      `).join('');
    }

    const lista = document.getElementById('lista-itens-mesa');
    lista.innerHTML = html || '<p>Nenhum item no pedido.</p>';

    const totalEntregue = entregues.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const totalPendente = pendentes.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);

    document.getElementById('total-resumo-mesa').innerHTML = `
      <div style="text-align: right; border-top: 2px solid #eee; padding-top: 10px;">
        <p style="color: #27ae60; font-size: 1rem;">✅ Consumido (Na Mesa): <strong>R$ ${totalEntregue.toFixed(2)}</strong></p>
        ${totalPendente > 0 ? `<p style="color: #e74c3c; font-size: 0.9rem;">⏳ Pendente de Entrega: <strong>R$ ${totalPendente.toFixed(2)}</strong></p>` : ''}
        <p style="font-size: 1.2rem; margin-top: 5px; color: #2c3e50;">Total Geral: <strong>R$ ${(totalEntregue + totalPendente).toFixed(2)}</strong></p>
      </div>
    `;
    
    document.getElementById('resumo-mesa-titulo').textContent = `Resumo - Mesa ${mesaAtual.numero}`;
    
    fecharOpcoes();
    document.getElementById('modal-resumo-mesa').style.display = 'block';
  } catch (error) { alert("Erro ao carregar dados."); }
}

async function marcarComoServido(idPedido) {
  if (!confirm("Confirmar entrega dos itens pendentes?")) return;
  try {
    const res = await fetch(`/api/pedidos/${idPedido}/marcar-entregue`, { method: 'PUT' });
    if (res.ok) {
      alert("Sucesso! O Admin foi notificado.");
      document.getElementById('modal-resumo-mesa').style.display = 'none';
      carregarMesas();
    }
  } catch (error) { alert("Erro ao atualizar."); }
}

function fecharResumoMesa() {
  document.getElementById('modal-resumo-mesa').style.display = 'none';
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
  const mesaTxt = document.getElementById('mesa-atual');
  if (mesaTxt) mesaTxt.textContent = pedidoAbertoNaMesa ? `${mesaAtual.numero} (+ itens)` : mesaAtual.numero;
  
  // Resetar visual das categorias para "Todas"
  document.querySelectorAll('.categoria').forEach(c => {
    c.classList.toggle('ativa', c.dataset.categoria === 'todas');
  });

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
    alert("Solicitação enviada!");
    fecharOpcoes();
    carregarMesas();
  }
}

function exibirMenu(categoria) {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;
  
  // Se for chamado sem categoria, tenta pegar a visualmente ativa
  if (!categoria) {
    const elAtivo = document.querySelector('.categoria.ativa');
    categoria = elAtivo ? elAtivo.dataset.categoria : 'todas';
  }

  const itens = categoria === 'todas' ? menu : menu.filter(item => item.categoria === categoria);
  grid.innerHTML = itens.map(item => {
    const itemNoPedido = pedidoAtual.find(p => p.menu_id === item.id);
    const qtdBadge = itemNoPedido ? `<div class="badge-qtd">${itemNoPedido.quantidade}</div>` : '';
    return `<div class="item-menu" data-id="${item.id}">${qtdBadge}<img src="${item.imagem}" alt="${item.nome}"><h3>${item.nome}</h3><p>R$ ${item.preco.toFixed(2)}</p></div>`;
  }).join('');
  document.querySelectorAll('.item-menu').forEach(item => {
    item.addEventListener('click', () => {
      const menuItem = menu.find(m => m.id == item.dataset.id);
      adicionarItemPedido(menuItem);
      exibirMenu(categoria);
    });
  });
}

function adicionarItemPedido(item) {
  const existing = pedidoAtual.find(p => p.menu_id === item.id);
  if (existing) existing.quantidade++;
  else pedidoAtual.push({ menu_id: item.id, nome: item.nome, preco: item.preco, quantidade: 1, observacao: '' });
  exibirResumoPedido();
}

function exibirResumoPedido() {
  const container = document.getElementById('itens-pedido');
  if (!container) return;
  container.innerHTML = pedidoAtual.map((item, index) => `
    <div class="item-pedido">
      <div style="flex-grow: 1; padding-right: 10px;">
        <p><strong>${item.nome}</strong></p>
        <input type="text" placeholder="Obs..." value="${item.observacao}" onchange="pedidoAtual[${index}].observacao = this.value">
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
    const catAtiva = document.querySelector('.categoria.ativa').dataset.categoria;
    exibirMenu(catAtiva);
  } else removerItemPedido(index);
}

function removerItemPedido(index) {
  pedidoAtual.splice(index, 1);
  exibirResumoPedido();
  const catAtiva = document.querySelector('.categoria.ativa').dataset.categoria;
  exibirMenu(catAtiva);
}

async function enviarPedido() {
  if (pedidoAtual.length === 0) return alert('Adicione pelo menos um item');
  try {
    const url = pedidoAbertoNaMesa ? `/api/pedidos/${pedidoAbertoNaMesa.id}/adicionar` : '/api/pedidos';
    const res = await fetch(url, {
      method: pedidoAbertoNaMesa ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesa_id: mesaAtual.id, garcom_id: garcomLogado ? garcomLogado.nome : 'garcom-desconhecido', itens: pedidoAtual })
    });
    if (res.ok) {
      alert(pedidoAbertoNaMesa ? 'Itens adicionados!' : 'Pedido enviado!');
      pedidoAtual = [];
      pedidoAbertoNaMesa = null;
      document.getElementById('pedido').classList.add('hidden');
      document.getElementById('mesas').classList.remove('hidden');
      carregarMesas();
    }
  } catch (error) { alert('Erro ao enviar pedido'); }
}

function configurarEventos() {
  document.getElementById('enviar-pedido').addEventListener('click', enviarPedido);
  document.getElementById('voltar-mesas').addEventListener('click', () => {
    document.getElementById('pedido').classList.add('hidden');
    document.getElementById('mesas').classList.remove('hidden');
  });
  const categorias = ['todas', ...new Set(menu.map(item => item.categoria))];
  const container = document.getElementById('categorias');
  if (container) {
    container.innerHTML = categorias.map(cat => `<div class="categoria ${cat === 'todas' ? 'ativa' : ''}" data-categoria="${cat}">${cat === 'todas' ? 'Todos' : cat}</div>`).join('');
    document.querySelectorAll('.categoria').forEach(cat => {
      cat.addEventListener('click', () => {
        document.querySelectorAll('.categoria').forEach(c => c.classList.remove('ativa'));
        cat.classList.add('ativa');
        exibirMenu(cat.dataset.categoria);
      });
    });
  }
}
