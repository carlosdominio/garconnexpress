const API_BASE_URL = 'https://garconnexpress.vercel.app';

function exibirTelaCarregamentoSistema(titulo = 'Carregando...', mensagem = 'Aguarde um instante enquanto preparamos o aplicativo.') {
  let modal = document.getElementById('screen-loading-overlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'screen-loading-overlay';
    modal.style.cssText = `
      position: fixed; inset: 0; width: 100vw; height: 100vh;
      background: linear-gradient(135deg, #0f172a, #1e293b);
      z-index: 9999999; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 24px;
      box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif;
    `;
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background: rgba(30, 41, 59, 0.95); border: 1px solid rgba(255,255,255,0.12); border-radius: 24px; padding: 36px 28px; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); backdrop-filter: blur(16px); box-sizing: border-box;">
      <div style="position: relative; width: 70px; height: 70px; margin: 0 auto 20px auto; display: flex; align-items: center; justify-content: center;">
        <div style="position: absolute; inset: 0; border: 4px solid rgba(230,126,34,0.2); border-top: 4px solid #e67e22; border-radius: 50%; animation: spinOverlay 0.8s linear infinite;"></div>
        <span style="font-size: 2rem; user-select: none;">⚡</span>
      </div>
      <style>
        @keyframes spinOverlay { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
      <h2 style="margin: 0 0 8px 0; font-size: 1.35rem; font-weight: 800; color: #f8fafc; text-transform: uppercase; letter-spacing: 0.5px;">${titulo}</h2>
      <p style="margin: 0; font-size: 0.9rem; color: #94a3b8; line-height: 1.5;">${mensagem}</p>
    </div>
  `;
  modal.style.display = 'flex';
}

function ocultarTelaCarregamentoSistema() {
  const modal = document.getElementById('screen-loading-overlay');
  if (modal) modal.style.display = 'none';
}

let isNativeApp = (window.Capacitor && window.Capacitor.isNativePlatform()) || 
                  navigator.userAgent.includes('Capacitor') || 
                  navigator.userAgent.includes('GarconnExpress') || 
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
    const token = localStorage.getItem('churrasqueiro_token');
    
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

    const method = (args[1] && args[1].method) ? args[1].method.toUpperCase() : 'GET';
    const isMutatingCall = (method === 'POST' || method === 'PUT' || method === 'DELETE') && typeof url === 'string' && url.includes('/api/');
    if (isMutatingCall && typeof showLoading === 'function') {
        showLoading(true, 'Processando...');
    }

    try {
        const response = await originalFetch(...args);

        // Se sessão expirar (401/403)
        if ((response.status === 401 || response.status === 403) && !args[0].includes('/api/login') && !args[0].includes('/api/admin/login')) {
            console.warn("⚠️ Sessão expirada ou acesso negado (401/403).");
            localStorage.removeItem('churrasqueiro_logado');
            localStorage.removeItem('churrasqueiro_token');
            window.location.reload();
        }
        return response;
    } catch (error) {
        console.error("❌ ERRO DE REDE/FETCH:", error, "URL:", args[0]);
        throw error;
    } finally {
        if (isMutatingCall && typeof showLoading === 'function') {
            showLoading(false);
        }
    }
};

let pusher;
let canal;
let timeoutPusher;
const container = document.getElementById('pedidos-container');
const somTiposDisponiveis = ['original', 'campainha_classica', 'sino_moderno', 'alerta_digital', 'alerta_urgente', 'suave', 'sino_cristal', 'alerta_moderno'];
const audiosNotificacao = {};
function inicializarAudios() {
  for (const som of somTiposDisponiveis) {
    const audio = new Audio(getSoundPath(som));
    audio.preload = 'auto';
    audio.load();
    audiosNotificacao[som] = audio;
  }
}
inicializarAudios();
const statusConexao = document.getElementById('status-conexao');

let somAtivo = localStorage.getItem('churrasqueiro_som_ativo') !== 'false';
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
      if (audiosNotificacao[som]) {
        audiosNotificacao[som].muted = !somAtivo;
      }
    }
}

function alternarSom() {
    const check = document.getElementById('check-som');
    somAtivo = check ? check.checked : !somAtivo;
    localStorage.setItem('churrasqueiro_som_ativo', somAtivo);
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

    const somTipo = localStorage.getItem('churrasqueiro_som_global') || 'sino_moderno';
    if (somTipo === 'mudo') return;

    if (somAtivo) {
        let audioObj = audiosNotificacao[somTipo];
        if (!audioObj) {
            audioObj = new Audio(getSoundPath(somTipo));
            audiosNotificacao[somTipo] = audioObj;
        }
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

function getSoundPath(somTipo) {
  if (somTipo === 'original') {
    return 'notificacao.mp3';
  }
  const file = somTipo ? `${somTipo}.wav` : 'sino_moderno.wav';
  return `sons/${file}`;
}

async function carregarSomGlobalChurrasco() {
  try {
    const res = await fetch('/api/config/som-global');
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('churrasqueiro_som_global', data.somChurrasco || 'sino_moderno');
    }
  } catch (err) {
    console.error('Erro ao carregar som global churrasqueiro:', err);
  }
}

let pedidosAtrasadosNotificados = new Set();

// Elemento auxiliar global para evitar erro com o bind do clique
const audioNotificacao = new Audio('/notificacao.mp3');

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
    tocarCampainha();
}

const _ultimosToastsExibidos = new Map();
function normalizarTextoToast(str) {
  if (!str) return '';
  return str.toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, '')
    .trim();
}

function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
    const msgNormalizada = normalizarTextoToast(msg);
    const agora = Date.now();
    
    for (const [key, value] of _ultimosToastsExibidos.entries()) {
        if (agora - value > 4000) {
            _ultimosToastsExibidos.delete(key);
            continue;
        }
        const keyNormalizada = normalizarTextoToast(key);
        if (msgNormalizada === keyNormalizada || 
            (msgNormalizada.length >= 10 && keyNormalizada.includes(msgNormalizada)) ||
            (keyNormalizada.length >= 10 && msgNormalizada.includes(keyNormalizada))) {
            console.log('⚠️ Ignorando toast duplicado (comparação inteligente):', msg);
            return;
        }
    }
    _ultimosToastsExibidos.set(msg, agora);

    if (typeof adicionarNotificacaoPainel === 'function') adicionarNotificacaoPainel(msg, titulo, tipo);
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const t = document.createElement('div');
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

    if (typeof exibirNotificacaoNativa === 'function') {
        exibirNotificacaoNativa(titulo || (classeTipo.toUpperCase() + ": " + (icones[classeTipo] || "")), msg, 'toast-' + Date.now());
    }

    setTimeout(() => t.classList.add('show'), 10);

    const autoClose = setTimeout(() => fecharToast(t), duracao);

    t.querySelector('.toast-close').onclick = () => {
        clearTimeout(autoClose);
        fecharToast(t);
    };
}

function fecharToast(el) {
    el.classList.remove('show');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
}

// IDs de pedidos do churrasco já conhecidos (para detectar novos com segurança)
let _churrascoPedidosConhecidos = null;
let _primeiroCarregamentoChurrasco = true;
// IDs já notificados pelo FCM (evita tocar o som duas vezes se for notificado via Push)
const _fcmPedidosJaNotificados = new Set();

async function carregarPedidos(opcoes = {}) {
    const { verificarNovos = false } = opcoes;
    const container = document.getElementById('pedidos-container');
    
    if (_primeiroCarregamentoChurrasco) {
        if (typeof showLoading === 'function') {
            showLoading(true, 'Carregando pedidos...');
        }
    }
    try {
        const [caixaRes, pedidosRes] = await Promise.all([
            fetch('/api/caixa/status'),
            fetch('/api/pedidos/churrasco')
        ]);
        
        const closedScreen = document.getElementById('closed-screen');
        const header = document.getElementById('main-header');

        if (caixaRes.ok) {
            const caixa = await caixaRes.json();
            if (!caixa) {
                if (container) container.style.display = 'none';
                if (closedScreen) closedScreen.style.display = 'flex';
                if (header) header.style.opacity = '0.3';
                if (typeof limparNotificacoes === 'function') limparNotificacoes();
                _churrascoPedidosConhecidos = new Set();
                return;
            }
        }

        if (container) container.style.display = 'grid';
        if (closedScreen) closedScreen.style.display = 'none';
        if (header) header.style.opacity = '1';
        
        if (pedidosRes.ok) {
            const itens = await pedidosRes.json();
            const itensValidos = Array.isArray(itens) ? itens : [];

            if (_churrascoPedidosConhecidos !== null) {
                const idsAtuais = new Set(itensValidos.map(i => i.pedido_id));
                const novosIds = [...idsAtuais].filter(id => !_churrascoPedidosConhecidos.has(id));
                if (novosIds.length > 0) {
                    console.log(`🍢 [Churrasco] Novos pedidos detectados pela API: ${novosIds.join(', ')}`);
                    const primeiroNovo = itensValidos.find(i => novosIds.includes(i.pedido_id));
                    const mesa = primeiroNovo?.mesa_numero || 'BALCÃO';
                    const labelMesa = (String(mesa).includes('DELIVERY') || String(mesa).startsWith('Mesa')) ? mesa : `Mesa ${mesa}`;
                    dispararToastSistema('novo-pedido', { mesa: labelMesa, pedido_id: novosIds[0] }, `🍢 NOVO PEDIDO: ${labelMesa}`, 'success');
                    if (deveTocarSom('novo-pedido')) tocarSomNotificacao('campainha');
                }
                _churrascoPedidosConhecidos = idsAtuais;
            } else {
                // Primeira carga: memoriza os IDs existentes + os já notificados pelo FCM, sem notificar nada
                _churrascoPedidosConhecidos = new Set(itensValidos.map(i => i.pedido_id));
                _fcmPedidosJaNotificados.forEach(id => _churrascoPedidosConhecidos.add(String(id)));
                console.log('🔕 [Churrasco] Pedidos do FCM absorvidos no carregamento inicial:', [..._fcmPedidosJaNotificados]);
            }

            renderizarPedidos(itensValidos);
        } else {
            console.warn('⚠️ Resposta da API de pedidos não OK:', pedidosRes.status);
            renderizarPedidos([]);
        }
    } catch (e) {
        console.error('❌ Erro ao carregar pedidos:', e);
        const container = document.getElementById('pedidos-container');
        if (container && container.innerHTML.includes('Carregando pedidos...')) {
            renderizarPedidos([]);
        }
        setTimeout(carregarPedidos, 5000);
    } finally {
        _primeiroCarregamentoChurrasco = false;
        if (typeof ocultarTelaCarregamentoSistema === 'function') {
            ocultarTelaCarregamentoSistema();
        }
        if (typeof showLoading === 'function') {
            showLoading(false);
        }
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

async function verificarCaixaManual(btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> VERIFICANDO...';
  }
  try {
    const res = await fetch('/api/caixa/status');
    const caixa = await res.json();
    const aberto = !!caixa;
    if (!aberto) {
      if (typeof dispararToastSistema === 'function') {
        dispararToastSistema('status-caixa-atualizado', { status: 'FECHADO' }, "O caixa continua fechado no momento.", 'error');
      }
    } else {
      verificarCaixa();
      carregarPedidos();
    }
  } catch (e) {
    console.error('Erro ao verificar caixa:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync-alt"></i> ATUALIZAR STATUS';
    }
  }
}

function renderizarPedidos(itens) {
    const container = document.getElementById('pedidos-container');
    if (!container) return;
    const t0 = performance.now();

    const itensValidos = itens.filter(item => {
        const pStatus = (item.pedido_status || '').toLowerCase();
        const iStatus = (item.item_status || '').toLowerCase();

        if (pStatus === 'cancelado' || iStatus === 'cancelado') return false;
        if (pStatus && !['recebido', 'aguardando_fechamento'].includes(pStatus)) return false;

        return true;
    });

    if (!itensValidos || itensValidos.length === 0) {
        container.innerHTML = '<div class="sem-pedidos"><h2>🍢 Nenhum pedido pendente</h2></div>';
        const t1 = performance.now();
        console.log(`⚡ [Performance Churrasqueiro] Vazio. Tempo: ${(t1 - t0).toFixed(2)}ms. Nós recriados: 1.`);
        return;
    }

    const pedidosMap = {};
    itensValidos.forEach(item => {
        if (!pedidosMap[item.pedido_id]) {
            console.log(`📦 [Churrasqueiro] Agrupando Pedido #${item.pedido_id}`);
            
            const isDelivery = item.garcom_id === 'DELIVERY';
            const isCliente = item.garcom_id === 'CLIENTE';
            const mesaNome = isDelivery ? `DELIVERY #${item.pedido_id}` : (item.mesa_numero ? `Mesa ${item.mesa_numero}` : 'BALCÃO');
            let garcomDisplay = item.garcom_nome || item.garcom_id || 'Garçom';
            if (isDelivery) garcomDisplay = 'Delivery';
            else if (isCliente) garcomDisplay = 'Cardápio Digital';
            else if (garcomDisplay === 'ADMIN') garcomDisplay = 'Painel Admin';

            pedidosMap[item.pedido_id] = {
                id: item.pedido_id,
                mesa: mesaNome,
                garcom_nome: garcomDisplay,
                is_delivery: isDelivery,
                created_at: item.created_at,
                pedido_observacao: item.pedido_observacao,
                itens: []
            };
        }
        pedidosMap[item.pedido_id].itens.push(item);
    });

    const pedidosSorted = Object.values(pedidosMap).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const semPedidos = container.querySelector('.sem-pedidos');
    if (semPedidos) {
        semPedidos.remove();
    }

    const currentCardIds = new Set(pedidosSorted.map(p => String(p.id)));
    const existingCards = Array.from(container.querySelectorAll('.card-pedido'));

    let nosRecriados = 0;
    let nosDeletados = 0;

    // 1. Remove cards obsoletos
    existingCards.forEach(card => {
        const id = card.dataset.id;
        if (!currentCardIds.has(id)) {
            const itemRowsCount = card.querySelectorAll('.item-pedido').length;
            nosDeletados += 8 + (itemRowsCount * 4);
            card.remove();
        }
    });

    // 2. Insere ou atualiza os cards ativos na ordem correta
    pedidosSorted.forEach(pedido => {
        let card = document.getElementById(`pedido-card-${pedido.id}`);
        const cardInnerHTML = `
            <div class="card-header" style="${pedido.is_delivery ? 'background: #e67e22;' : ''}">
                <div>
                    <span class="mesa-num">${pedido.mesa}</span>
                    <span class="garcom-nome" style="display: block; font-size: 0.8rem; opacity: 0.95; margin-top: 2px; font-weight: 600;">🤵 ${pedido.garcom_nome}</span>
                </div>
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

        const itemsStateKey = JSON.stringify(pedido.itens.map(i => `${i.item_id}-${i.item_status}-${i.quantidade}-${i.observacao}`));
        const cardNodesCount = 8 + (pedido.itens.length * 4);

        if (!card) {
            // Novo card (Criação de nós)
            card = document.createElement('div');
            card.className = 'card-pedido';
            card.id = `pedido-card-${pedido.id}`;
            card.dataset.id = pedido.id;
            card.dataset.mesa = pedido.mesa;
            card.dataset.obs = pedido.pedido_observacao || '';
            card.dataset.itemsState = itemsStateKey;
            card.innerHTML = cardInnerHTML;
            container.appendChild(card);

            nosRecriados += cardNodesCount;
        } else {
            // Card existente - verifica se houve mudança real
            const lastState = card.dataset.itemsState;
            if (lastState !== itemsStateKey || card.dataset.mesa !== pedido.mesa || card.dataset.obs !== (pedido.pedido_observacao || '')) {
                card.dataset.itemsState = itemsStateKey;
                card.dataset.mesa = pedido.mesa;
                card.dataset.obs = pedido.pedido_observacao || '';
                card.innerHTML = cardInnerHTML;

                nosRecriados += cardNodesCount;
            }
            // Reposiciona o card mantendo-o no DOM
            container.appendChild(card);
        }
    });

    const t1 = performance.now();
    console.log(`⚡ [Performance Churrasqueiro] Diffing DOM em ${(t1 - t0).toFixed(2)}ms. Nós recriados: ${nosRecriados}. Nós deletados: ${nosDeletados}.`);
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
                span.style.color = '#e67e22'; // Destaque Laranja-escuro/Vermelho
                span.style.fontWeight = 'bold';
                if (card) card.classList.add('card-atrasado');

                // NOTIFICAÇÃO DE ATRASO CRÍTICO (15 MIN)
                if (pedidoId && !pedidosAtrasadosNotificados.has(pedidoId)) {
                    tocarSomNotificacao();
                    exibirNotificacaoNativa(`⚠️ ATRASO NA CHURRASQUEIRA`, `Mesa ${mesa} está esperando há ${diffMin} min!`, `atraso-churrasco-${pedidoId}`);
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
        const labelMesa = (mesa.includes('DELIVERY') || mesa.startsWith('Mesa')) ? mesa : `Mesa ${mesa}`;
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
        showLoading(true, "Concluindo pedido...");
        const res = await fetch(`/api/pedidos/${pedidoId}/churrasco-pronto`, { method: 'PUT' });
        const result = await res.json();
        
        if (result.success) {
            showLoading(false);
            mostrarToast(`Pedido #${pedidoId} enviado!`, 'success');
            carregarPedidos();
        } else {
            showLoading(false);
            mostrarToast('Erro ao concluir pedido: ' + (result.error || 'Erro desconhecido'), 'error');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (e) {
        showLoading(false);
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

        canal.bind('versao-app-atualizada', (data) => {
            console.log('🔄 Versão do código atualizada pelo Admin!', data);
            if (isNativeApp) {
                verificarAtualizacaoApk('churrasqueiro');
            } else {
                exibirTelaCarregamentoSistema('⚡ Atualizando Churrasqueiro', 'O administrador aplicou novas configurações. Atualizando sistema...');
                setTimeout(() => location.reload(true), 1500);
            }
        });

        canal.bind('som-global-atualizado', (data) => {
            console.log('🔄 Som global atualizado:', data);
            localStorage.setItem('churrasqueiro_som_global', data.somChurrasco || 'sino_moderno');
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
            if (data.destinatario === 'todos' || data.destinatario === 'churrasco' || data.destinatario === 'churrasqueiro') {
                if (deveTocarSom('comunicado-geral')) tocarSomNotificacao('campainha');
                mostrarToast(data.mensagem || '', 'info', '📢 COMUNICADO GERAL');
            }
        });

        canal.bind('novo-pedido', (data) => {
            console.log('🍢 [Churrasco] novo-pedido recebido. para_churrasco=', data?.para_churrasco);
            // A notificação é controlada pelo carregarPedidos: só dispara se a API retornar itens NOVOS
            // Isso é 100% confiável pois usa o mesmo filtro SQL do endpoint /api/pedidos/churrasco
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(() => carregarPedidos({ verificarNovos: true }), 50);
        });

        canal.bind('pedido-cancelado', (data) => {
            console.log('📢 Pedido cancelado recebido:', data);
            if (data && data.para_churrasco === true) {
                const idParaCancelar = data.id || data.pedido_id;
                if (idParaCancelar) {
                    mostrarNotificacaoCancelamento(data.mensagem || `Pedido #${idParaCancelar} cancelado`, idParaCancelar);
                }
            }
            
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('pedido-atrasado-churrasco', (data) => {
            console.log('📢 Evento: pedido-atrasado-churrasco', data);
            const pId = data && (data.pedido_id || data.id);
            const jaNotificadoFCM = pId && _fcmPedidosJaNotificados.has(String(pId));

            const toastExibido = dispararToastSistema('pedido-atrasado-churrasco', { mesa: data.mesa_numero || 'Mesa', pedido_id: pId }, data.mensagem || 'O pedido do churrasco está atrasado!', 'error');
            
            if (!jaNotificadoFCM && toastExibido && deveTocarSom('pedido-atrasado-churrasco')) {
                tocarSomNotificacao('campainha');
            } else if (jaNotificadoFCM) {
                console.log('🔕 Som de atraso do pedido #' + pId + ' suprimido pois já foi notificado via FCM.');
            }
        });

        canal.bind('estoque-baixo', (data) => {
            console.log('📢 Evento: estoque-baixo', data);
            const toastExibido = dispararToastSistema('estoque-baixo', { mensagem: data.mensagem }, data.mensagem, 'warning');
            if (toastExibido && deveTocarSom('estoque-baixo')) tocarSomNotificacao('campainha');
        });

        canal.bind('menu-atualizado', () => {
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

            // Só processa alertas/toasts/sons se for um pedido do churrasco
            if (data && data.para_churrasco !== true) {
                clearTimeout(timeoutPusher);
                timeoutPusher = setTimeout(carregarPedidos, 50);
                return;
            }

            // Toasts para interações do Admin no pedido
            if (data && data.status) {
                const mesa = data.mesa_numero || 'Mesa';
                const pid = data.pedido_id || data.id || '';
                const statusToasts = {
                    'preparando':             { msg: `🍳 Pedido #${pid} da ${mesa} está sendo PREPARADO!`,            tipo: 'info'    },
                    'pronto':                 { msg: `🔔 Pedido #${pid} da ${mesa} está PRONTO para servir!`,         tipo: 'success' },
                    'servido':                { msg: `🍽️ Pedido #${pid} da ${mesa} foi SERVIDO!`,                    tipo: 'success' },
                    'entregue':               { msg: `✅ Pedido #${pid} da ${mesa} foi ENTREGUE!`,                    tipo: 'success' },
                    'saiu_entrega':           { msg: `🛵 Pedido #${pid} da ${mesa} saiu para ENTREGA!`,              tipo: 'info'    },
                    'aguardando_fechamento':  { msg: `💰 Pedido #${pid} da ${mesa} aguardando FECHAMENTO!`,           tipo: 'warning' },
                    'itens_atualizados':      { msg: `📝 ${mesa}: Itens ATUALIZADOS no pedido!`,                     tipo: 'info'    },
                    'itens_adicionados':      { msg: `➕ ${mesa}: Novos ITENS adicionados!`,                         tipo: 'info'    },
                };

                const toastInfo = statusToasts[data.status];
                if (toastInfo) {
                    dispararToastSistema('status-atualizado', { mesa, pedido_id: pid }, toastInfo.msg, toastInfo.tipo);
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
      // Remove canal legado inválido
      try { await PushNotifications.deleteChannel({ id: 'pedidos_v4' }); } catch(e) {}

      // Pré-registra o canal padrão
      await PushNotifications.createChannel({
        id: 'pedidos',
        name: 'Pedidos Churrasqueiro (Padrão)',
        description: 'Canal padrão para notificações urgentes',
        sound: 'notificacao',
        importance: 5,
        visibility: 1,
        vibration: true
      });

      // Pré-registra TODOS os canais de som disponíveis no Android
      // Isso garante que qualquer som configurado no Painel Admin já esteja registrado no dispositivo
      const todosOsSons = ['sino_moderno', 'campainha_classica', 'alerta_digital', 'alerta_urgente', 'suave', 'sino_cristal', 'alerta_moderno', 'notificacao'];
      for (const som of todosOsSons) {
        try {
          await PushNotifications.createChannel({
            id: 'churrasqueiro_canal_' + som,
            name: 'Churrasqueiro - ' + som.replace(/_/g, ' '),
            description: 'Canal de notificação com som: ' + som,
            sound: som,
            importance: 5,
            visibility: 1,
            vibration: true
          });
        } catch(e) { console.warn('Canal já existe ou erro:', som, e); }
      }
      console.log('✅ Todos os canais FCM do Churrasqueiro registrados no Android.');
    }

    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.warn('❌ Permissão de notificação negada no Android.');
      return;
    }

    await PushNotifications.register();

    PushNotifications.addListener('registration', async (token) => {
      console.log('🔥 Token FCM recebido (Churrasqueiro):', token.value);
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endpoint: token.value,
          keys: { p256dh: '', auth: '' },
          app_type: 'churrasqueiro'
        })
      });
    });

    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      console.log('📩 Notificação recebida (Churrasqueiro):', notification);
      
      const ev = notification.data ? (notification.data.event || notification.data.evento) : null;
      const pedidoId = notification.data && (notification.data.pedido_id || notification.data.id);

      // Registra SEMPRE no set de FCM (funciona mesmo se o app estava fechado e o conjunto ainda era null)
      if (pedidoId) {
        _fcmPedidosJaNotificados.add(String(pedidoId));
        if (_churrascoPedidosConhecidos !== null) {
          _churrascoPedidosConhecidos.add(String(pedidoId));
        }
        console.log('🔕 [Churrasco] Pedido', pedidoId, 'marcado via FCM foreground/bg para evitar dupla notificação');
      }

      // Se for um evento em tempo real já gerenciado pelo Pusher no foreground, apenas recarrega os pedidos
      // NOTA: 'pedido-atrasado-churrasco' NÃO está aqui pois é apenas FCM (background), não Pusher
      const eventosPusher = ['novo-pedido', 'pedido-cancelado', 'status-caixa-atualizado', 'status-atualizado', 'estoque-baixo'];
      if (ev && eventosPusher.includes(ev)) {
        console.log("Ignorando FCM foreground para evento '" + ev + "' (já tratado pelo Pusher).");
        if (typeof carregarPedidos === 'function') carregarPedidos();
        return;
      }

      // Para eventos não tratados pelo Pusher (ex: pedido-atrasado-churrasco): toca o som
      if (deveTocarSom(ev || 'status-atualizado')) tocarCampainha();
      if (window.Capacitor && window.Capacitor.Plugins.Haptics) {
        try {
          await window.Capacitor.Plugins.Haptics.vibrate();
        } catch (e) { console.error("Erro vibração:", e); }
      }

      if (typeof carregarPedidos === 'function') carregarPedidos();
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('🖱️ Clique na notificação detectado:', notification);
      // Marca o pedido como já notificado via FCM para evitar tocar o som novamente ao abrir o app
      const data = notification.notification && notification.notification.data;
      const pedidoId = data && (data.pedido_id || data.id);
      if (pedidoId) {
        _fcmPedidosJaNotificados.add(String(pedidoId));
        if (_churrascoPedidosConhecidos !== null) {
          _churrascoPedidosConhecidos.add(String(pedidoId));
        }
        console.log('🔕 [Churrasco] Pedido', pedidoId, 'marcado via clique FCM para evitar dupla notificação');
      }
      if (typeof carregarPedidos === 'function') carregarPedidos();
    });

  } catch (error) {
    console.error('❌ Erro Push Nativo:', error);
  }
}

function inicializar() {
    console.log('App Churrasqueiro iniciado.');
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
    if (notif.tipo === 'error' || notif.tipo === 'erro') corBorda = '#e67e22';
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
    exibirTelaCarregamentoSistema('Carregando...', 'Sincronizando pedidos e configurações...');
    solicitarPermissaoNotificacao();
    try {
        // Carrega o som global PRIMEIRO, pois registerNativePush usa essa configuração para criar os canais do Android
        await carregarSomGlobalChurrasco();
        await Promise.all([
            carregarConfiguracoesToasts(),
            carregarPedidos(),
            configurarPusher()
        ]);
    } catch (e) {
        console.error('Erro na inicialização do app:', e);
    }
    atualizarIconeSom();
    
    if (isNativeApp) {
        limparNotificacoesNativas();
        registerNativePush();
        verificarAtualizacaoApk('churrasqueiro');
    }
    ocultarTelaCarregamentoSistema();
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
    
    exibirTelaCarregamentoSistema('Conectando...', 'Autenticando churrasqueiro e carregando dados...');
    
    try {
        let res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
        });
        
        let data;
        if (res.ok) {
            data = await res.json();
            localStorage.setItem('churrasqueiro_logado', 'true');
            localStorage.setItem('churrasqueiro_token', data.token);
            mostrarToast("Login realizado com sucesso!", "success");
            setTimeout(() => { location.reload(); }, 1500);
            return;
        }
        
        res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
        });
        
        if (res.ok) {
            data = await res.json();
            localStorage.setItem('churrasqueiro_logado', 'true');
            localStorage.setItem('churrasqueiro_token', data.token);
            mostrarToast("Login realizado com sucesso!", "success");
            setTimeout(() => { location.reload(); }, 1500);
        } else if (res.status === 429) {
            ocultarTelaCarregamentoSistema();
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
            ocultarTelaCarregamentoSistema();
            exibirErroLogin("Usuário ou senha incorretos.\n\nPor favor, verifique os dados digitados e tente novamente. Caso o erro persista, confirme suas credenciais com a gerência.");
            if (btn) btn.disabled = false;
            if (btnText) btnText.innerText = "Entrar";
        }
    } catch (e) {
        ocultarTelaCarregamentoSistema();
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
        confirmButtonColor: '#e67e22',
        confirmButtonText: 'Tentar Novamente'
    });
}

function logout() {
    localStorage.removeItem('churrasqueiro_logado');
    localStorage.removeItem('churrasqueiro_token');
    mostrarToast("Sessão encerrada com sucesso!", "info");
    setTimeout(() => {
        location.reload();
    }, 1500);
}

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
    const logado = localStorage.getItem('churrasqueiro_logado');
    const token = localStorage.getItem('churrasqueiro_token');
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

setInterval(atualizarCronometros, 1000);
setInterval(carregarPedidos, 60000);

async function verificarAtualizacaoApk(appTipo) {
  const ua = navigator.userAgent;
  let currentVersion = null;
  let userAgentKey = '';

  if (appTipo === 'garcom') userAgentKey = 'GarconnExpressGarcom/';
  else if (appTipo === 'cozinha') userAgentKey = 'GarconnExpressCozinha/';
  else if (appTipo === 'motoboy') userAgentKey = 'GarconnExpressMotoboy/';
  else if (appTipo === 'churrasqueiro') userAgentKey = 'GarconnExpressChurrasqueiro/';

  if (ua.includes(userAgentKey)) {
    currentVersion = ua.split(userAgentKey)[1].split(' ')[0];
  } else {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
      currentVersion = '1.0.0'; // Fallback se rodar no Capacitor nativo sem UA injetado
    } else {
      return; // Se não for app nativo, não verifica APK
    }
  }

  try {
    const res = await fetch('/api/config/versao-app');
    const data = await res.json();
    if (!data.success) return;

    const serverVersion = data[`${appTipo}_apk_version`];
    const apkUrl = data[`${appTipo}_apk_url`];

    if (serverVersion && apkUrl && serverVersion !== currentVersion) {
      console.log(`[APK Update] Nova versão detectada para ${appTipo}: ${serverVersion} (Atual: ${currentVersion})`);
      
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          title: '⚠️ Atualização Obrigatória',
          text: `Uma nova versão do aplicativo (${serverVersion}) está disponível. Você precisa atualizar para continuar utilizando o sistema.`,
          icon: 'warning',
          showCancelButton: false,
          confirmButtonText: 'Baixar e Instalar Agora',
          confirmButtonColor: '#27ae60',
          allowOutsideClick: false,
          allowEscapeKey: false,
          allowEnterKey: false
        }).then((result) => {
          if (result.isConfirmed) {
            // Abre o link do APK usando o browser do Capacitor ou o do sistema
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
              window.Capacitor.Plugins.Browser.open({ url: apkUrl });
            } else {
              window.open(apkUrl, '_system');
            }
            
            // Bloqueia a tela de forma persistente
            exibirTelaCarregamentoSistema('⚡ Aplicativo Bloqueado', 'Baixando nova versão do sistema. Instale o APK para poder voltar a utilizar o ChurrasqueiroExpress.');
          }
        });
      }
    }
  } catch (err) {
    console.warn('[APK Update] Falha ao verificar atualização do APK:', err);
  }
}

const CLIENT_VERSION = '1.3.1';
async function verificarVersaoSistema() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/versao?_t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.versao && data.versao !== CLIENT_VERSION) {
            console.log(`🔄 Nova versão do sistema encontrada (${data.versao}). Recarregando...`);
            exibirTelaCarregamentoSistema('⚡ Atualizando Churrasqueiro', 'Nova versão do sistema detectada. Aplicando atualizações...');
            setTimeout(() => window.location.reload(true), 1500);
        }
    } catch (e) {
        console.error('Erro ao verificar versão do sistema:', e);
    }
}
verificarVersaoSistema();
setInterval(verificarVersaoSistema, 60 * 1000);

document.addEventListener('click', () => {
    if (audioDesbloqueado) return;
    audioDesbloqueado = true;
    
    audioNotificacao.muted = true;
    audioNotificacao.play().then(() => {
        audioNotificacao.pause();
        audioNotificacao.currentTime = 0;
        if (somAtivo) {
            audioNotificacao.muted = false;
        }
        console.log('🔊 Áudio preparado!');
    }).catch(e => console.log('Erro ao preparar áudio:', e));
}, { once: true });

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
    return false;
  }
  
  // Se config.texto for vazio/nulo, usa o fallbackText (padrão do código)
  const template = (config && config.texto) ? config.texto : fallbackText;
  if (!template) {
    console.warn(`💬 [Toast Alertas] Evento [${evento}] sem texto configurado e sem fallback.`);
    return false;
  }
  
  const mesaVal = dados.mesa_numero || dados.mesaNum || dados.mesa_id || dados.nMesa || dados.mesa || '';
  const clienteVal = dados.cliente || dados.nomeExibicao || '';
  const itensVal = dados.itens || '';
  const statusVal = dados.status || '';
  const msgVal = dados.mensagem || '';
  const pedidoIdVal = dados.pedido_id || dados.id || dados.pedidoId || '';
  
  let msgFinal = template
    .replace(/{mesa}/g, mesaVal)
    .replace(/{cliente}/g, clienteVal)
    .replace(/{itens}/g, itensVal)
    .replace(/{status}/g, statusVal)
    .replace(/{pedido_id}/g, pedidoIdVal)
    .replace(/{mensagem}/g, msgVal);
    
  const tipo = config ? (config.tipo === 'erro' ? 'error' : (config.tipo === 'sucesso' ? 'success' : 'info')) : fallbackTipo;
  mostrarToast(msgFinal, tipo);
  return true;
}

function showLoading(show = true, text = "Processando...") {
  const el = document.getElementById('loading-rapido');
  const txt = document.getElementById('loading-rapido-texto');
  if (el) {
    if (txt) txt.innerText = text;
    el.style.display = show ? 'flex' : 'none';
  }
}

// =============================================
// 🎵 MODAL DE SELEÇÃO DE TOQUE - CHURRASQUEIRO
// =============================================
const SONS_CHURRASQUEIRO = [
  { id: 'original',           label: '🔥 Original',          file: 'notificacao.mp3' },
  { id: 'sino_moderno',       label: '🔔 Sino Moderno',       file: 'sons/sino_moderno.wav' },
  { id: 'campainha_classica', label: '🎶 Campainha Clássica', file: 'sons/campainha_classica.wav' },
  { id: 'alerta_digital',     label: '📳 Alerta Digital',     file: 'sons/alerta_digital.wav' },
  { id: 'alerta_urgente',     label: '🚨 Alerta Urgente',     file: 'sons/alerta_urgente.wav' },
  { id: 'sino_cristal',       label: '🎵 Sino de Cristal',    file: 'sons/sino_cristal.wav' },
  { id: 'suave',              label: '🌿 Suave',              file: 'sons/suave.wav' },
  { id: 'mudo',               label: '🔕 Mudo',               file: null },
];

let _somPreviewAudio = null;
let _somSelecionadoTemp = null;

function abrirModalSom() {
  const modal = document.getElementById('modal-som-churrasqueiro');
  if (!modal) return;

  const somAtual = localStorage.getItem('churrasqueiro_som_global') || 'sino_moderno';
  _somSelecionadoTemp = somAtual;

  const lista = document.getElementById('lista-sons-churrasqueiro');
  lista.innerHTML = '';

  SONS_CHURRASQUEIRO.forEach(som => {
    const selecionado = som.id === somAtual;
    const item = document.createElement('div');
    item.id = `som-item-${som.id}`;
    item.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-radius: 12px; cursor: pointer;
      border: 2px solid ${selecionado ? '#e67e22' : '#eee'};
      background: ${selecionado ? '#fff5eb' : '#fafafa'};
      transition: all 0.2s;
    `;
    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:18px; height:18px; border-radius:50%; border:2px solid #e67e22;
          background:${selecionado ? '#e67e22' : 'transparent'}; flex-shrink:0;"></div>
        <span style="font-size:0.95rem; font-weight:${selecionado ? '700' : '500'}; color:#2c3e50;">${som.label}</span>
      </div>
      ${som.file ? `<button onclick="event.stopPropagation(); previewSomChurrasqueiro('${som.file}', this)" 
        style="background:#e67e22; border:none; border-radius:8px; padding:5px 10px; color:white; font-size:0.8rem; cursor:pointer; flex-shrink:0;">
        ▶ Ouvir
      </button>` : ''}
    `;
    item.addEventListener('click', () => selecionarSomChurrasqueiro(som.id));
    lista.appendChild(item);
  });

  modal.style.display = 'flex';
}

function fecharModalSom() {
  const modal = document.getElementById('modal-som-churrasqueiro');
  if (modal) modal.style.display = 'none';
  if (_somPreviewAudio) { _somPreviewAudio.pause(); _somPreviewAudio = null; }
}

function selecionarSomChurrasqueiro(somId) {
  _somSelecionadoTemp = somId;
  SONS_CHURRASQUEIRO.forEach(som => {
    const item = document.getElementById(`som-item-${som.id}`);
    if (!item) return;
    const selecionado = som.id === somId;
    item.style.borderColor = selecionado ? '#e67e22' : '#eee';
    item.style.background = selecionado ? '#fff5eb' : '#fafafa';
    const circulo = item.querySelector('div > div');
    const label = item.querySelector('div > span');
    if (circulo) circulo.style.background = selecionado ? '#e67e22' : 'transparent';
    if (label) label.style.fontWeight = selecionado ? '700' : '500';
  });
}

function previewSomChurrasqueiro(file, btn) {
  if (_somPreviewAudio) { _somPreviewAudio.pause(); _somPreviewAudio = null; }
  const basePath = isNativeApp ? '' : '/app-churrasqueiro/';
  _somPreviewAudio = new Audio(basePath + file);
  _somPreviewAudio.play().catch(e => console.warn('Preview bloqueado:', e));
  if (btn) { btn.textContent = '⏹ Stop'; btn.onclick = (ev) => { ev.stopPropagation(); if (_somPreviewAudio) { _somPreviewAudio.pause(); _somPreviewAudio = null; } btn.textContent = '▶ Ouvir'; btn.onclick = (e2) => { e2.stopPropagation(); previewSomChurrasqueiro(file, btn); }; }; }
}

async function salvarSomChurrasqueiro() {
  if (!_somSelecionadoTemp) return;
  try {
    localStorage.setItem('churrasqueiro_som_global', _somSelecionadoTemp);
    const res = await fetch('/api/config/som-global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ somChurrasco: _somSelecionadoTemp })
    });
    const data = await res.json();
    if (data.success) {
      mostrarToast('🎵 Toque salvo com sucesso!', 'success');
    } else {
      mostrarToast('⚠️ Salvo localmente (sem sync).', 'warning');
    }
  } catch (e) {
    localStorage.setItem('churrasqueiro_som_global', _somSelecionadoTemp);
    mostrarToast('🎵 Toque salvo localmente!', 'success');
  }
  fecharModalSom();
}
