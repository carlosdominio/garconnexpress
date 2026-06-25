const API_BASE_URL = 'https://garconnexpress.vercel.app';

let isNativeApp = (window.Capacitor && window.Capacitor.isNativePlatform()) || 
                  window.location.protocol === 'capacitor:' || 
                  (window.location.hostname === 'localhost' && (window.location.protocol === 'http:' || window.location.protocol === 'https:') && !window.location.port);

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
const audioNotificacao = new Audio('/notificacao.mp3');
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
    if (audioNotificacao) audioNotificacao.muted = !somAtivo;
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
    if (somAtivo && audioDesbloqueado) {
        audioNotificacao.currentTime = 0;
        audioNotificacao.play().catch(e => {
            console.warn('Erro ao tocar áudio:', e);
            // Tenta desbloquear novamente se falhou
            audioDesbloqueado = false; 
        });
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
    // Se o caixa estiver fechado, não carregamos pedidos
    const caixaAberto = await verificarCaixa();
    if (!caixaAberto) return;

    try {
        const res = await fetch('/api/pedidos/cozinha');        
        if (!res.ok) throw new Error('Erro na resposta da API');
        const itens = await res.json();
        renderizarPedidos(itens);
    } catch (e) {
        console.error('❌ Erro ao carregar pedidos:', e);        
        setTimeout(carregarPedidos, 5000);
    }
}

async function verificarCaixa() {
    try {
        const res = await fetch(`/api/caixa/status?_t=${new Date().getTime()}`);
        const caixa = await res.json();
        
        if (!caixa) {
            return false;
        }
        
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

function mostrarNotificacaoCancelamento(mensagem, pedidoId, mesaNumero, isDelivery) {
    console.log(`🗑️ Verificando cancelamento do pedido ${pedidoId}... isDelivery=${isDelivery}`);
    
    if (pedidoId) {
        const card = document.getElementById(`pedido-card-${pedidoId}`);
        if (card) {
            card.remove();
        }
        
        const todosCards = document.querySelectorAll('.card-pedido');
        todosCards.forEach(c => {
            if (c.innerText.includes(`#${pedidoId}`)) {
                c.remove();
            }
        });
    }

    const strMesa = mesaNumero ? `Mesa ${mesaNumero}` : 'BALCÃO';

    // A validação agora é feita pelo backend (data.para_cozinha), logo se o evento chegou aqui, a cozinha DEVE ser avisada
    mostrarToast(`❌ PEDIDO CANCELADO: ${strMesa}`, 'erro');
    const modal = document.getElementById('modal-cancelamento');
    const modalMsg = document.getElementById('modal-mensagem');
    
    if (modal && modalMsg) {
        modalMsg.innerHTML = `O Pedido <strong>#${pedidoId} (${strMesa})</strong> foi cancelado!<br><br><span style="font-size: 1rem; color: #7f8c8d;">Detalhe: ${mensagem}</span>`;
        modal.classList.add('active');
        tocarSomNotificacao('campainha');
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

        canal.bind('novo-pedido', (data) => {
            console.log('Novo pedido recebido!', data);
            
            if (data && data.para_cozinha === true) {
                const mesa = (data.pedido && data.pedido.mesa_numero) || data.mesa_numero || 'BALCÃO';
                const labelMesa = mesa.includes('DELIVERY') ? mesa : `Mesa ${mesa}`;
                mostrarToast(`🍳 NOVO PEDIDO: ${labelMesa}`);
                exibirNotificacaoNativa(`🍳 NOVO PEDIDO: ${labelMesa}`, "Um novo pedido chegou para a cozinha!", `pedido-${data.pedido_id || 'novo'}`);
                tocarSomNotificacao('campainha');
                tocarSomNotificacao('windows');
            }
            
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('pedido-cancelado', (data) => {
            console.log('📢 Pedido cancelado recebido:', data);
            
            // O backend injeta isso para nos dizer se a cozinha tem itens afetados
            if (data.para_cozinha === false) return;

            const idParaCancelar = data.id || data.pedido_id;
            const isDelivery = data.garcom_id === 'DELIVERY' || (data.pedido && data.pedido.garcom_id === 'DELIVERY');
            if (idParaCancelar) {
                mostrarNotificacaoCancelamento(data.mensagem || `Cancelado pelo Admin`, idParaCancelar, data.mesa_numero, isDelivery);
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
                tocarCampainha();
                mostrarToast("O expediente foi encerrado pelo administrador. O caixa está FECHADO.", "error", "💰 CAIXA FECHADO");
            } else if (data.status === 'aberto') {
                tocarCampainha();
                mostrarToast("O caixa foi aberto! Bom trabalho.");
                carregarPedidos();
            }
        });

        canal.bind('status-atualizado', (data) => {
            console.log('📢 Status atualizado recebido:', data);
            if (data && data.status === 'cancelado') {
                if (data.para_cozinha === false) return; // Trava de segurança: não notifica cozinha se não houver itens de cozinha
                const idParaCancelar = data.pedido_id || data.id;
                const isDelivery = data.garcom_id === 'DELIVERY' || (data.pedido && data.pedido.garcom_id === 'DELIVERY');
                mostrarNotificacaoCancelamento(data.mensagem || `Cancelado pelo Admin`, idParaCancelar, data.mesa_numero, isDelivery);
            } else if (data && (data.status === 'itens_atualizados' || data.status === 'itens_adicionados')) {
                const card = document.getElementById(`pedido-card-${data.pedido_id || data.id}`);
                if (card) {
                    const mesa = data.mesa_numero || 'X';
                    mostrarToast(`📝 Mesa ${mesa}: Itens atualizados`);
                    tocarSomNotificacao('campainha');
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
      await PushNotifications.createChannel({
        id: 'pedidos',
        name: 'Pedidos Cozinha',
        sound: 'notificacao',
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

      // Verifica se é um evento de fechamento de caixa
      if (notification.data && notification.data.event === 'status-caixa-atualizado') {
        console.log('📲 [FCM Background] Caixa atualizado (Cozinha):', notification.data);
        if (typeof verificarCaixa === 'function') verificarCaixa();
        return;
      }

      // Verifica se é um evento de pedido atrasado
      if (notification.data && notification.data.event === 'pedido-atrasado') {
        console.log('📲 [FCM Background] Pedido atrasado (Cozinha):', notification.data);
        if (typeof exibirNotificacaoNativa === 'function') {
          exibirNotificacaoNativa('⚠️ ATRASO NA COZINHA', notification.body || 'Um pedido está atrasado!', `atraso-cozinha-fcm`);
        }
        // if (typeof tocarSomNotificacao === 'function') tocarSomNotificacao(); // Removido para evitar duplicidade
        if (typeof carregarPedidos === 'function') carregarPedidos();
        return;
      }

      // tocarCampainha(); // Removido para evitar som duplo com o websocket
      if (window.Capacitor && window.Capacitor.Plugins.Haptics) {
        try {
          await window.Capacitor.Plugins.Haptics.vibrate();
        } catch (e) { console.error("Erro vibração:", e); }
      }

      if (typeof carregarPedidos === 'function') carregarPedidos();
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('🖱️ Clique na notificação detectado (Cozinha):', notification);
      // Se clicou em notificação de caixa, sincroniza
      if (notification.notification && notification.notification.data && notification.notification.data.event === 'status-caixa-atualizado') {
        if (typeof verificarCaixa === 'function') verificarCaixa();
        return;
      }
      
      // Se clicou na notificação de atraso, carrega os pedidos
      if (notification.notification && notification.notification.data && notification.notification.data.event === 'pedido-atrasado') {
        if (typeof carregarPedidos === 'function') carregarPedidos();
        return;
      }
      if (typeof carregarPedidos === 'function') carregarPedidos();
    });

  } catch (error) {
    console.error('❌ Erro Push Nativo:', error);
  }
}

function iniciarApp() {
    solicitarPermissaoNotificacao();
    carregarPedidos();
    configurarPusher();
    atualizarIconeSom();
    
    if (isNativeApp) {
        limparNotificacoesNativas();
        registerNativePush();

        // Sincroniza o status do caixa sempre que o app voltar ao primeiro plano
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            console.log('👀 [Cozinha] Voltou ao foco. Verificando caixa e pedidos...');
            if (typeof verificarCaixa === 'function') verificarCaixa();
            if (typeof carregarPedidos === 'function') carregarPedidos();
          }
        });
    }

    const ov = document.getElementById('loading-app');
    setTimeout(() => {
        if (ov) ov.classList.add('hidden');
    }, 600);
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
    
    const ov = document.getElementById('loading-app');
    const ovMsg = document.getElementById('loading-text');
    if (ov && ovMsg) {
        ov.classList.remove('hidden');
        ovMsg.textContent = 'Entrando...';
    }

    setTimeout(async () => {
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
            if (ovMsg) ovMsg.textContent = 'Carregando pedidos...';
            setTimeout(() => location.reload(), 400);
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
            if (ovMsg) ovMsg.textContent = 'Carregando pedidos...';
            setTimeout(() => location.reload(), 400);
        } else if (res.status === 429) {
            if (ov) ov.classList.add('hidden');
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
            if (ov) ov.classList.add('hidden');
            exibirErroLogin("Usuário ou senha incorretos.\n\nPor favor, verifique os dados digitados e tente novamente. Caso o erro persista, confirme suas credenciais com a gerência.");
            if (btn) btn.disabled = false;
            if (btnText) btnText.innerText = "Entrar";
        }
    } catch (e) {
        if (ov) ov.classList.add('hidden');
        console.error(e);
        exibirErroLogin("Erro de conexão ao realizar login.");
        if (btn) btn.disabled = false;
        if (btnText) btnText.innerText = "Entrar";
    }
    }, 600); // Fim do setTimeout do login
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

async function logout() {
    const confirm = await Swal.fire({
        title: 'Sair do Painel?',
        text: 'Você precisará fazer login novamente para acessar a cozinha.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e74c3c',
        cancelButtonColor: '#95a5a6',
        confirmButtonText: 'Sim, sair',
        cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
        const ov = document.getElementById('loading-app');
        const ovMsg = document.getElementById('loading-text');
        if (ov && ovMsg) {
            ov.classList.remove('hidden');
            ovMsg.textContent = 'Saindo do painel...';
        }
        setTimeout(() => {
            localStorage.removeItem('cozinha_logado');
            localStorage.removeItem('cozinha_token');
            location.reload();
        }, 500);
    }
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
    const ov = document.getElementById('loading-app');
    const ovMsg = document.getElementById('loading-text');

    if (ov && ovMsg) {
        ov.classList.remove('hidden');
        ovMsg.textContent = 'Sincronizando painel da cozinha...';
    }
    
    if (logado && token) {
        if (telaLogin) telaLogin.style.display = 'none';
        if (header) header.style.display = 'block';
        if (container) container.style.display = 'grid';
        iniciarApp();
    } else {
        if (telaLogin) telaLogin.style.display = 'flex';
        if (header) header.style.display = 'none';
        if (container) container.style.display = 'none';
        if (ov) ov.classList.add('hidden'); // Esconde o loading caso precise exibir o login
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

if (window.Capacitor && window.Capacitor.Plugins.SplashScreen) { window.Capacitor.Plugins.SplashScreen.hide(); }
