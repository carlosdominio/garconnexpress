const API_BASE_URL = 'https://garconnexpress.vercel.app';

let isNativeApp = (window.Capacitor && window.Capacitor.isNativePlatform()) || 
                  navigator.userAgent.includes('Capacitor') || 
                  window.location.protocol === 'capacitor:' || 
                  (window.location.hostname === 'localhost' && (window.location.protocol === 'http:' || window.location.protocol === 'https:') && !window.location.port);

if (isNativeApp && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      registration.unregister().then(success => {
        if (success) console.log("🧹 Service Worker antigo desregistrado com sucesso no ambiente nativo!");
      });
    }
  });
}

// Interceptador global do fetch para colocar a API_BASE_URL no app nativo e adicionar Authorization Header
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    let url = args[0];
    const token = localStorage.getItem('cozinha_token');
    
    // Se for app nativo e a URL for interna, coloca a API_BASE_URL na frente
    if (isNativeApp && typeof url === 'string' && url.startsWith('/api/')) {
        url = API_BASE_URL + url;
        args[0] = url;
    }

    if (token) {
        if (!args[1]) args[1] = {};
        if (!args[1].headers) args[1].headers = {};
        args[1].headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await originalFetch(...args);

        // Se sessão expirar (401/403)
        if ((response.status === 401 || response.status === 403) && !args[0].includes('/api/login') && !args[0].includes('/api/admin/login')) {
            console.warn("⚠️ Sessão expirada ou acesso negado (401/403).");
            localStorage.removeItem('cozinha_logado');
            localStorage.removeItem('cozinha_token');
            window.location.reload();
        }
        return response;
    } catch (error) {
        console.error("❌ ERRO DE REDE/FETCH:", error, "URL:", args[0]);
        throw error;
    }
};

let pusher;
let canal;
let timeoutPusher;
const container = document.getElementById('pedidos-container');
const somTiposDisponiveis = ['original', 'campainha_classica', 'sino_moderno', 'alerta_digital', 'alerta_urgente', 'suave'];
const audiosNotificacao = {};
function inicializarAudios() {
  for (const som of somTiposDisponiveis) {
    audiosNotificacao[som] = new Audio(getSoundPath(som));
  }
}
inicializarAudios();
const statusConexao = document.getElementById('status-conexao');

let somAtivo = localStorage.getItem('cozinha_som_ativo') !== 'false';
let audioDesbloqueado = false;

function atualizarIconeSom() {
    const check = document.getElementById('check-som');
    const label = document.getElementById('label-som');
    if (check) check.checked = somAtivo;
    if (label) {
        label.innerText = somAtivo ? '🔔 SOM' : '🔕 MUDO';
        label.style.color = somAtivo ? '#2ecc71' : '#bdc3c7';
    }
    for (const som in audiosNotificacao) {
    audiosNotificacao[som].muted = !somAtivo;
  }
}

function alternarSom() {
    const check = document.getElementById('check-som');
    somAtivo = check ? check.checked : !somAtivo;
    localStorage.setItem('cozinha_som_ativo', somAtivo);
    atualizarIconeSom();
    
    // Notificação visual (balão/toast)
    mostrarToast(somAtivo ? "🔊 Som Ativado" : "🔇 Som Desativado");

    // Testa o som ao ativar
    if (somAtivo) {
        tocarCampainha();
    }
}

function tocarCampainha() {
    if (document.hidden) return; // Android FCM toca o som pesado quando oculto

    const somTipo = localStorage.getItem('cozinha_som_global') || 'sino_moderno';
    if (somTipo === 'mudo') return;

    if (somAtivo) {
        const audioObj = audiosNotificacao[somTipo] || audiosNotificacao['sino_moderno'];
        if (audioObj) {
            audioObj.muted = false;
            audioObj.currentTime = 0;
            audioObj.play().then(() => {
                audioDesbloqueado = true;
            }).catch(err => {
                console.log('Áudio bloqueado:', err);
                const fallbackAudio = new Audio(getSoundPath(somTipo));
                fallbackAudio.muted = false;
                fallbackAudio.play().catch(e => console.error(e));
            });
        }
    }
}

function getSoundPath(somTipo) {
  if (somTipo === 'original') {
    const isCordova = window.cordova || window.Capacitor || window.location.protocol === 'file:';
    if (isCordova) {
      return 'notificacao.mp3';
    }
    return '/notificacao.mp3';
  }
  const file = somTipo ? `${somTipo}.wav` : 'sino_moderno.wav';
  const isCordova = window.cordova || window.Capacitor || window.location.protocol === 'file:';
  if (isCordova) {
    return `sons/${file}`;
  }
  return `/sons/${file}`;
}

async function carregarSomGlobalCozinha() {
  try {
    const res = await fetch('/api/config/som-global');
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('cozinha_som_global', data.somCozinha || 'sino_moderno');
    }
  } catch (err) {
    console.error('Erro ao carregar som global cozinha:', err);
  }
}

let pedidosAtrasadosNotificados = new Set();

function solicitarPermissaoNotificacao() {
    if ("Notification" in window) Notification.requestPermission();
}

function exibirNotificacaoNativa(tit, msg, tagId = 'geral') {
    if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification(tit, {
            body: msg,
            tag: tagId,
            renotify: true
        });
        n.onclick = () => {
            window.focus();
        };
    }
}

function tocarSomNotificacao(tipo = 'campainha') {
    // Para simplificar e evitar erros de rede/cache com links externos, 
    // usamos o mesmo som para tudo na cozinha por enquanto
    tocarCampainha();
}

/**
 * Exibe uma notificação elegante no canto da tela (Toast)
 * @param {string} msg - Mensagem da notificação
 * @param {string} tipo - 'success', 'error', 'warning', 'info'
 * @param {string} titulo - Título opcional
 * @param {number} duracao - Tempo em ms (padrão 5s)
 */
function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
    if (typeof adicionarNotificacaoPainel === 'function') adicionarNotificacaoPainel(msg, titulo, tipo);
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const t = document.createElement('div');
    // Mapeamento de tipos antigos para os novos
    let classeTipo = tipo;
    if (tipo === 'sucesso') classeTipo = 'success';
    if (tipo === 'erro' || tipo === 'cancelado') classeTipo = 'error';
    
    t.className = `toast-notificacao ${classeTipo}`;
    
    const icones = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    const html = `
        <div class="toast-icon">${icones[classeTipo] || '🔔'}</div>
        <div class="toast-content">
            ${titulo ? `<strong class="toast-title">${titulo}</strong>` : ''}
            <span class="toast-msg">${msg}</span>
        </div>
        <button class="toast-close">&times;</button>
    `;

    t.innerHTML = html;
    container.appendChild(t);

    // NOVO: Espelha para notificação nativa do Windows automaticamente
    if (typeof exibirNotificacaoNativa === 'function') {
        exibirNotificacaoNativa(titulo || (classeTipo.toUpperCase() + ": " + (icones[classeTipo] || "")), msg, 'toast-' + Date.now());
    }

    // Trigger animação
    setTimeout(() => t.classList.add('show'), 10);

    // Auto-close
    const autoClose = setTimeout(() => fecharToast(t), duracao);

    // Botão fechar
    t.querySelector('.toast-close').onclick = () => {
        clearTimeout(autoClose);
        fecharToast(t);
    };
}

function fecharToast(el) {
    el.classList.remove('show');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
}

async function carregarPedidos() {
    try {
        const [caixaRes, pedidosRes] = await Promise.all([
            fetch('/api/caixa/status'),
            fetch('/api/pedidos/cozinha')
        ]);
        
        if (!caixaRes.ok || !pedidosRes.ok) throw new Error('Erro na resposta das APIs');
        
        const caixa = await caixaRes.json();
        const container = document.getElementById('pedidos-container');
        const closedScreen = document.getElementById('closed-screen');
        const header = document.getElementById('main-header');
        
        if (!caixa) {
            if (container) container.style.display = 'none';
            if (closedScreen) closedScreen.style.display = 'flex';
            if (header) header.style.opacity = '0.3';
            if (typeof limparNotificacoes === 'function') limparNotificacoes();
            return;
        }
        
        if (container) container.style.display = 'grid';
        if (closedScreen) closedScreen.style.display = 'none';
        if (header) header.style.opacity = '1';
        
        const itens = await pedidosRes.json();
        renderizarPedidos(itens);
    } catch (e) {
        console.error('❌ Erro ao carregar pedidos:', e);        
        setTimeout(carregarPedidos, 5000);
    }
}

async function verificarCaixa() {
    try {
        const res = await fetch('/api/caixa/status');
        const caixa = await res.json();
        
        const container = document.getElementById('pedidos-container');
        const closedScreen = document.getElementById('closed-screen');
        const header = document.getElementById('main-header');
        
        if (!caixa) {
            if (container) container.style.display = 'none';
            if (closedScreen) closedScreen.style.display = 'flex';
            if (header) header.style.opacity = '0.3';
            return false;
        }
        
        if (container) container.style.display = 'grid';
        if (closedScreen) closedScreen.style.display = 'none';
        if (header) header.style.opacity = '1';
        return true;
    } catch (err) {
        console.error('Erro ao verificar caixa:', err);
        return true; 
    }
}

function renderizarPedidos(itens) {
    // FILTRO DE SEGURANÇA REFORÇADO
    const itensValidos = itens.filter(item => {
        const pStatus = (item.pedido_status || '').toLowerCase();
        const iStatus = (item.item_status || '').toLowerCase();

        // Se for cancelado em qualquer nível, remove
        if (pStatus === 'cancelado' || iStatus === 'cancelado') return false;

        // Se o pedido não estiver em um status ativo para cozinha, remove
        if (pStatus && !['recebido', 'aguardando_fechamento'].includes(pStatus)) return false;

        return true;
    });

    if (!itensValidos || itensValidos.length === 0) {
        container.innerHTML = '<div class="sem-pedidos"><h2>🍳 Nenhum pedido pendente</h2></div>';
        return;
    }

    // Agrupar itens por pedido_id
    const pedidosMap = {};
    itensValidos.forEach(item => {
        if (!pedidosMap[item.pedido_id]) {
            console.log(`📦 [Render] Agrupando Pedido #${item.pedido_id}`);
            
            const isDelivery = item.garcom_id === 'DELIVERY';
            const mesaNome = isDelivery ? `DELIVERY #${item.pedido_id}` : (item.mesa_numero ? `Mesa ${item.mesa_numero}` : 'BALCÃO');

            pedidosMap[item.pedido_id] = {
                id: item.pedido_id,
                mesa: mesaNome,
                is_delivery: isDelivery,
                created_at: item.created_at,
                pedido_observacao: item.pedido_observacao,
                itens: []
            };
        }
        pedidosMap[item.pedido_id].itens.push(item);
    });

    const pedidosSorted = Object.values(pedidosMap).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    container.innerHTML = '';
    pedidosSorted.forEach(pedido => {
        const card = document.createElement('div');
        card.className = 'card-pedido';
        card.id = `pedido-card-${pedido.id}`;
        card.dataset.id = pedido.id;
        card.dataset.mesa = pedido.mesa;

        card.innerHTML = `
            <div class="card-header" style="${pedido.is_delivery ? 'background: #e67e22;' : ''}">
                <span class="mesa-num">${pedido.mesa}</span>
                <span class="pedido-id">#${pedido.id} - <span class="pedido-tempo" data-created-at="${pedido.created_at}">${calcularTempo(pedido.created_at)}</span></span>
            </div>
            <div class="card-body">
                ${pedido.pedido_observacao ? `<div class="pedido-obs-global" style="margin-bottom:10px; padding:8px; background:#fff3e0; border-left:4px solid #ff9800; border-radius:4px; font-size:0.95rem; color:#d35400;"><strong>OBS:</strong> ${pedido.pedido_observacao}</div>` : ''}
                ${pedido.itens.map(item => `
                    <div class="item-pedido">
                        <div class="item-info">
                            <div class="item-nome">${item.item_nome}</div>
                            ${item.observacao && item.observacao.trim() !== '' ? `<div class="item-obs" style="color:#e67e22; font-style:italic; font-size:0.9rem; margin-top:2px;">"${item.observacao}"</div>` : ''}
                        </div>
                        <div class="item-qtd">${item.quantidade}</div>
                    </div>
                `).join('')}
            </div>
            <div class="card-footer">
                <button class="btn-pronto" onclick="marcarComoPronto(${pedido.id}, this)">CONCLUIR PEDIDO</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function calcularTempo(createdAt) {
    const diff = Math.floor((new Date() - new Date(createdAt)) / 1000);
    if (diff < 0) return '00:00';

    const min = Math.floor(diff / 60);
    const seg = diff % 60;

    return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

function atualizarCronometros() {
    document.querySelectorAll('.pedido-tempo').forEach(span => {
        const createdAt = span.getAttribute('data-created-at');
        const card = span.closest('.card-pedido');
        const pedidoId = card ? card.dataset.id : null;
        const mesa = card ? card.dataset.mesa : '';

        if (createdAt) {
            span.innerText = calcularTempo(createdAt);

            // Adicionar cor de alerta se passar de 10 ou 15 min
            const diffMin = Math.floor((new Date() - new Date(createdAt)) / 60000);

            if (diffMin >= 15) {
                span.style.color = '#e74c3c'; // Vermelho
                span.style.fontWeight = 'bold';
                if (card) card.classList.add('card-atrasado');

                // NOTIFICAÇÃO DE ATRASO CRÍTICO (15 MIN)
                if (pedidoId && !pedidosAtrasadosNotificados.has(pedidoId)) {
                    tocarSomNotificacao();
                    exibirNotificacaoNativa(`⚠️ ATRASO NA COZINHA`, `Mesa ${mesa} está esperando há ${diffMin} min!`, `atraso-cozinha-${pedidoId}`);
                    pedidosAtrasadosNotificados.add(pedidoId);
                }
            } else if (diffMin >= 10) {
                span.style.color = '#f39c12'; // Laranja
                span.style.fontWeight = 'bold';
                if (card) card.classList.remove('card-atrasado');
            } else {
                span.style.color = '#2ecc71'; // Verde (Padrão)
                span.style.fontWeight = 'bold';
                if (card) card.classList.remove('card-atrasado');
                if (pedidoId) pedidosAtrasadosNotificados.delete(pedidoId);
            }
        }
    });
}
let pedidoParaConcluir = null;
let botaoParaConcluir = null;

function marcarComoPronto(pedidoId, btn) {
    const card = btn.closest('.card-pedido');
    const mesa = card ? card.dataset.mesa : 'Desconhecida';
    
    pedidoParaConcluir = pedidoId;
    botaoParaConcluir = btn;

    const modal = document.getElementById('modal-confirmacao-pronto');
    const msg = document.getElementById('confirmacao-pronto-msg');
    
    if (modal && msg) {
        const labelMesa = mesa.includes('DELIVERY') ? mesa : `Mesa ${mesa}`;
        msg.innerHTML = `Deseja marcar o pedido do <strong>${labelMesa}</strong> como pronto?`;
        modal.classList.add('active');
        
        document.getElementById('btn-confirmar-pronto').onclick = confirmarConclusaoPedido;
    }
}

function fecharModalPronto() {
    const modal = document.getElementById('modal-confirmacao-pronto');
    if (modal) modal.classList.remove('active');
    pedidoParaConcluir = null;
    botaoParaConcluir = null;
}

async function confirmarConclusaoPedido() {
    if (!pedidoParaConcluir || !botaoParaConcluir) return;
    
    const pedidoId = pedidoParaConcluir;
    const btn = botaoParaConcluir;
    
    fecharModalPronto();
    
    const originalText = btn.innerText;
    btn.innerText = 'CONCLUINDO...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/pedidos/${pedidoId}/cozinha-pronto`, { method: 'PUT' });
        const result = await res.json();
        
        if (result.success) {
            mostrarToast(`Pedido #${pedidoId} enviado!`, 'success');
            carregarPedidos();
        } else {
            mostrarToast('Erro ao concluir pedido: ' + (result.error || 'Erro desconhecido'), 'error');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (e) {
        console.error('Erro:', e);
        mostrarToast('Erro de conexão ao concluir pedido.', 'error');
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function mostrarNotificacaoCancelamento(mensagem, pedidoId) {
    console.log(`🗑️ Verificando cancelamento do pedido ${pedidoId}...`);
    
    let estavaNaTela = false;

    if (pedidoId) {
        const card = document.getElementById(`pedido-card-${pedidoId}`);
        if (card) {
            card.remove();
            estavaNaTela = true;
        }
        
        const todosCards = document.querySelectorAll('.card-pedido');
        todosCards.forEach(c => {
            if (c.innerText.includes(`#${pedidoId}`)) {
                c.remove();
                estavaNaTela = true;
            }
        });
    }

    if (estavaNaTela) {
        mostrarToast(`❌ PEDIDO CANCELADO: Mesa ${mensagem.split('Mesa ')[1] || pedidoId}`, 'erro');
        const modal = document.getElementById('modal-cancelamento');
        const modalMsg = document.getElementById('modal-mensagem');
        
        if (modal && modalMsg) {
            modalMsg.innerText = mensagem;
            modal.classList.add('active');
            tocarSomNotificacao('campainha');
        }
    }
}

function fecharModalCancelamento() {
    const modal = document.getElementById('modal-cancelamento');
    if (modal) {
        modal.classList.remove('active');
    }
    carregarPedidos();
}

async function configurarPusher() {
    try {
        const res = await fetch('/api/pusher-config');
        const config = await res.json();

        pusher = new Pusher(config.key, { cluster: config.cluster });
        canal = pusher.subscribe('garconnexpress');

        canal.bind('toast-config-atualizado', () => {
            console.log('🔄 Configurações de Toasts atualizadas!');
            if (typeof carregarConfiguracoesToasts === 'function') carregarConfiguracoesToasts();
        });

        canal.bind('som-global-atualizado', (data) => {
            console.log('🔄 Som global atualizado:', data);
            localStorage.setItem('cozinha_som_global', data.somCozinha || 'sino_moderno');
            const isNativeApp = (window.Capacitor && window.Capacitor.isNativePlatform());
            if (isNativeApp && typeof registerNativePush === 'function') {
                registerNativePush();
            }
        });

        canal.bind('teste-toast', (data) => {
            console.log('🔔 Evento recebido: teste-toast', data);
            if (deveTocarSom(data.evento || 'teste-toast')) tocarSomNotificacao('campainha');
            mostrarToast(data.mensagem, data.tipo === 'erro' ? 'erro' : (data.tipo === 'sucesso' ? 'success' : 'info'));
        });

        canal.bind('comunicado-geral', (data) => {
            console.log('📢 Evento recebido: comunicado-geral', data);
            if (data.destinatario === 'todos' || data.destinatario === 'cozinha') {
                if (deveTocarSom('comunicado-geral')) tocarSomNotificacao('campainha');
                mostrarToast(data.mensagem || '', 'info', '📢 COMUNICADO GERAL');
            }
        });

        canal.bind('pedido-atrasado-cozinha', (data) => {
            console.log('📢 Evento: pedido-atrasado-cozinha', data);
            if (deveTocarSom('pedido-atrasado-cozinha')) tocarSomNotificacao('campainha');
            dispararToastSistema('pedido-atrasado-cozinha', { mesa: data.mesa_numero || 'Mesa', pedido_id: data.pedido_id }, data.mensagem, 'error');
        });

        canal.bind('novo-pedido', (data) => {
            console.log('Novo pedido recebido!', data);
            
            if (data && data.para_cozinha === true) {
                const mesa = (data.pedido && data.pedido.mesa_numero) || data.mesa_numero || 'BALCÃO';
                const labelMesa = mesa.includes('DELIVERY') ? mesa : `Mesa ${mesa}`;
                dispararToastSistema('novo-pedido', { mesa: labelMesa }, `🍳 NOVO PEDIDO: ${labelMesa}`, 'success');
                exibirNotificacaoNativa(`🍳 NOVO PEDIDO: ${labelMesa}`, "Um novo pedido chegou para a cozinha!", `pedido-${data.pedido_id || 'novo'}`);
                if (deveTocarSom('novo-pedido')) tocarSomNotificacao('campainha');
                tocarSomNotificacao('windows');
            }
            
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('pedido-cancelado', (data) => {
            console.log('📢 Pedido cancelado recebido:', data);
            const idParaCancelar = data.id || data.pedido_id;
            if (idParaCancelar) {
                mostrarNotificacaoCancelamento(data.mensagem || `Pedido #${idParaCancelar} cancelado`, idParaCancelar);
            }
            
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('menu-atualizado', () => {
            mostrarToast('🔄 Cardápio atualizado');
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('status-caixa-atualizado', (data) => {
            console.log('📢 Status do Caixa atualizado:', data);
            verificarCaixa();
            if (data.status === 'fechado') {
                if (deveTocarSom('status-caixa-atualizado')) tocarCampainha();
                dispararToastSistema('status-caixa-atualizado', { status: 'FECHADO' }, "O caixa foi fechado! Bom descanso.", 'error');
            } else if (data.status === 'aberto') {
                tocarCampainha();
                dispararToastSistema('status-caixa-atualizado', { status: 'ABERTO' }, "O caixa foi aberto! Bom trabalho.", 'success');
                carregarPedidos();
            }
        });

        canal.bind('status-atualizado', (data) => {
            console.log('📢 Status atualizado recebido:', data);
            if (data && (data.status === 'itens_atualizados' || data.status === 'itens_adicionados')) {
                const card = document.getElementById(`pedido-card-${data.pedido_id || data.id}`);
                if (card) {
                    const mesa = data.mesa_numero || 'X';
                    dispararToastSistema('item-adicionado', { mesa }, `📝 Mesa ${mesa}: Itens atualizados`, 'info');
                    if (deveTocarSom('status-atualizado')) tocarSomNotificacao('campainha');
                }
            }
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        pusher.connection.bind('connected', () => {
            statusConexao.innerText = 'Online';
            statusConexao.classList.add('online');
        });

        pusher.connection.bind('disconnected', () => {
            statusConexao.innerText = 'Offline';
            statusConexao.classList.remove('online');
        });

    } catch (e) {
        console.error('Erro ao configurar Pusher:', e);
    }
}

// Inicialização
verificarSessao();

async function limparNotificacoesNativas() {
  try {
    if (window.Capacitor && window.Capacitor.Plugins) {
      const { PushNotifications } = window.Capacitor.Plugins;
      if (PushNotifications && typeof PushNotifications.removeAllDeliveredNotifications === 'function') {
        await PushNotifications.removeAllDeliveredNotifications();
        console.log("🧹 Notificações FCM limpas da barra de status.");
      }
    }
  } catch (e) {
    console.error("Erro ao limpar notificações:", e);
  }
}

async function registerNativePush() {
  try {
    const { PushNotifications } = window.Capacitor.Plugins;
    if (!PushNotifications) return;

    if (window.Capacitor.getPlatform() === 'android') {
      const somTipo = localStorage.getItem('cozinha_som_global') || 'sino_moderno';
      const somRec = somTipo === 'original' ? 'notificacao' : somTipo;
      const canalId = 'cozinha_canal_' + somTipo;

      try { await PushNotifications.deleteChannel({ id: 'pedidos_v4' }); } catch(e) {}

      // Cria o canal padrão com alta importância para evitar fallback (Miscellaneous)
      await PushNotifications.createChannel({
        id: 'pedidos',
        name: 'Pedidos Cozinha (Padrão)',
        description: 'Canal padrão para notificações urgentes',
        sound: 'notificacao',
        importance: 5,
        visibility: 1,
        vibration: true
      });

      // Cria o canal com o som personalizado
      await PushNotifications.createChannel({
        id: canalId,
        name: 'Pedidos Cozinha (' + somTipo + ')',
        description: 'Notificações de novos pedidos e chamados',
        sound: somRec,
        importance: 5,
        visibility: 1,
        vibration: true
      });
    }

    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.warn('❌ Permissão de notificação negada.');
      return;
    }

    await PushNotifications.register();

    PushNotifications.addListener('registration', async (token) => {
      console.log('🔥 Token FCM recebido (Cozinha):', token.value);
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endpoint: token.value,
          keys: { p256dh: '', auth: '' },
          app_type: 'cozinha'
        })
      });
    });

    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      console.log('📩 Notificação recebida (Cozinha):', notification);
      
      if (deveTocarSom('status-atualizado')) tocarCampainha();
      if (window.Capacitor && window.Capacitor.Plugins.Haptics) {
        try {
          await window.Capacitor.Plugins.Haptics.vibrate();
        } catch (e) { console.error("Erro vibração:", e); }
      }

      if (typeof carregarPedidos === 'function') carregarPedidos();
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('🖱️ Clique na notificação detectado:', notification);
      if (typeof carregarPedidos === 'function') carregarPedidos();
    });

  } catch (error) {
    console.error('❌ Erro Push Nativo:', error);
  }
}

function inicializar() {
    console.log('App Cozinha iniciado.');
}

// --- SINO DE NOTIFICAÇÕES ---
let historicoNotificacoes = [];

function adicionarNotificacaoPainel(mensagem, titulo, tipo) {
  historicoNotificacoes.unshift({
    id: Date.now(),
    mensagem: mensagem,
    titulo: titulo || 'Notificação',
    tipo: tipo,
    hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  });
  if (historicoNotificacoes.length > 50) historicoNotificacoes.pop();
  atualizarBadgeNotificacoes();
  renderizarListaNotificacoes();
}

function atualizarBadgeNotificacoes() {
  const badge = document.getElementById('badge-notificacoes');
  if (!badge) return;
  if (historicoNotificacoes.length > 0) {
    badge.innerText = historicoNotificacoes.length > 99 ? '99+' : historicoNotificacoes.length;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderizarListaNotificacoes() {
  const lista = document.getElementById('lista-notificacoes');
  if (!lista) return;
  if (historicoNotificacoes.length === 0) {
    lista.innerHTML = '<div id="notificacao-vazia" style="text-align: center; color: #7f8c8d; padding: 20px 0; font-size: 0.9rem;">Nenhuma nova notificação.</div>';
    return;
  }
  
  lista.innerHTML = historicoNotificacoes.map(notif => {
    let corBorda = '#3498db';
    if (notif.tipo === 'success' || notif.tipo === 'sucesso') corBorda = '#2ecc71';
    if (notif.tipo === 'error' || notif.tipo === 'erro') corBorda = '#e74c3c';
    if (notif.tipo === 'warning') corBorda = '#f1c40f';
    
    return `<div style="background: white; border-left: 4px solid ${corBorda}; padding: 10px; border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <strong style="font-size: 0.85rem; color: #2c3e50;">${notif.titulo}</strong>
        <span style="font-size: 0.7rem; color: #95a5a6;">${notif.hora}</span>
      </div>
      <span style="font-size: 0.85rem; color: #555;">${notif.mensagem}</span>
    </div>`;
  }).join('');
}

function togglePainelNotificacoes() {
  const painel = document.getElementById('painel-notificacoes');
  const badge = document.getElementById('badge-notificacoes');
  if (painel.style.display === 'none') {
    painel.style.display = 'flex';
    if (badge) badge.style.display = 'none'; // Zera visualmente o contador ao abrir
  } else {
    painel.style.display = 'none';
  }
}

function limparNotificacoes() {
  historicoNotificacoes = [];
  atualizarBadgeNotificacoes();
  renderizarListaNotificacoes();
  document.getElementById('painel-notificacoes').style.display = 'none';
}

async function iniciarApp() {
    await Promise.all([
        carregarSomGlobalCozinha(),
        carregarConfiguracoesToasts()
    ]);
    solicitarPermissaoNotificacao();
    carregarPedidos();
    configurarPusher();
    atualizarIconeSom();
    
    if (isNativeApp) {
        limparNotificacoesNativas();
        registerNativePush();
    }
}

async function realizarLogin() {
    const usuario = document.getElementById('login-usuario').value;
    const senha = document.getElementById('login-senha').value;
    const btn = document.getElementById('btn-login');
    const btnText = document.getElementById('btn-login-text');
    
    if (!usuario || !senha) {
        exibirErroLogin("Preencha todos os campos!");
        return;
    }
    
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) errorDiv.style.display = 'none';

    if (btn) btn.disabled = true;
    if (btnText) btnText.innerText = "Entrando...";
    
    try {
        // Tenta fazer login como Admin primeiro
        let res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
        });
        
        let data;
        if (res.ok) {
            data = await res.json();
            localStorage.setItem('cozinha_logado', 'true');
            localStorage.setItem('cozinha_token', data.token);
            mostrarToast("Login realizado com sucesso!", "success");
            location.reload();
            return;
        }
        
        // Se falhar como admin, tenta como garçom
        res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
        });
        
        if (res.ok) {
            data = await res.json();
            localStorage.setItem('cozinha_logado', 'true');
            localStorage.setItem('cozinha_token', data.token);
            mostrarToast("Login realizado com sucesso!", "success");
            location.reload();
        } else if (res.status === 429) {
            Swal.fire({
                title: 'Sistema de Segurança',
                text: 'Muitas tentativas incorretas. Conta bloqueada por 15 minutos.',
                icon: 'warning',
                confirmButtonColor: '#e67e22',
                confirmButtonText: 'OK'
            });
            if (btn) btn.disabled = false;
            if (btnText) btnText.innerText = "Entrar";
        } else {
            exibirErroLogin("Usuário ou senha incorretos.\n\nPor favor, verifique os dados digitados e tente novamente. Caso o erro persista, confirme suas credenciais com a gerência.");
            if (btn) btn.disabled = false;
            if (btnText) btnText.innerText = "Entrar";
        }
    } catch (e) {
        console.error(e);
        exibirErroLogin("Erro de conexão ao realizar login.");
        if (btn) btn.disabled = false;
        if (btnText) btnText.innerText = "Entrar";
    }
}

function exibirErroLogin(mensagem) {
    Swal.fire({
        title: 'Acesso Negado',
        text: mensagem,
        icon: 'error',
        confirmButtonColor: '#e74c3c',
        confirmButtonText: 'Tentar Novamente'
    });
}

function logout() {
    localStorage.removeItem('cozinha_logado');
    localStorage.removeItem('cozinha_token');
    location.reload();
}

// Bateria (executa solto no boot nativo)
(async () => {
    if (isNativeApp) {
        try {
            const { BatteryOptimization } = Capacitor.Plugins;
            if (BatteryOptimization) {
                const { enabled } = await BatteryOptimization.isBatteryOptimizationEnabled();
                if (enabled) {
                    Swal.fire({
                        title: 'Atenção à Bateria 🔋',
                        text: 'Para não perder pedidos com a tela desligada, o aplicativo não pode sofrer economia de energia. Clique abaixo e permita ignorar as otimizações.',
                        icon: 'warning',
                        confirmButtonText: 'CONFIGURAR BATERIA',
                        confirmButtonColor: '#e67e22',
                        allowOutsideClick: false
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            try {
                                await BatteryOptimization.requestIgnoreBatteryOptimization();
                            } catch(e) {
                                await BatteryOptimization.openBatteryOptimizationSettings();
                            }
                        }
                    });
                }
            }
        } catch(e) { console.warn('Aviso Bateria:', e); }
    }
})();

function verificarSessao() {
    const logado = localStorage.getItem('cozinha_logado');
    const token = localStorage.getItem('cozinha_token');
    const telaLogin = document.getElementById('tela-login');
    const header = document.getElementById('main-header');
    const container = document.getElementById('pedidos-container');
    
    if (logado && token) {
        if (telaLogin) telaLogin.style.display = 'none';
        if (header) header.style.display = 'block';
        if (container) container.style.display = 'grid';
        iniciarApp();
    } else {
        if (telaLogin) telaLogin.style.display = 'flex';
        if (header) header.style.display = 'none';
        if (container) container.style.display = 'none';
    }
}

document.addEventListener('visibilitychange', () => {
  if (isNativeApp && (document.visibilityState === 'visible' || document.visibilityState === 'hidden')) {
    limparNotificacoesNativas();
  }
});

// Atualizar tempos a cada segundo para o efeito de cronômetro
setInterval(atualizarCronometros, 1000);

// Recarregar lista completa a cada minuto para garantir sincronia
setInterval(carregarPedidos, 60000);

// Desbloqueia áudio no primeiro clique do usuário
document.addEventListener('click', () => {
    if (audioDesbloqueado) return;
    audioDesbloqueado = true;
    
    audioNotificacao.muted = true;
    audioNotificacao.play().then(() => {
        audioNotificacao.pause();
        audioNotificacao.currentTime = 0;
        // Só desmuda se o som estiver ativo
        if (somAtivo) {
            audioNotificacao.muted = false;
        }
        console.log('🔊 Áudio preparado!');
    }).catch(e => console.log('Erro ao preparar áudio:', e));
}, { once: true });


// --- FECHAR PAINEL AO CLICAR FORA ---
document.addEventListener('click', function(event) {
    const painel = document.getElementById('painel-notificacoes');
    if (!painel || painel.style.display === 'none') return;
    
    if (!painel.contains(event.target)) {
        const clicouNoSino = event.target.closest('[onclick*="togglePainelNotificacoes"]');
        if (!clicouNoSino) {
            painel.style.display = 'none';
        }
    }
});

// ─── CONFIGURAÇÃO DE TOASTS DINÂMICOS ───────────────────────────────────────
let _toastTemplates = [];

async function carregarConfiguracoesToasts() {
  try {
    const res = await fetch('/api/toast-config/listar');
    const data = await res.json();
    if (data.success) {
      _toastTemplates = data.templates;
    }
  } catch (err) {
    console.error('Erro ao carregar configurações de Toasts:', err);
  }
}

function deveTocarSom(evento) {
  const c = typeof _toastTemplates !== 'undefined' ? _toastTemplates.find(x => x.evento === evento) : null;
  return c ? c.som !== false : true;
}

function dispararToastSistema(evento, dados = {}, fallbackText = '', fallbackTipo = 'success') {
  const config = _toastTemplates.find(x => x.evento === evento);
  const ativo = config ? config.ativo : true;
  if (!ativo) {
    console.log(`💬 [Toast Alertas] Evento [${evento}] está desativado pelo administrador.`);
    return;
  }
  
  const template = config ? config.texto : fallbackText;
  if (!template) return;
  
  const mesaVal = dados.mesa_numero || dados.mesaNum || dados.mesa_id || dados.nMesa || dados.mesa || '';
  const clienteVal = dados.cliente || dados.nomeExibicao || '';
  const itensVal = dados.itens || '';
  const statusVal = dados.status || '';
  const msgVal = dados.mensagem || '';
  
  let msgFinal = template
    .replace(/{mesa}/g, mesaVal)
    .replace(/{cliente}/g, clienteVal)
    .replace(/{itens}/g, itensVal)
    .replace(/{status}/g, statusVal)
    .replace(/{mensagem}/g, msgVal);
    
  const tipo = config ? (config.tipo === 'erro' ? 'error' : (config.tipo === 'sucesso' ? 'success' : 'info')) : fallbackTipo;
  mostrarToast(msgFinal, tipo);
}
