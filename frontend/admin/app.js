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
  
  // Desbloquear áudio no primeiro clique do usuário
  document.addEventListener('click', () => {
    if (!audioDesbloqueado) {
      audioNotificacao.play().then(() => {
        audioNotificacao.pause();
        audioNotificacao.currentTime = 0;
        audioDesbloqueado = true;
        console.log('Sistema de áudio pronto.');
      }).catch(e => console.error('Erro ao preparar áudio:', e));
    }
  }, { once: true });
});

function verificarSessaoAdmin() {
  const salvo = localStorage.getItem('admin_logado');
  if (salvo) {
    adminLogado = JSON.parse(salvo);
    const telaLogin = document.getElementById('tela-login-admin');
    if (telaLogin) telaLogin.style.display = 'none';
    iniciarPainelAdmin();
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
    adminLogado = data.user;
    localStorage.setItem('admin_logado', JSON.stringify(adminLogado));
    location.reload();
  } else {
    alert("Credenciais de Administrador inválidas");
  }
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
  else if (tab === 'historico') {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const elData = document.getElementById('data-historico');
    if (elData) elData.innerText = `(${hoje})`;
    carregarHistorico();
  }
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
  container.innerHTML = mesas.map(m => `
    <div class="item-config">
      <span>Mesa ${m.numero}</span>
      <button class="btn-excluir" onclick="excluirMesa(${m.id})">Remover</button>
    </div>
  `).join('');
}

async function adicionarMesa() {
  const num = document.getElementById('nova-mesa-num').value;
  if (!num) return;
  await fetch('/api/mesas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: parseInt(num) })
  });
  document.getElementById('nova-mesa-num').value = '';
  exibirMesasConfig();
}

async function excluirMesa(id) {
  if (confirm("Remover esta mesa?")) {
    await fetch(`/api/mesas/${id}`, { method: 'DELETE' });
    exibirMesasConfig();
  }
}

// GARÇONS
async function exibirGarconsConfig() {
  const res = await fetch('/api/garcons');
  const garcons = await res.json();
  const container = document.getElementById('lista-garcons-config');
  if (!container) return;
  container.innerHTML = garcons.map(g => `
    <div class="item-config">
      <div><strong>${g.nome}</strong> (@${g.usuario})</div>
      <button class="btn-excluir" onclick="excluirGarcom(${g.id})">X</button>
    </div>
  `).join('');
}

async function adicionarGarcom() {
  const nome = document.getElementById('garcom-nome').value;
  const usuario = document.getElementById('garcom-usuario').value;
  const senha = document.getElementById('garcom-senha').value;
  if (!nome || !usuario || !senha) return;
  await fetch('/api/garcons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, usuario, senha })
  });
  document.getElementById('garcom-nome').value = '';
  document.getElementById('garcom-usuario').value = '';
  document.getElementById('garcom-senha').value = '';
  exibirGarconsConfig();
}

async function excluirGarcom(id) {
  if (confirm("Remover este garçom?")) {
    await fetch(`/api/garcons/${id}`, { method: 'DELETE' });
    exibirGarconsConfig();
  }
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
        <small>${m.categoria} - R$ ${m.preco.toFixed(2)}</small>
      </div>
      <div style="display:flex; flex-direction:column; gap:0.2rem">
        <button style="background:#3498db; padding:4px 8px; font-size:0.8rem" onclick='prepararEdicaoMenu(${JSON.stringify(m)})'>✏️ Editar</button>
        <button class="btn-excluir" onclick="excluirDoMenu(${m.id})">Excluir</button>
      </div>
    </div>
  `).join('');
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
  ['menu-nome', 'menu-cat', 'menu-preco', 'menu-img'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('btn-acao-menu').textContent = "Adicionar Item";
  document.getElementById('btn-acao-menu').style.background = "#27ae60";
  document.getElementById('btn-cancelar-menu').classList.add('hidden');
}

async function processarAcaoMenu() {
  const nome = document.getElementById('menu-nome').value;
  const categoria = document.getElementById('menu-cat').value;
  const preco = parseFloat(document.getElementById('menu-preco').value);
  const imagem = document.getElementById('menu-img').value || 'https://placehold.co/100';

  if (!nome || !categoria || isNaN(preco)) return alert("Preencha todos os campos corretamente.");

  const payload = { nome, categoria, preco, imagem };
  const url = idItemEdicaoMenu ? `/api/menu/${idItemEdicaoMenu}` : '/api/menu';
  const method = idItemEdicaoMenu ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      mostrarToast(idItemEdicaoMenu ? "Item atualizado!" : "Item adicionado!");
      cancelarEdicaoMenu();
      exibirMenuConfig();
    }
  } catch (error) {
    alert("Erro ao processar item do menu");
  }
}

async function excluirDoMenu(id) {
  if (confirm("Remover este item do cardápio?")) {
    await fetch(`/api/menu/${id}`, { method: 'DELETE' });
    exibirMenuConfig();
  }
}

async function carregarHistorico() {
  try {
    const res = await fetch('/api/pedidos/historico');
    const historico = await res.json();
    exibirHistorico(historico);
  } catch (error) {
    console.error('Erro ao carregar histórico:', error);
  }
}

function formatarData(dataStr) {
  if (!dataStr) return "S/ Data";
  try {
    const isoStr = dataStr.replace(' ', 'T');
    const data = new Date(isoStr);
    if (!isNaN(data.getTime())) {
      return data.toLocaleDateString('pt-BR') + ' às ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    const limpa = dataStr.replace(/['"]/g, '');
    if (limpa.length > 5) return limpa;
    return dataStr;
  } catch (e) {
    return dataStr;
  }
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
    
    const dataFormatada = formatarData(pedido.created_at);
    const statusLabel = pedido.status === 'entregue' ? 'PAGO' : pedido.status.toUpperCase();
    const statusClass = pedido.status === 'entregue' ? 'pago' : pedido.status;

    card.innerHTML = `
        <div class="pedido-header">
          <div>
            <h3>Mesa ${pedido.mesa_numero}</h3>
            <span class="status-badge ${statusClass}">${statusLabel}</span>
            <small style="display:block; color:#7f8c8d; margin-top: 4px;">📅 ${dataFormatada}</small>
            <small style="display:block; color:#2c3e50; font-weight:bold; margin-top: 2px;">👤 Garçom: ${pedido.garcom_id || 'N/I'}</small>
          </div>
          <div class="pedido-valor">R$ ${pedido.total.toFixed(2)}</div>
        </div>
        <div class="pedido-itens">
          ${itens.map(item => `
            <div class="pedido-item">
              <span>• ${item.quantidade}x ${item.nome}</span>
            </div>
          `).join('')}
        </div>
    `;
    container.appendChild(card);
  }
  const elFat = document.getElementById('faturamento-total-dia');
  if (elFat) elFat.innerText = `Faturamento Concluído: R$ ${faturamentoTotal.toFixed(2)}`;
}

async function limparHistoricoTotal() {
  if (confirm("ATENÇÃO: Isso irá apagar TODOS os pedidos do sistema (ativos e históricos) e liberar todas as mesas. Deseja continuar?")) {
    try {
      const res = await fetch('/api/pedidos/limpar', { method: 'DELETE' });
      if (res.ok) {
        mostrarToast("Histórico limpo com sucesso!");
        if (abaAtiva === 'ativos') carregarPedidos();
        else carregarHistorico();
      }
    } catch (error) {
      alert("Erro ao limpar histórico");
    }
  }
}

async function liberarMesa(idMesa) {
  if (confirm("Deseja liberar esta mesa agora?")) {
    await fetch(`/api/mesas/${idMesa}/liberar`, { method: 'PUT' });
  }
}

async function aprovarFechamento(idPedido, idMesa) {
  if (confirm("Confirmar pagamento e liberar mesa?")) {
    await fetch(`/api/pedidos/${idPedido}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'entregue' })
    });
    await fetch(`/api/mesas/${idMesa}/liberar`, { method: 'PUT' });
    mostrarToast("Mesa liberada e pagamento confirmado!");
  }
}

async function carregarCardapio() {
  const res = await fetch('/api/menu');
  cardapio = await res.json();
  const select = document.getElementById('menu-select');
  if (select) {
    select.innerHTML = cardapio.map(item => `<option value="${item.id}">${item.nome} - R$ ${item.preco.toFixed(2)}</option>`).join('');
  }
}

function iniciarPiscarTitulo() {
  if (intervalPiscaTitulo) return;
  let alternar = false;
  intervalPiscaTitulo = setInterval(() => {
    document.title = alternar ? '🔔 NOVO PEDIDO!' : '⚠️ VERIFIQUE O PAINEL';
    alternar = !alternar;
  }, 1000);
}

function pararPiscarTitulo() {
  if (intervalPiscaTitulo) {
    clearInterval(intervalPiscaTitulo);
    intervalPiscaTitulo = null;
    document.title = tituloOriginal;
  }
}

function solicitarPermissaoNotificacao() {
  if ("Notification" in window) Notification.requestPermission();
}

function exibirNotificacaoNativa(titulo, mensagem) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(titulo, { body: mensagem });
  }
}

let timeoutPusher = null;
let pusherInstancia = null;
let pedidoAtualizadoId = null;

function configurarPusher() {
  if (pusherInstancia) return;
  
  console.log('Configurando Pusher...');
  pusherInstancia = new Pusher('c4a9b50fe10859f2107a', { cluster: 'sa1' });
  const channel = pusherInstancia.subscribe('garconnexpress');

  channel.bind('novo-pedido', (data) => {
    console.log('Novo pedido:', data);
    if (pedidoAtualizadoId === data.pedido.id) return;
    
    tocarNotificacao();
    iniciarPiscarTitulo();
    exibirNotificacaoNativa('Novo Pedido!', `Mesa ${data.pedido.mesa_numero} fez um pedido.`);
    mostrarToast(`🚀 NOVO PEDIDO: Mesa ${data.pedido.mesa_numero}`);
    
    pedidoAtualizadoId = data.pedido.id;
    clearTimeout(timeoutPusher);
    timeoutPusher = setTimeout(() => carregarPedidos(), 500);
  });

  channel.bind('status-atualizado', (data) => {
    console.log('Status atualizado recebido:', data);
    
    if (!data) return;

    // 1. Caso Especial: Mesa Liberada (pode não ter pedido_id)
    if (data.status === 'liberada') {
        const mesaNumero = data.mesa_id || '';
        const tituloNotif = `✅ Mesa- ${mesaNumero} - liberada`;
        const msgNotif = `A mesa ${mesaNumero} já está disponível para novos clientes.`;
        
        tocarNotificacao();
        iniciarPiscarTitulo();
        exibirNotificacaoNativa(tituloNotif, msgNotif);
        mostrarToast(tituloNotif);
        
        // Recarregar dados para limpar a tela
        clearTimeout(timeoutPusher);
        timeoutPusher = setTimeout(() => {
          if (abaAtiva === 'ativos') carregarPedidos();
          else if (abaAtiva === 'historico') carregarHistorico();
        }, 500);
        return; // Fim do processamento para este caso
    }

    // 2. Outras atualizações (exigem pedido_id)
    if (data.pedido_id) {
      if (pedidoAtualizadoId === data.pedido_id) return;
      pedidoAtualizadoId = data.pedido_id;

      tocarNotificacao();
      iniciarPiscarTitulo();

      let tituloNotif = 'Pedido Atualizado!';
      let msgNotif = `A Mesa ${data.mesa_id || ''} teve alterações no pedido.`;

      if (data.status === 'aguardando_fechamento') {
          const mesaNumero = data.mesa_id || '';
          tituloNotif = `🛎️ Solicitado fechamento da mesa ${mesaNumero}`;
          msgNotif = `A Mesa ${mesaNumero} solicitou o fechamento da conta!`;
      } else if (data.status === 'recebido' || !data.status) {
          tituloNotif = '📝 Novos itens adicionados!';
          msgNotif = `A Mesa ${data.mesa_id || ''} adicionou novos produtos.`;
      }

      exibirNotificacaoNativa(tituloNotif, msgNotif);
      mostrarToast(tituloNotif);
    }

    clearTimeout(timeoutPusher);
    timeoutPusher = setTimeout(() => {
      if (abaAtiva === 'ativos') carregarPedidos();
      else if (abaAtiva === 'historico') carregarHistorico();
    }, 500);
  });
}

function tocarNotificacao() {
  if (audioDesbloqueado) {
    audioNotificacao.currentTime = 0;
    audioNotificacao.play().catch(e => console.error('Erro ao tocar som:', e));
  } else {
    console.warn('Áudio ainda não desbloqueado pelo usuário (clique na página).');
  }
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
    }, 8000);
  }, 100);
}

async function carregarPedidos() {
  try {
    const res = await fetch('/api/pedidos');
    pedidos = await res.json();
    exibirPedidos();
    atualizarResumoFaturamento();
  } catch (error) {
    console.error('Erro ao carregar pedidos:', error);
  }
}

function atualizarResumoFaturamento() {
  const faturamentoAtivo = pedidos.reduce((sum, p) => sum + (parseFloat(p.total) || 0), 0);
  const elFat = document.getElementById('faturamento-resumo');
  if (elFat) elFat.innerText = `Faturamento Ativo: R$ ${faturamentoAtivo.toFixed(2)}`;
}

async function exibirPedidos() {
  if (abaAtiva !== 'ativos') return;
  const container = document.getElementById('pedidos-list');
  if (!container) return;
  container.innerHTML = '';

  for (const pedido of pedidos) {
    const itens = await fetch(`/api/pedidos/${pedido.id}/itens`).then(res => res.json());
    const card = document.createElement('div');
    
    const classeDestaque = (pedido.id === pedidoAtualizadoId) ? 'destaque-atualizacao' : '';
    card.className = `pedido-card status-${pedido.status} ${classeDestaque}`;
    
    const resumoParaCopia = `MESA ${pedido.mesa_numero}\nTOTAL: R$ ${pedido.total.toFixed(2)}\nITENS:\n${itens.map(i => `- ${i.quantidade}x ${i.nome}`).join('\n')}`;
    const dataFormatada = formatarData(pedido.created_at);

    card.innerHTML = `
        <div class="pedido-header">
          <div>
            <h3>Mesa ${pedido.mesa_numero}</h3>
            <span class="status-badge">${pedido.status.toUpperCase()}</span>
            <small style="display:block; color:#7f8c8d; margin-top: 4px;">📅 ${dataFormatada}</small>
            <small style="display:block; color:#2c3e50; font-weight:bold; margin-top: 2px;">👤 Garçom: ${pedido.garcom_id || 'Não informado'}</small>
          </div>
          <div class="pedido-valor">R$ ${pedido.total.toFixed(2)}</div>
        </div>
        <div class="pedido-itens">
          ${itens.map(item => `
            <div class="pedido-item">
              <strong>${item.quantidade}x ${item.nome}</strong>
              ${item.observacao ? `<small>Obs: ${item.observacao}</small>` : ''}
            </div>
          `).join('')}
        </div>
        <div class="pedido-footer">
          <div style="display:flex; gap:0.5rem">
            <button class="btn-copiar" onclick="copiarPedido(this, \`${resumoParaCopia.replace(/`/g, '\\`').replace(/\n/g, '\\n')}\`)">📋 Copiar</button>
            <button style="background:#3498db" onclick='abrirModalEdicao(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>✏️ Editar</button>
          </div>
          <div class="pedido-actions">
            ${pedido.status === 'aguardando_fechamento' ? `
              <button style="background:#27ae60; font-size:1rem; border:2px solid #fff; padding: 1rem;" 
                onclick="aprovarFechamento(${pedido.id}, ${pedido.mesa_id})">💰 CONFIRMAR PAGAMENTO E LIBERAR</button>
            ` : `
              <button style="background:#e67e22" onclick="liberarMesa(${pedido.mesa_id})">🔓 Liberar Mesa Manualmente</button>
            `}
          </div>
        </div>
    `;
    container.appendChild(card);
  }

  if (pedidoAtualizadoId) {
    setTimeout(() => {
      pedidoAtualizadoId = null;
    }, 5000);
  }
}

function abrirModalEdicao(pedido, itens) {
  pedidoEmEdicao = pedido;
  itensEmEdicao = [...itens];
  const elTit = document.getElementById('modal-titulo');
  if (elTit) elTit.innerText = `Editar Pedido - Mesa ${pedido.mesa_numero}`;
  const elMod = document.getElementById('modal-edicao');
  if (elMod) elMod.style.display = 'block';
  renderizarItensEdicao();
}

function renderizarItensEdicao() {
  const container = document.getElementById('itens-atuais');
  if (!container) return;
  let total = 0;
  container.innerHTML = itensEmEdicao.map((item, index) => {
    total += item.preco * item.quantidade;
    return `
      <div class="item-edicao">
        <span>${item.nome}</span>
        <div style="display:flex; align-items:center; gap:0.5rem">
          <input type="number" value="${item.quantidade}" min="1" style="width:50px" onchange="mudarQtdItem(${index}, this.value)">
          <span>R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
          <button class="btn-remover-item" onclick="removerItemEdicao(${index})">Remover</button>
        </div>
      </div>
    `;
  }).join('');
  const elTot = document.getElementById('modal-total');
  if (elTot) elTot.innerText = `Total: R$ ${total.toFixed(2)}`;
}

function mudarQtdItem(index, qtd) {
  itensEmEdicao[index].quantidade = parseInt(qtd);
  renderizarItensEdicao();
}

function removerItemEdicao(index) {
  itensEmEdicao.splice(index, 1);
  renderizarItensEdicao();
}

function adicionarAoPedidoEdicao() {
  const select = document.getElementById('menu-select');
  if (!select) return;
  const itemId = parseInt(select.value);
  const menuItem = cardapio.find(m => m.id === itemId);
  
  const itemExistente = itensEmEdicao.find(i => i.menu_id === itemId);
  if (itemExistente) {
    itemExistente.quantidade += 1;
  } else {
    itensEmEdicao.push({
      menu_id: menuItem.id,
      nome: menuItem.nome,
      preco: menuItem.preco,
      quantidade: 1,
      observacao: ''
    });
  }
  renderizarItensEdicao();
}

function fecharModal() {
  const elMod = document.getElementById('modal-edicao');
  if (elMod) elMod.style.display = 'none';
}

async function salvarAlteracoes() {
  if (itensEmEdicao.length === 0) {
    if (confirm("Pedido sem itens. Deseja cancelar o pedido?")) {
      return confirmarCancelamento();
    }
    return;
  }

  const res = await fetch(`/api/pedidos/${pedidoEmEdicao.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itens: itensEmEdicao })
  });

  if (res.ok) {
    mostrarToast("Pedido atualizado com sucesso!");
    fecharModal();
    carregarPedidos();
  }
}

async function confirmarCancelamento() {
  if (confirm("Tem certeza que deseja CANCELAR este pedido?")) {
    await atualizarStatus(pedidoEmEdicao.id, 'cancelado');
    fecharModal();
    carregarPedidos();
  }
}

function copiarPedido(btn, texto) {
  navigator.clipboard.writeText(texto).then(() => {
    const originalText = btn.innerHTML;
    btn.innerHTML = "✅ Copiado!";
    mostrarToast("Dados do pedido copiados!");
    setTimeout(() => btn.innerHTML = originalText, 2000);
  });
}

async function atualizarStatus(id, status) {
  await fetch(`/api/pedidos/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
}
