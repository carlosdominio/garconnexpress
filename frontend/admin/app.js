let pedidos = [];
let cardapio = [];
let pedidoEmEdicao = null;
let itensEmEdicao = [];
let abaAtiva = 'ativos';
let adminLogado = null;

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
  configurarPusher();
  window.addEventListener('focus', () => pararPiscarTitulo());
  
  // Atualiza os cronômetros a cada minuto no painel admin
  setInterval(() => {
    exibirPedidos();
  }, 60000);
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
  const secoes = ['ativos', 'historico', 'configuracoes'];
  secoes.forEach(s => {
    const el = document.getElementById(`${s}-section`);
    if (el) el.classList.toggle('hidden', s !== tab);
  });
  if (tab === 'ativos') carregarPedidos();
  else if (tab === 'historico') carregarHistorico();
  else if (tab === 'configuracoes') carregarDadosConfig();
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
  container.innerHTML = menuItens.map(m => `<div class="menu-item-config" id="item-menu-${m.id}"><img src="${m.imagem}" alt="${m.nome}"><div style="flex-grow: 1;"><strong>${m.nome}</strong><br><small>${m.categoria} - R$ ${m.preco.toFixed(2)}</small></div><div style="display:flex; flex-direction:column; gap:0.2rem"><button style="background:#3498db; padding:4px 8px; font-size:0.8rem" onclick='prepararEdicaoMenu(${JSON.stringify(m)})'>✏️ Editar</button><button class="btn-excluir" onclick="excluirDoMenu(${m.id})">Excluir</button></div></div>`).join('');
}

function prepararEdicaoMenu(item) {
  idItemEdicaoMenu = item.id;
  document.getElementById('menu-nome').value = item.nome;
  document.getElementById('menu-cat').value = item.categoria;
  document.getElementById('menu-preco').value = item.preco;
  document.getElementById('menu-img').value = item.imagem;
  document.getElementById('btn-acao-menu').textContent = "💾 Salvar";
  document.getElementById('btn-acao-menu').style.background = "#e67e22";
  document.getElementById('btn-cancelar-menu').classList.remove('hidden');
}

function cancelarEdicaoMenu() {
  idItemEdicaoMenu = null;
  ['menu-nome', 'menu-cat', 'menu-preco', 'menu-img'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('btn-acao-menu').textContent = "Adicionar Item";
  document.getElementById('btn-acao-menu').style.background = "#27ae60";
  document.getElementById('btn-cancelar-menu').classList.add('hidden');
}

async function processarAcaoMenu() {
  const nome = document.getElementById('menu-nome').value;
  const categoria = document.getElementById('menu-cat').value;
  const preco = parseFloat(document.getElementById('menu-preco').value);
  const imagem = document.getElementById('menu-img').value || 'https://placehold.co/100';
  if (!nome || !categoria || isNaN(preco)) return alert("Preencha corretamente");
  const payload = { nome, categoria, preco, imagem };
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
    card.innerHTML = `<div class="pedido-header"><div><h3>Mesa ${pedido.mesa_numero}</h3><span class="status-badge ${pedido.status === 'entregue' ? 'pago' : 'cancelado'}">${pedido.status === 'entregue' ? 'PAGO' : pedido.status.toUpperCase()}</span><small style="display:block; margin-top:4px;">📅 ${formatarData(pedido.created_at)}</small><small style="display:block; font-weight:bold;">👤 Garçom: ${pedido.garcom_id || 'N/I'}</small></div><div class="pedido-valor">R$ ${pedido.total.toFixed(2)}</div></div><div class="pedido-itens">${itens.map(item => `<div class="pedido-item"><span>• ${item.quantidade}x ${item.nome}</span></div>`).join('')}</div>`;
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

async function liberarMesa(idMesa, temPendentes = false) {
  let msg = "Liberar mesa agora?";
  if (temPendentes) {
    msg = "⚠️ ATENÇÃO: Esta mesa possui itens PENDENTES de entrega! Tem certeza que deseja LIBERAR a mesa e encerrar o pedido sem entregar tudo?";
  }
  if (confirm(msg)) {
    const res = await fetch(`/api/mesas/${idMesa}/liberar`, { method: 'PUT' });
    if (res.ok) carregarPedidos();
  }
}

async function aprovarFechamento(idPedido, idMesa) {
  if (confirm("Confirmar pagamento?")) {
    await fetch(`/api/pedidos/${idPedido}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'entregue' }) });
    await fetch(`/api/mesas/${idMesa}/liberar`, { method: 'PUT' });
    mostrarToast("Pago e Liberado!");
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

    const totalGeral = totalEnt + totalPend;
    const textoCopiar = `PEDIDO MESA ${pedido.mesa_numero}\n------------------\n${itens.map(i => `• ${i.quantidade}x ${i.nome}${i.observacao ? ` (Obs: ${i.observacao})` : ''} - ${i.status === 'entregue' ? '✓' : '⏳'}`).join('\n')}\n------------------\nTotal: R$ ${totalGeral.toFixed(2)}`;

    const card = document.createElement('div');
    card.className = `pedido-card status-${statusGeral} ${pedido.id === pedidoAtualizadoId ? 'destaque-atualizacao' : ''} ${classeAlertaAtraso}`;
    card.innerHTML = `<div class="pedido-header"><div><h3>Mesa ${pedido.mesa_numero} ${cronometroHtml}</h3><span class="status-badge">${statusGeral.toUpperCase()}</span><small style="display:block; margin-top:4px;">📅 ${formatarData(pedido.created_at)}</small><small style="display:block; font-weight:bold; color: #2c3e50;">👤 Garçom: ${pedido.garcom_id || 'N/I'}</small></div><div style="text-align:right"><div class="pedido-valor" style="font-size:1.1rem; color:#27ae60;">✓ R$ ${totalEnt.toFixed(2)}</div>${totalPend > 0 ? `<div style="font-size:0.8rem; color:#e74c3c; font-weight:bold;">⏳ + R$ ${totalPend.toFixed(2)}</div>` : ''}<div style="font-size:0.7rem; color:#7f8c8d; border-top:1px solid #eee; margin-top:3px;">Total: R$ ${totalGeral.toFixed(2)}</div></div></div><div class="pedido-itens">${itens.map(item => `<div class="pedido-item" style="${item.status === 'entregue' ? 'opacity:0.5; text-decoration:line-through; background:#f0fff4;' : 'border-left:3px solid #e74c3c; background:#fff5f5;'} border-radius:4px; padding:2px 5px; margin-bottom:4px;"><div style="display:flex; justify-content:space-between; align-items:center;"><strong>${item.quantidade}x ${item.nome}</strong><span style="font-size:0.7rem; font-weight:bold; color:${item.status === 'entregue' ? '#27ae60' : '#e74c3c'};">${item.status === 'entregue' ? '✓ NA MESA' : '⏳ PENDENTE'}</span></div>${item.observacao ? `<small>Obs: ${item.observacao}</small>` : ''}</div>`).join('')}</div><div class="pedido-footer"><div style="display:flex; gap:0.5rem"><button class="btn-copiar" onclick="copiarPedido(this, \`${textoCopiar}\`)">📋 Copiar</button><button style="background:#3498db" onclick='abrirModalEdicao(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>✏️ Editar</button></div><div class="pedido-actions" style="display:flex; flex-direction:column; gap:5px;">${pedido.status === 'aguardando_fechamento' ? `<button style="background:#27ae60; font-size:1rem; border:2px solid #fff; padding: 1rem;" onclick="aprovarFechamento(${pedido.id}, ${pedido.mesa_id})">💰 CONFIRMAR PAGAMENTO E LIBERAR</button>` : `${hasPend ? `<button style="background:#e67e22; width:100%;" onclick="marcarPedidoEntregue(${pedido.id})">🚚 ENTREGAR TUDO</button>` : ''}<button style="background:#7f8c8d; width:100%;" onclick="liberarMesa(${pedido.mesa_id}, ${hasPend})">🔓 Liberar Mesa Manualmente</button>`}</div></div>`;
    container.appendChild(card);
  }
  const elFat = document.getElementById('faturamento-resumo');
  if (elFat) elFat.innerText = `Faturamento Ativo (Servido): R$ ${faturamentoRealAtivo.toFixed(2)}`;
  if (pedidoAtualizadoId) setTimeout(() => { pedidoAtualizadoId = null; }, 5000);
}

function abrirModalEdicao(pedido, itens) {
  pedidoEmEdicao = pedido; itensEmEdicao = [...itens];
  const elTit = document.getElementById('modal-titulo'); if (elTit) elTit.innerText = `Editar Pedido - Mesa ${pedido.mesa_numero}`;
  const elMod = document.getElementById('modal-edicao'); if (elMod) elMod.style.display = 'block';
  renderizarItensEdicao();
}

function renderizarItensEdicao() {
  const container = document.getElementById('itens-atuais'); if (!container) return;
  let total = 0;
  container.innerHTML = itensEmEdicao.map((item, index) => {
    total += item.preco * item.quantidade;
    return `<div class="item-edicao"><span>${item.nome}</span><div style="display:flex; align-items:center; gap:0.5rem"><input type="number" value="${item.quantidade}" min="1" style="width:50px" onchange="mudarQtdItem(${index}, this.value)"><span>R$ ${(item.preco * item.quantidade).toFixed(2)}</span><button class="btn-remover-item" onclick="removerItemEdicao(${index})">Remover</button></div></div>`;
  }).join('');
  const elTot = document.getElementById('modal-total'); if (elTot) elTot.innerText = `Total: R$ ${total.toFixed(2)}`;
}

function mudarQtdItem(index, qtd) { itensEmEdicao[index].quantidade = parseInt(qtd); renderizarItensEdicao(); }
function removerItemEdicao(index) { itensEmEdicao.splice(index, 1); renderizarItensEdicao(); }
function adicionarAoPedidoEdicao() {
  const select = document.getElementById('menu-select'); if (!select) return;
  const itemId = parseInt(select.value); const menuItem = cardapio.find(m => m.id === itemId);
  const exist = itensEmEdicao.find(i => i.menu_id === itemId);
  if (exist) exist.quantidade += 1; else itensEmEdicao.push({ menu_id: menuItem.id, nome: menuItem.nome, preco: menuItem.preco, quantidade: 1, observacao: '', status: 'pendente' });
  renderizarItensEdicao();
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

async function atualizarStatus(id, status) {
  await fetch(`/api/pedidos/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
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
