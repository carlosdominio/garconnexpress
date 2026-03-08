let pedidos = [];
let cardapio = [];
let pedidoEmEdicao = null;
let itensEmEdicao = [];
let abaAtiva = 'ativos';
let adminLogado = null;
let caixaAtual = null;

const audioNotificacao = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
let audioDesbloqueado = false;
let intervalPiscaTitulo = null;
const tituloOriginal = "Admin - GarçomExpress";

document.addEventListener('DOMContentLoaded', () => {
  verificarSessaoAdmin();
  document.addEventListener('click', () => {
    if (!audioDesbloqueado) {
      audioNotificacao.play().then(() => {
        audioNotificacao.pause();
        audioNotificacao.currentTime = 0;
        audioDesbloqueado = true;
      }).catch(e => console.error(e));
    }
  }, { once: true });
});

function verificarSessaoAdmin() {
  const salvo = localStorage.getItem('admin_logado');
  if (salvo && salvo !== 'undefined') {
    try {
      adminLogado = JSON.parse(salvo);
      const telaLogin = document.getElementById('tela-login-admin');
      if (telaLogin) telaLogin.style.display = 'none';
      iniciarPainelAdmin();
    } catch (e) {
      console.error("Erro ao carregar sessão:", e);
      localStorage.removeItem('admin_logado');
    }
  }
}

async function realizarLoginAdmin() {
  const usuario = document.getElementById('admin-usuario').value;
  const senha = document.getElementById('admin-senha').value;
  if (!usuario || !senha) return alert("Preencha todos os campos");
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });
  if (res.ok) {
    const data = await res.json();
    adminLogado = data.admin;
    localStorage.setItem('admin_logado', JSON.stringify(adminLogado));
    location.reload();
  } else alert("Credenciais inválidas");
}

function logoutAdmin() {
  localStorage.removeItem('admin_logado');
  location.reload();
}

function iniciarPainelAdmin() {
  solicitarPermissaoNotificacao();
  carregarPedidos();
  carregarCardapio();
  carregarStatusCaixa();
  configurarPusher();
  window.addEventListener('focus', () => pararPiscarTitulo());
  
  // Listener para imprimir cupom parcial direto do modal de edição
  const btnImprimir = document.getElementById('btn-imprimir-edicao');
  if (btnImprimir) {
    btnImprimir.onclick = () => {
      if (pedidoEmEdicao && itensEmEdicao) {
        imprimirCupom(pedidoEmEdicao, itensEmEdicao);
      }
    };
  }

  // Atualiza os cronômetros a cada minuto no painel admin
  setInterval(() => {
    exibirPedidos();
  }, 60000);
}

function mudarQtdItem(index, qtd) { 
  const novaQtd = parseInt(qtd);
  const itemNoPedido = itensEmEdicao[index];
  const itemNoMenu = cardapio.find(m => m.id === itemNoPedido.menu_id);

  if (novaQtd > itemNoPedido.quantidade && itemNoMenu && itemNoMenu.estoque !== -1) {
    if (novaQtd > itemNoMenu.estoque + itemNoPedido.quantidade) {
      alert(`Estoque insuficiente! Você pode adicionar no máximo mais ${itemNoMenu.estoque} unidades deste item.`);
      renderizarItensEdicao();
      return;
    }
  }

  if (novaQtd > 0) {
    itensEmEdicao[index].quantidade = novaQtd; 
    renderizarItensEdicao(); 
  }
}

function removerItemEdicao(index) { 
  itensEmEdicao.splice(index, 1); 
  renderizarItensEdicao(); 
}

function calcularMinutos(dataIso) {
  if (!dataIso) return 0;
  const isoStr = dataIso.replace(' ', 'T');
  const data = new Date(isoStr);
  const agora = new Date();
  const diffMs = agora - data;
  return Math.floor(diffMs / 60000);
}

function switchTab(tab) {
  abaAtiva = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');
  const secoes = ['ativos', 'historico', 'configuracoes', 'caixa'];
  secoes.forEach(s => {
    const el = document.getElementById(`${s}-section`);
    if (el) el.classList.toggle('hidden', s !== tab);
  });
  if (tab === 'ativos') carregarPedidos();
  else if (tab === 'historico') carregarHistorico();
  else if (tab === 'configuracoes') carregarDadosConfig();
  else if (tab === 'caixa') carregarStatusCaixa();
}

async function carregarStatusCaixa() {
  const res = await fetch('/api/caixa/status');
  caixaAtual = await res.json();
  
  const fechadoView = document.getElementById('caixa-fechado-view');
  const abertoView = document.getElementById('caixa-aberto-view');
  
  if (caixaAtual) {
    fechadoView.classList.add('hidden');
    abertoView.classList.remove('hidden');
    
    document.getElementById('resumo-caixa-inicial').innerText = `R$ ${caixaAtual.valor_inicial.toFixed(2)}`;
    document.getElementById('resumo-caixa-vendas').innerText = `R$ ${caixaAtual.total_vendas.toFixed(2)}`;
    document.getElementById('resumo-caixa-dinheiro').innerText = `R$ ${(caixaAtual.valor_inicial + caixaAtual.total_dinheiro).toFixed(2)}`;
    
    document.getElementById('detalhe-caixa-dinheiro').innerText = `R$ ${caixaAtual.total_dinheiro.toFixed(2)}`;
    document.getElementById('detalhe-caixa-pix').innerText = `R$ ${caixaAtual.total_pix.toFixed(2)}`;
    document.getElementById('detalhe-caixa-cartao').innerText = `R$ ${caixaAtual.total_cartao.toFixed(2)}`;
  } else {
    fechadoView.classList.remove('hidden');
    abertoView.classList.add('hidden');
  }
}

async function abrirCaixa() {
  const valor = parseFloat(document.getElementById('caixa-valor-inicial').value) || 0;
  const res = await fetch('/api/caixa/abrir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valor_inicial: valor })
  });
  if (res.ok) {
    mostrarToast("Caixa aberto com sucesso!");
    carregarStatusCaixa();
  }
}

async function confirmarFechamentoCaixa() {
  if (!confirm("Tem certeza que deseja FECHAR O CAIXA e encerrar o expediente?")) return;
  
  const valorFinal = caixaAtual.valor_inicial + caixaAtual.total_dinheiro + caixaAtual.total_pix + caixaAtual.total_cartao;
  
  const res = await fetch('/api/caixa/fechar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: caixaAtual.id, valor_final: valorFinal })
  });
  
  if (res.ok) {
    alert(`Caixa fechado!\nTotal de Vendas: R$ ${caixaAtual.total_vendas.toFixed(2)}\nDinheiro em Caixa: R$ ${(caixaAtual.valor_inicial + caixaAtual.total_dinheiro).toFixed(2)}`);
    carregarStatusCaixa();
  }
}

async function carregarDadosConfig() {
  await Promise.all([exibirMesasConfig(), exibirGarconsConfig(), exibirMenuConfig()]);
}

// MESAS
async function exibirMesasConfig() {
  const res = await fetch('/api/mesas');
  const mesas = await res.json();
  const container = document.getElementById('lista-mesas-config');
  if (!container) return;
  container.innerHTML = mesas.map(m => `<div class="item-config"><span>Mesa ${m.numero}</span><button class="btn-excluir" onclick="excluirMesa(${m.id})">Remover</button></div>`).join('');
}

async function adicionarMesa() {
  const num = document.getElementById('nova-mesa-num').value;
  if (!num) return;
  await fetch('/api/mesas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numero: parseInt(num) }) });
  document.getElementById('nova-mesa-num').value = '';
  exibirMesasConfig();
}

async function excluirMesa(id) {
  if (confirm("Remover mesa?")) { await fetch(`/api/mesas/${id}`, { method: 'DELETE' }); exibirMesasConfig(); }
}

// GARÇONS
let idGarcomEdicao = null;

async function exibirGarconsConfig() {
  const res = await fetch('/api/garcons');
  const garcons = await res.json();
  const container = document.getElementById('lista-garcons-config');
  if (!container) return;
  container.innerHTML = garcons.map(g => `
    <div class="item-config">
      <div><strong>${g.nome}</strong> (@${g.usuario})</div>
      <div style="display:flex; gap:0.5rem">
        <button style="background:#3498db; padding:4px 8px; font-size:0.8rem; width:auto;" onclick='prepararEdicaoGarcom(${JSON.stringify(g)})'>✏️</button>
        <button class="btn-excluir" style="width:auto;" onclick="excluirGarcom(${g.id})">X</button>
      </div>
    </div>`).join('');
}

function prepararEdicaoGarcom(g) {
  idGarcomEdicao = g.id;
  document.getElementById('garcom-nome').value = g.nome;
  document.getElementById('garcom-usuario').value = g.usuario;
  document.getElementById('garcom-senha').value = '';
  document.getElementById('garcom-senha').placeholder = 'Deixe em branco para manter';
  const btn = document.querySelector("button[onclick='adicionarGarcom()']");
  if (btn) btn.textContent = "💾 Salvar Alterações";
}

async function adicionarGarcom() {
  const nome = document.getElementById('garcom-nome').value;
  const usuario = document.getElementById('garcom-usuario').value;
  const senha = document.getElementById('garcom-senha').value;
  
  if (!nome || !usuario) return alert("Nome e usuário são obrigatórios");
  if (!idGarcomEdicao && !senha) return alert("A senha é obrigatória para novos cadastros");

  const url = idGarcomEdicao ? `/api/garcons/${idGarcomEdicao}` : '/api/garcons';
  const method = idGarcomEdicao ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, usuario, senha })
    });

    if (res.ok) {
      idGarcomEdicao = null;
      ['garcom-nome', 'garcom-usuario', 'garcom-senha'].forEach(id => {
        const el = document.getElementById(id);
        el.value = '';
        if (id === 'garcom-senha') el.placeholder = 'Senha';
      });
      const btn = document.querySelector("button[onclick='adicionarGarcom()']");
      if (btn) btn.textContent = "Cadastrar";
      exibirGarconsConfig();
    }
  } catch (e) { alert("Erro ao salvar garçom"); }
}

async function excluirGarcom(id) {
  if (confirm("Remover garçom?")) { await fetch(`/api/garcons/${id}`, { method: 'DELETE' }); exibirGarconsConfig(); }
}

// MENU
let idItemEdicaoMenu = null;
async function exibirMenuConfig() {
  const res = await fetch('/api/menu');
  const menuItens = await res.json();
  const container = document.getElementById('lista-menu-config');
  if (!container) return;
  container.innerHTML = menuItens.map(m => `
    <div class="menu-item-config" id="item-menu-${m.id}">
      <img src="${m.imagem}" alt="${m.nome}">
      <div style="flex-grow: 1;">
        <strong>${m.nome}</strong><br>
        <small>${m.categoria} - R$ ${m.preco.toFixed(2)}</small><br>
        <small style="color: ${m.estoque === 0 ? '#e74c3c' : '#27ae60'}; font-weight: bold;">
          Estoque: ${m.estoque === -1 ? 'Ilimitado' : m.estoque}
        </small>
      </div>
      <div style="display:flex; flex-direction:column; gap:0.2rem">
        <button style="background:#3498db; padding:4px 8px; font-size:0.8rem" onclick='prepararEdicaoMenu(${JSON.stringify(m)})'>✏️ Editar</button>
        <button class="btn-excluir" onclick="excluirDoMenu(${m.id})">Excluir</button>
      </div>
    </div>`).join('');
}

function prepararEdicaoMenu(item) {
  idItemEdicaoMenu = item.id;
  document.getElementById('menu-nome').value = item.nome;
  document.getElementById('menu-cat').value = item.categoria;
  document.getElementById('menu-preco').value = item.preco;
  document.getElementById('menu-estoque').value = item.estoque;
  document.getElementById('menu-img').value = item.imagem;
  document.getElementById('btn-acao-menu').textContent = "💾 Salvar";
  document.getElementById('btn-acao-menu').style.background = "#e67e22";
  document.getElementById('btn-cancelar-menu').classList.remove('hidden');
}

function cancelarEdicaoMenu() {
  idItemEdicaoMenu = null;
  ['menu-nome', 'menu-cat', 'menu-preco', 'menu-img', 'menu-estoque'].forEach(id => { const el = document.getElementById(id); if (el) el.value = (id === 'menu-estoque' ? '-1' : ''); });
  document.getElementById('btn-acao-menu').textContent = "Adicionar Item";
  document.getElementById('btn-acao-menu').style.background = "#27ae60";
  document.getElementById('btn-cancelar-menu').classList.add('hidden');
}

async function processarAcaoMenu() {
  const nome = document.getElementById('menu-nome').value;
  const categoria = document.getElementById('menu-cat').value;
  const preco = parseFloat(document.getElementById('menu-preco').value);
  const estoque = parseInt(document.getElementById('menu-estoque').value);
  const imagem = document.getElementById('menu-img').value || 'https://placehold.co/100';
  if (!nome || !categoria || isNaN(preco) || isNaN(estoque)) return alert("Preencha corretamente");
  const payload = { nome, categoria, preco, imagem, estoque };
  const res = await fetch(idItemEdicaoMenu ? `/api/menu/${idItemEdicaoMenu}` : '/api/menu', { method: idItemEdicaoMenu ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.ok) { mostrarToast("Menu atualizado!"); cancelarEdicaoMenu(); exibirMenuConfig(); }
}

async function excluirDoMenu(id) {
  if (confirm("Remover item?")) { await fetch(`/api/menu/${id}`, { method: 'DELETE' }); exibirMenuConfig(); }
}

async function carregarHistorico() {
  try {
    const elData = document.getElementById('data-historico');
    if (elData) elData.innerText = `(${new Date().toLocaleDateString('pt-BR')})`;
    
    const res = await fetch('/api/pedidos/historico');
    const historico = await res.json();
    exibirHistorico(historico);
  } catch (error) { console.error(error); }
}

function formatarData(dataStr) {
  if (!dataStr) return "S/ Data";
  try {
    const isoStr = dataStr.replace(' ', 'T');
    const data = new Date(isoStr);
    if (!isNaN(data.getTime())) return data.toLocaleDateString('pt-BR') + ' às ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return dataStr;
  } catch (e) { return dataStr; }
}

async function exibirHistorico(historico) {
  if (abaAtiva !== 'historico') return;
  const container = document.getElementById('historico-list');
  if (!container) return;
  container.innerHTML = '';
  let faturamentoTotal = 0;
  for (const pedido of historico) {
    if (pedido.status === 'entregue') faturamentoTotal += parseFloat(pedido.total);
    const itens = await fetch(`/api/pedidos/${pedido.id}/itens`).then(res => res.json());
    const card = document.createElement('div');
    card.className = `pedido-card status-${pedido.status}`;
    card.innerHTML = `
      <div class="pedido-header">
        <div>
          <h3>Mesa ${pedido.mesa_numero}</h3>
          <span class="status-badge ${pedido.status === 'entregue' ? 'pago' : 'cancelado'}">${pedido.status === 'entregue' ? 'PAGO' : pedido.status.toUpperCase()}</span>
          <small style="display:block; margin-top:4px;">📅 ${formatarData(pedido.created_at)}</small>
          <small style="display:block; font-weight:bold;">👤 Garçom: ${pedido.garcom_id || 'N/I'}</small>
        </div>
        <div style="text-align: right;">
          <div class="pedido-valor">R$ ${pedido.total.toFixed(2)}</div>
          <div style="display:flex; flex-direction:column; gap:5px; margin-top:5px;">
            <button style="background:#2c3e50; border:1px solid #34495e; font-size: 0.75rem; width: 100%; padding: 5px 10px;" onclick='imprimirCupom(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>🖨️ Re-imprimir</button>
            <button style="background:#e74c3c; font-size: 0.75rem; width: 100%; padding: 5px 10px;" onclick="excluirPedido(${pedido.id})">🗑️ Excluir</button>
          </div>
        </div>
      </div>
      <div class="pedido-itens">${itens.map(item => `<div class="pedido-item"><span>• ${item.quantidade}x ${item.nome}</span></div>`).join('')}</div>
    `;
    container.appendChild(card);
  }
  const elFat = document.getElementById('faturamento-total-dia');
  if (elFat) elFat.innerText = `Faturamento Concluído: R$ ${faturamentoTotal.toFixed(2)}`;
}

async function limparHistoricoTotal() {
  if (confirm("Limpar APENAS o histórico (pedidos entregues/cancelados)?")) {
    const res = await fetch('/api/pedidos/limpar', { method: 'DELETE' });
    if (res.ok) { mostrarToast("Histórico limpo!"); if (abaAtiva === 'ativos') carregarPedidos(); else carregarHistorico(); }
  }
}

async function liberarMesa(idPedido, idMesa, temPendentes = false) {
  let msg = "Liberar mesa agora?";
  if (temPendentes) {
    msg = "⚠️ ATENÇÃO: Esta mesa possui itens PENDENTES de entrega! Tem certeza que deseja LIBERAR a mesa e encerrar o pedido sem entregar tudo?";
  }
  if (confirm(msg)) {
    // Agora chama o modal de fechamento para conferência antes de liberar
    aprovarFechamento(idPedido, idMesa);
  }
}

// LOGICA DE FECHAMENTO NO ADMIN (NOVO)
let pedidoParaFecharAdmin = null;
let subtotalConsumoAdmin = 0;

async function aprovarFechamento(idPedido, idMesa) {
  pedidoParaFecharAdmin = pedidos.find(p => p.id === idPedido);
  if (!pedidoParaFecharAdmin) return alert("Pedido não encontrado.");
  
  const resItens = await fetch(`/api/pedidos/${idPedido}/itens`);
  const itens = await resItens.json();
  
  subtotalConsumoAdmin = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);

  document.getElementById('fechamento-titulo-admin').innerText = `Fechar Conta - Mesa ${pedidoParaFecharAdmin.mesa_numero}`;
  document.getElementById('fechamento-subtotal-admin').innerText = `R$ ${subtotalConsumoAdmin.toFixed(2)}`;
  
  // Reseta campos e ativa checkbox por padrão
  document.getElementById('fechamento-taxa-admin').checked = true;
  document.getElementById('fechamento-acrescimo-admin').value = pedidoParaFecharAdmin.acrescimo || 0;
  document.getElementById('fechamento-desconto-admin').value = pedidoParaFecharAdmin.desconto || 0;
  document.getElementById('fechamento-forma-admin').value = pedidoParaFecharAdmin.forma_pagamento || 'Dinheiro';
  document.getElementById('fechamento-recebido-admin').value = pedidoParaFecharAdmin.valor_recebido || '';
  
  recalcularFechamentoAdmin();
  toggleTrocoAdmin();
  
  document.getElementById('modal-fechamento-admin').style.display = 'block';
}

function recalcularFechamentoAdmin() {
  const cobrarTaxa = document.getElementById('fechamento-taxa-admin').checked;
  const taxaServico = cobrarTaxa ? subtotalConsumoAdmin * 0.10 : 0;
  
  document.getElementById('fechamento-valor-taxa-admin').innerText = `R$ ${taxaServico.toFixed(2)}`;
  document.getElementById('fechamento-valor-taxa-admin').parentElement.style.opacity = cobrarTaxa ? '1' : '0.3';
  
  const acrescimo = parseFloat(document.getElementById('fechamento-acrescimo-admin').value) || 0;
  const desconto = parseFloat(document.getElementById('fechamento-desconto-admin').value) || 0;
  const recebido = parseFloat(document.getElementById('fechamento-recebido-admin').value) || 0;
  
  const totalFinal = subtotalConsumoAdmin + taxaServico + acrescimo - desconto;
  document.getElementById('fechamento-total-final-admin').innerText = `R$ ${totalFinal.toFixed(2)}`;
  
  const troco = recebido > totalFinal ? recebido - totalFinal : 0;
  document.getElementById('fechamento-troco-admin').innerText = `R$ ${troco.toFixed(2)}`;
}

function toggleTrocoAdmin() {
  const forma = document.getElementById('fechamento-forma-admin').value;
  document.getElementById('secao-troco-admin').style.display = (forma === 'Dinheiro') ? 'block' : 'none';
}

function fecharModalFechamentoAdmin() {
  document.getElementById('modal-fechamento-admin').style.display = 'none';
}

async function confirmarPagamentoAdmin() {
  const idPedido = pedidoParaFecharAdmin.id;
  const idMesa = pedidoParaFecharAdmin.mesa_id;
  const forma_pagamento = document.getElementById('fechamento-forma-admin').value;
  const acrescimo = parseFloat(document.getElementById('fechamento-acrescimo-admin').value) || 0;
  const desconto = parseFloat(document.getElementById('fechamento-desconto-admin').value) || 0;
  const valor_recebido = parseFloat(document.getElementById('fechamento-recebido-admin').value) || 0;
  
  const cobrarTaxa = document.getElementById('fechamento-taxa-admin').checked;
  const taxaServico = cobrarTaxa ? subtotalConsumoAdmin * 0.10 : 0;
  
  const total = subtotalConsumoAdmin + taxaServico + acrescimo - desconto;
  const troco = valor_recebido > total ? valor_recebido - total : 0;

  try {
    // 1. Atualiza os dados financeiros do pedido
    const resFechamento = await fetch(`/api/pedidos/${idPedido}/solicitar-fechamento`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesa_id: idMesa, forma_pagamento, acrescimo, desconto, valor_recebido, troco, total })
    });

    if (!resFechamento.ok) {
      const err = await resFechamento.json();
      throw new Error(err.error || "Erro ao atualizar dados de fechamento");
    }

    // 2. Finaliza o pedido e atualiza o CAIXA
    const resStatus = await fetch(`/api/pedidos/${idPedido}/status`, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ status: 'entregue' }) 
    });

    if (!resStatus.ok) {
      const err = await resStatus.json();
      // Caso específico do caixa fechado
      if (resStatus.status === 400 && err.error.includes("CAIXA")) {
        alert("⚠️ ERRO: O CAIXA ESTÁ FECHADO!\n\nVá na aba 'Caixa' e realize a abertura para poder finalizar vendas.");
        return;
      }
      throw new Error(err.error || "Erro ao finalizar pedido");
    }
    
    // 3. Libera a mesa
    await fetch(`/api/mesas/${idMesa}/liberar`, { method: 'PUT' });
    
    mostrarToast("✅ Pago e Liberado!");
    fecharModalFechamentoAdmin();
    carregarPedidos();
  } catch (error) {
    console.error(error);
    alert("❌ Erro: " + error.message);
  }
}

async function carregarCardapio() {
  const res = await fetch('/api/menu');
  cardapio = await res.json();
  const select = document.getElementById('menu-select');
  if (select) select.innerHTML = cardapio.map(item => `<option value="${item.id}">${item.nome} - R$ ${item.preco.toFixed(2)}</option>`).join('');
}

function iniciarPiscarTitulo() { if (intervalPiscaTitulo) return; let alt = false; intervalPiscaTitulo = setInterval(() => { document.title = alt ? '🔔 NOVO!' : '⚠️ VERIFIQUE'; alt = !alt; }, 1000); }
function pararPiscarTitulo() { clearInterval(intervalPiscaTitulo); intervalPiscaTitulo = null; document.title = tituloOriginal; }
function solicitarPermissaoNotificacao() { if ("Notification" in window) Notification.requestPermission(); }
function exibirNotificacaoNativa(tit, msg) { if ("Notification" in window && Notification.permission === "granted") new Notification(tit, { body: msg }); }

let timeoutPusher = null;
let pusherInstancia = null;
let pedidoAtualizadoId = null;

function configurarPusher() {
  if (pusherInstancia) return;
  pusherInstancia = new Pusher('c4a9b50fe10859f2107a', { cluster: 'sa1' });
  const channel = pusherInstancia.subscribe('garconnexpress');
  
  channel.bind('novo-pedido', (data) => {
    tocarNotificacao(); iniciarPiscarTitulo();
    exibirNotificacaoNativa('Novo Pedido!', `Mesa ${data.pedido.mesa_numero}`);
    mostrarToast(`🚀 NOVO PEDIDO: Mesa ${data.pedido.mesa_numero}`);
    clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
  });

  channel.bind('status-atualizado', (data) => {
    console.log('STATUS ATUALIZADO RECEBIDO:', data);
    if (!data) return;
    
    const nMesa = data.mesa_numero || data.mesa_id || 'X';

    // Se for liberação de mesa
    if (data.status === 'liberada') {
        tocarNotificacao();
        exibirNotificacaoNativa('Mesa Liberada', `Mesa ${nMesa} está livre.`);
        mostrarToast(`✅ Mesa ${nMesa} liberada`);
        clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
        return;
    }

    if (data.pedido_id || data.status) {
      tocarNotificacao(); iniciarPiscarTitulo();
      let tit = 'Atualização!';

      if (data.status === 'aguardando_fechamento') tit = `🛎️ Fechamento mesa ${nMesa}`;
      else if (data.status === 'servido') tit = `🚚 Mesa ${nMesa} servida!`;
      else if (data.status === 'itens_adicionados') tit = `📝 Novos itens na Mesa ${nMesa}`;
      else if (data.status === 'itens_atualizados') tit = `📝 Pedido da Mesa ${nMesa} editado`;
      else if (data.status === 'cancelado') tit = `❌ Pedido da Mesa ${nMesa} CANCELADO`;
      else tit = `📝 Mesa ${nMesa} atualizada!`;

      exibirNotificacaoNativa(tit, "Verifique o painel.");
      mostrarToast(tit);
      clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
    }
  });
}

function tocarNotificacao() { if (audioDesbloqueado) { audioNotificacao.currentTime = 0; audioNotificacao.play().catch(e => console.error(e)); } }

function mostrarToast(msg) {
  const old = document.querySelector('.toast-notificacao'); if (old) old.remove();
  const t = document.createElement('div'); t.className = 'toast-notificacao'; t.innerText = msg; document.body.appendChild(t);
  setTimeout(() => { t.classList.add('show'); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, 8000); }, 100);
}

async function carregarPedidos() {
  try {
    const res = await fetch('/api/pedidos');
    pedidos = await res.json();
    exibirPedidos();
  } catch (error) { console.error(error); }
}

async function exibirPedidos() {
  if (abaAtiva !== 'ativos') return;
  const container = document.getElementById('pedidos-list');
  if (!container) return;
  container.innerHTML = '';

  if (pedidos.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; opacity: 0.4; color: #7f8c8d;">
        <div style="font-size: 4rem; margin-bottom: 1rem;">🍹</div>
        <h2 style="font-weight: normal;">Sem pedidos no momento...</h2>
        <p>Aguardando novos pedidos dos garçons.</p>
      </div>
    `;
    const elFatRes = document.getElementById('faturamento-resumo');
    if (elFatRes) elFatRes.innerText = `Faturamento: R$ 0,00`;
    return;
  }

  let faturamentoRealAtivo = 0;
  for (const pedido of pedidos) {
    const itens = await fetch(`/api/pedidos/${pedido.id}/itens`).then(res => res.json());
    const totalEnt = itens.filter(i => i.status === 'entregue').reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    const totalPend = itens.filter(i => i.status === 'pendente').reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    faturamentoRealAtivo += totalEnt;
    const hasPend = itens.some(i => i.status === 'pendente');
    const statusGeral = hasPend ? 'recebido' : 'servido';

    // Lógica do Cronômetro e Alerta
    let cronometroHtml = '';
    let classeAlertaAtraso = '';
    if (statusGeral === 'recebido' && pedido.created_at) {
      const minutos = calcularMinutos(pedido.created_at);
      cronometroHtml = `<span style="margin-left:10px; font-size:0.9rem; background:#eee; padding:2px 6px; border-radius:4px; color:#333;">⏱️ ${minutos} min</span>`;
      if (minutos >= 10) classeAlertaAtraso = 'alerta-borda-pisca';
    }

    const subtotal = totalEnt + totalPend;
    const taxaServico = subtotal * 0.10;
    // Se o pedido estiver aguardando fechamento, usa o total e ajustes vindos do banco
    const totalExibicao = pedido.status === 'aguardando_fechamento' ? pedido.total : (subtotal + taxaServico);
    const infoPagamento = pedido.status === 'aguardando_fechamento' ? `
      <div style="background:#f9f9f9; padding:5px; border-radius:4px; margin-top:5px; font-size:0.85rem; border:1px solid #ddd;">
        <strong>Pagamento:</strong> ${pedido.forma_pagamento}<br>
        ${pedido.forma_pagamento === 'Dinheiro' ? `<strong>Recebido:</strong> R$ ${pedido.valor_recebido.toFixed(2)} | <strong>Troco:</strong> R$ ${pedido.troco.toFixed(2)}` : ''}
        ${pedido.desconto > 0 ? `<br><span style="color:#e74c3c;"><strong>Desconto:</strong> - R$ ${pedido.desconto.toFixed(2)}</span>` : ''}
        ${pedido.acrescimo > 0 ? `<br><span style="color:#27ae60;"><strong>Acréscimo:</strong> + R$ ${pedido.acrescimo.toFixed(2)}</span>` : ''}
      </div>` : '';

    const textoCopiar = `PEDIDO MESA ${pedido.mesa_numero}\n------------------\n${itens.map(i => `• ${i.quantidade}x ${i.nome}${i.observacao ? ` (Obs: ${i.observacao})` : ''} - ${i.status === 'entregue' ? '✓' : '⏳'}`).join('\n')}\n------------------\nSubtotal: R$ ${subtotal.toFixed(2)}\nTaxa de Serviço (10%): R$ ${taxaServico.toFixed(2)}\nTotal Final: R$ ${totalExibicao.toFixed(2)}`;

    const card = document.createElement('div');
    card.className = `pedido-card status-${statusGeral} ${pedido.id === pedidoAtualizadoId ? 'destaque-atualizacao' : ''} ${classeAlertaAtraso}`;
    card.innerHTML = `
      <div class="pedido-header">
        <div>
          <h3>Mesa ${pedido.mesa_numero} ${cronometroHtml}</h3>
          <span class="status-badge">${statusGeral.toUpperCase()}</span>
          <small style="display:block; margin-top:4px;">📅 ${formatarData(pedido.created_at)}</small>
          <small style="display:block; font-weight:bold; color: #2c3e50;">👤 Garçom: ${pedido.garcom_id || 'N/I'}</small>
        </div>
        <div style="text-align:right">
          <div class="pedido-valor" style="font-size:1.1rem; color:#27ae60;">Total: R$ ${totalExibicao.toFixed(2)}</div>
          <div style="font-size:0.75rem; color:#7f8c8d; border-top:1px solid #eee; margin-top:3px;">
            Sub: R$ ${subtotal.toFixed(2)} + 10%: R$ ${taxaServico.toFixed(2)}
          </div>
        </div>
      </div>
      
      ${infoPagamento}
      
      <div class="pedido-itens">
        ${itens.map(item => `
          <div class="pedido-item" style="${item.status === 'entregue' ? 'opacity:0.5; background:#f0fff4;' : 'border-left:3px solid #e74c3c; background:#fff5f5;'} border-radius:4px; padding:4px 8px; margin-bottom:4px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>${item.quantidade}x ${item.nome}</strong>
              <span style="font-size:0.7rem; font-weight:bold; color:${item.status === 'entregue' ? '#27ae60' : '#e74c3c'};">
                ${item.status === 'entregue' ? '✓ NA MESA' : '⏳ PENDENTE'}
              </span>
            </div>
            ${item.observacao ? `<small>Obs: ${item.observacao}</small>` : ''}
          </div>
        `).join('')}
      </div>
      
      <div class="pedido-footer">
        <div style="display:flex; gap:0.5rem; flex-grow: 1;">
          <button style="background:#3498db; flex: 1;" onclick='abrirModalEdicao(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>✏️ EDITAR / ADD ITENS</button>
          <button style="background:#2c3e50; width: auto;" onclick='imprimirCupom(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>🖨️ IMPRIMIR</button>
        </div>
        
        <div class="pedido-actions" style="width: 100%; margin-top: 10px;">
          ${pedido.status === 'aguardando_fechamento' ? 
            `<button style="background:#27ae60; font-size:1rem; border:2px solid #fff; padding: 1rem; width: 100%;" onclick="aprovarFechamento(${pedido.id}, ${pedido.mesa_id})">💰 CONFIRMAR PAGAMENTO E LIBERAR</button>` : 
            `<div style="display:flex; gap:0.5rem;">
              ${hasPend ? `<button style="background:#e67e22; flex: 1;" onclick="marcarPedidoEntregue(${pedido.id})">🚚 ENTREGAR TUDO</button>` : ''}
              <button style="background:#7f8c8d; flex: 1;" onclick="liberarMesa(${pedido.id}, ${pedido.mesa_id}, ${hasPend})">🔓 LIBERAR MESA</button>
            </div>`
          }
        </div>
      </div>`;
    container.appendChild(card);
  }
  const elFat = document.getElementById('faturamento-resumo');
  if (elFat) elFat.innerText = `Faturamento Ativo (Servido): R$ ${faturamentoRealAtivo.toFixed(2)}`;
  if (pedidoAtualizadoId) setTimeout(() => { pedidoAtualizadoId = null; }, 5000);
}

function abrirModalEdicao(pedido, itens) {
  pedidoEmEdicao = pedido; 
  itensEmEdicao = [...itens];
  const elTit = document.getElementById('modal-titulo'); 
  if (elTit) elTit.innerText = `Editar Pedido - Mesa ${pedido.mesa_numero}`;
  const elMod = document.getElementById('modal-edicao'); 
  if (elMod) elMod.style.display = 'block';
  
  exibirCategoriasEdicao();
  exibirMenuEdicao('todas');
  renderizarItensEdicao();
}

function exibirCategoriasEdicao() {
  const container = document.getElementById('edit-menu-categorias');
  if (!container) return;
  const categorias = ['todas', ...new Set(cardapio.map(item => item.categoria))];
  container.innerHTML = categorias.map(cat => `
    <div class="cat-mini ${cat === 'todas' ? 'ativa' : ''}" data-categoria="${cat}" onclick="selecionarCategoriaEdicao(this, '${cat}')">
      ${cat === 'todas' ? 'Todos' : cat}
    </div>
  `).join('');
}

function selecionarCategoriaEdicao(el, cat) {
  document.querySelectorAll('.cat-mini').forEach(c => c.classList.remove('ativa'));
  el.classList.add('ativa');
  exibirMenuEdicao(cat);
}

function exibirMenuEdicao(categoria) {
  const container = document.getElementById('edit-menu-grid');
  if (!container) return;
  const itens = categoria === 'todas' ? cardapio : cardapio.filter(i => i.categoria === categoria);
  container.innerHTML = itens.map(item => `
    <div class="item-menu-mini" onclick="adicionarAoPedidoEdicao(${item.id})">
      <img src="${item.imagem}" alt="${item.nome}">
      <h4>${item.nome}</h4>
      <p>R$ ${item.preco.toFixed(2)}</p>
    </div>
  `).join('');
}

function adicionarAoPedidoEdicao(itemId) {
  const menuItem = cardapio.find(m => m.id === itemId);
  if (!menuItem) return;

  const exist = itensEmEdicao.find(i => i.menu_id === itemId && i.status === 'pendente');
  const qtdAtual = exist ? exist.quantidade : 0;

  if (menuItem.estoque !== -1 && (qtdAtual + 1) > menuItem.estoque) {
    return alert(`Estoque insuficiente! Restam apenas ${menuItem.estoque} unidades.`);
  }

  if (exist) {
    exist.quantidade += 1;
  } else {
    itensEmEdicao.push({ 
      menu_id: menuItem.id, 
      nome: menuItem.nome, 
      preco: menuItem.preco, 
      quantidade: 1, 
      observacao: '', 
      status: 'pendente' 
    });
  }
  renderizarItensEdicao();
}

function renderizarItensEdicao() {
  const container = document.getElementById('itens-atuais'); if (!container) return;
  let total = 0;
  container.innerHTML = itensEmEdicao.map((item, index) => {
    total += item.preco * item.quantidade;
    const isEntregue = item.status === 'entregue';
    return `
      <div class="item-edicao" style="${isEntregue ? 'opacity: 0.6; background: #e8f5e9;' : ''}">
        <div style="flex-grow:1;">
          <strong>${item.nome}</strong><br>
          <small>${isEntregue ? '✅ Já na mesa' : '⏳ Pendente'}</small>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem">
          ${!isEntregue ? `
            <input type="number" value="${item.quantidade}" min="1" style="width:45px; padding:2px;" onchange="mudarQtdItem(${index}, this.value)">
            <button class="btn-remover-item" onclick="removerItemEdicao(${index})">X</button>
          ` : `<span>${item.quantidade}x</span>`}
          <span style="min-width: 60px; text-align:right;">R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
        </div>
      </div>`;
  }).join('');
  const elTot = document.getElementById('modal-total'); if (elTot) elTot.innerText = `Total: R$ ${total.toFixed(2)}`;
}

function fecharModal() { const elMod = document.getElementById('modal-edicao'); if (elMod) elMod.style.display = 'none'; }

async function salvarAlteracoes() {
  if (itensEmEdicao.length === 0) { if (confirm("Cancelar pedido?")) return confirmarCancelamento(); return; }
  const res = await fetch(`/api/pedidos/${pedidoEmEdicao.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: itensEmEdicao }) });
  if (res.ok) { mostrarToast("Atualizado!"); fecharModal(); carregarPedidos(); }
}

async function confirmarCancelamento() {
  if (confirm("CANCELAR este pedido?")) { await atualizarStatus(pedidoEmEdicao.id, 'cancelado'); fecharModal(); carregarPedidos(); }
}

function copiarPedido(btn, texto) {
  navigator.clipboard.writeText(texto).then(() => {
    const orig = btn.innerHTML; btn.innerHTML = "✅ Copiado!"; mostrarToast("Copiado!"); setTimeout(() => btn.innerHTML = orig, 2000);
  });
}

async function excluirPedido(id) {
  if (confirm("⚠️ EXCLUIR PERMANENTEMENTE?\n\nIsso removerá o pedido do banco de dados e do histórico. Esta ação não pode ser desfeita.")) {
    const res = await fetch(`/api/pedidos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      mostrarToast("🗑️ Pedido excluído!");
      if (abaAtiva === 'ativos') carregarPedidos();
      else carregarHistorico();
    }
  }
}

async function atualizarStatus(id, status) {
  if (status === 'cancelado' && !confirm("Deseja realmente CANCELAR este pedido? A mesa será liberada.")) return;
  
  const res = await fetch(`/api/pedidos/${id}/status`, { 
    method: 'PUT', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ status }) 
  });
  
  if (res.ok) {
    mostrarToast(status === 'cancelado' ? "❌ Pedido Cancelado" : "Atualizado!");
    carregarPedidos();
  } else {
    const err = await res.json();
    alert("Erro: " + err.error);
  }
}

async function marcarPedidoEntregue(id) {
  if (confirm("Marcar todos os itens como entregues?")) {
    const res = await fetch(`/api/pedidos/${id}/marcar-entregue`, { method: 'PUT' });
    if (res.ok) {
      mostrarToast("Pedido marcado como entregue!");
      carregarPedidos();
    }
  }
}

// FUNÇÃO DE IMPRESSÃO DE CUPOM TÉRMICO (OTIMIZADO PARA EPSON TM-T20X)
function imprimirCupom(pedido, itens) {
  const container = document.getElementById('cupom-impressao');
  if (!container) return;

  const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const taxa = subtotal * 0.10;
  
  // Se for um pedido com fechamento solicitado, usa os valores do banco
  const desconto = pedido.desconto || 0;
  const acrescimo = pedido.acrescimo || 0;
  const total = pedido.status === 'aguardando_fechamento' ? pedido.total : (subtotal + taxa);
  const forma = pedido.forma_pagamento || "N/I";

  const html = `
    <div style="width: 72mm; font-family: 'Courier New', monospace; font-size: 9pt; line-height: 1.2; color: #000; background: #fff; padding: 0;">
      <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
        <h1 style="margin: 0; font-size: 1.4rem; letter-spacing: 1px;">GuGA Bebidas</h1>
        <p style="margin: 2px 0; font-weight: bold;">*** COMPROVANTE DE CONTA ***</p>
      </div>
      
      <div style="margin-bottom: 8px;">
        <div style="display:flex; justify-content:space-between;">
          <span>DATA: ${formatarData(pedido.created_at)}</span>
          <span>MESA: <strong>${pedido.mesa_numero}</strong></span>
        </div>
        <p style="margin: 2px 0;">GARÇOM: ${pedido.garcom_id || 'N/I'}</p>
        <p style="margin: 2px 0;">PAGAMENTO: <strong>${forma.toUpperCase()}</strong></p>
      </div>

      <div style="border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; margin-bottom: 5px; font-weight: bold; display: flex; justify-content: space-between;">
        <span style="width: 60%;">DESCRIÇÃO</span>
        <span style="width: 15%; text-align: center;">QTD</span>
        <span style="width: 25%; text-align: right;">TOTAL</span>
      </div>

      <div style="min-height: 30px;">
        ${itens.map(item => `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px; align-items: flex-start;">
            <div style="width: 60%; word-wrap: break-word;">${item.nome.toUpperCase()}</div>
            <div style="width: 15%; text-align: center;">${item.quantidade}</div>
            <div style="width: 25%; text-align: right;">${(item.preco * item.quantidade).toFixed(2)}</div>
          </div>
          ${item.observacao ? `<div style="font-size: 8pt; font-style: italic; margin-bottom: 5px; padding-left: 5px;">>> Obs: ${item.observacao}</div>` : ''}
        `).join('')}
      </div>

      <div style="border-top: 1px dashed #000; margin-top: 10px; padding-top: 5px;">
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
          <span>SUBTOTAL PRODUTOS:</span>
          <span>R$ ${subtotal.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
          <span>TAXA SERVIÇO (10%):</span>
          <span>R$ ${taxa.toFixed(2)}</span>
        </div>
        ${acrescimo > 0 ? `
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px; color: #27ae60;">
          <span>ACRÉSCIMO:</span>
          <span>+ R$ ${acrescimo.toFixed(2)}</span>
        </div>` : ''}
        ${desconto > 0 ? `
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px; color: #e74c3c;">
          <span>DESCONTO:</span>
          <span>- R$ ${desconto.toFixed(2)}</span>
        </div>` : ''}
        <div style="display:flex; justify-content:space-between; font-size: 1.2rem; font-weight: bold; margin-top: 5px; border-top: 1px solid #000; padding-top: 5px;">
          <span>TOTAL FINAL:</span>
          <span>R$ ${total.toFixed(2)}</span>
        </div>
        ${pedido.forma_pagamento === 'Dinheiro' ? `
        <div style="display:flex; justify-content:space-between; margin-top: 5px; font-size: 0.8rem;">
          <span>VALOR RECEBIDO:</span>
          <span>R$ ${pedido.valor_recebido.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight: bold; font-size: 0.9rem;">
          <span>TROCO:</span>
          <span>R$ ${pedido.troco.toFixed(2)}</span>
        </div>` : ''}
      </div>

      <div style="text-align: center; margin-top: 20px; border-top: 1px dashed #000; padding-top: 10px;">
        <p style="margin: 0; font-weight: bold;">OBRIGADO PELA PREFERÊNCIA!</p>
        <p style="margin: 2px 0; font-size: 7pt;">GuGA Bebidas - Sistema de Gestão</p>
        <br><br>.
      </div>
    </div>
  `;

  container.innerHTML = html;
  setTimeout(() => { window.print(); }, 250);
}

// FUNÇÃO PARA IMPRIMIR RELATÓRIO DE CAIXA
function imprimirRelatorioCaixa() {
  if (!caixaAtual) return alert('Nenhum caixa aberto para imprimir.');

  const container = document.getElementById('cupom-impressao');
  if (!container) return;

  const totalEsperadoDinheiro = caixaAtual.valor_inicial + caixaAtual.total_dinheiro;
  const totalGeral = caixaAtual.total_vendas;

  const html = `
    <div style="width: 72mm; font-family: 'Courier New', monospace; font-size: 10pt; line-height: 1.3; color: #000; background: #fff; padding: 0;">
      <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
        <h1 style="margin: 0; font-size: 1.4rem;">GuGA Bebidas</h1>
        <p style="margin: 2px 0; font-weight: bold;">*** RELATÓRIO DE CAIXA ***</p>
        <p style="margin: 2px 0;">${caixaAtual.status === 'aberto' ? 'MOVIMENTO PARCIAL' : 'FECHAMENTO DEFINITIVO'}</p>
      </div>
      
      <div style="margin-bottom: 10px; font-size: 9pt;">
        <p><strong>ABERTURA:</strong> ${formatarData(caixaAtual.data_abertura)}</p>
        ${caixaAtual.data_fechamento ? `<p><strong>FECHAMENTO:</strong> ${formatarData(caixaAtual.data_fechamento)}</p>` : ''}
        <p><strong>STATUS:</strong> ${caixaAtual.status.toUpperCase()}</p>
      </div>

      <div style="border-top: 1px solid #000; padding-top: 5px; margin-bottom: 10px;">
        <div style="display:flex; justify-content:space-between;">
          <span>VALOR INICIAL:</span>
          <span>R$ ${caixaAtual.valor_inicial.toFixed(2)}</span>
        </div>
      </div>

      <div style="margin-bottom: 10px;">
        <p style="font-weight: bold; border-bottom: 1px solid #000; margin-bottom: 5px;">VENDAS POR MÉTODOS:</p>
        <div style="display:flex; justify-content:space-between;">
          <span>💵 DINHEIRO:</span>
          <span>R$ ${caixaAtual.total_dinheiro.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>📱 PIX:</span>
          <span>R$ ${caixaAtual.total_pix.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>💳 CARTÃO:</span>
          <span>R$ ${caixaAtual.total_cartao.toFixed(2)}</span>
        </div>
      </div>

      <div style="border-top: 1px dashed #000; padding-top: 8px; margin-top: 10px;">
        <div style="display:flex; justify-content:space-between; font-weight: bold;">
          <span>TOTAL DE VENDAS:</span>
          <span>R$ ${totalGeral.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size: 1.1rem; font-weight: bold; margin-top: 5px; background: #eee; padding: 2px;">
          <span>DINHEIRO EM CAIXA:</span>
          <span>R$ ${totalEsperadoDinheiro.toFixed(2)}</span>
        </div>
      </div>

      <div style="text-align: center; margin-top: 30px; border-top: 1px solid #000; padding-top: 10px;">
        <p style="margin-bottom: 40px;">__________________________</p>
        <p style="font-size: 8pt;">Assinatura do Responsável</p>
        <p style="margin-top: 15px; font-size: 7pt;">${new Date().toLocaleString('pt-BR')}</p>
      </div>
    </div>
  `;

  container.innerHTML = html;
  setTimeout(() => { window.print(); }, 250);
}
