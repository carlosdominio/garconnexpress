/**
 * Motoboy Express - Aplicativo Nativo (Remake Pro)
 * Versão 2.0.3 - Estabilidade Máxima
 */

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
        <div style="position: absolute; inset: 0; border: 4px solid rgba(52,152,219,0.2); border-top: 4px solid #3498db; border-radius: 50%; animation: spinOverlay 0.8s linear infinite;"></div>
        <span style="font-size: 2rem; user-select: none;">🛵</span>
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

async function verificarAtualizacaoApk(appTipo, isFromPusher = false) {
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
    const res = await fetch('/api/config/versao-app?_t=' + Date.now());
    const data = await res.json();
    if (!data.success) return;

    const serverVersion = data[`${appTipo}_apk_version`];
    const apkUrl = data[`${appTipo}_apk_url`];

    // Se o Admin voltou a versão para a mesma instalada (ou se o app já está atualizado)
    if (serverVersion === currentVersion) {
      console.log(`[APK Update] Aplicativo ${appTipo} já está com o APK atualizado (${currentVersion}).`);
      if (typeof Swal !== 'undefined' && Swal.isVisible()) {
        Swal.close();
      }
      if (isFromPusher) {
        exibirTelaCarregamentoSistema('🛵 Atualizando Entregas', 'O administrador aplicou novas configurações. Atualizando sistema...');
        setTimeout(() => location.reload(true), 1500);
      } else {
        if (typeof ocultarTelaCarregamentoSistema === 'function') {
          ocultarTelaCarregamentoSistema();
        }
      }
      return;
    }

    if (serverVersion && apkUrl && serverVersion !== currentVersion) {
      console.log(`[APK Update] Nova versão detectada para ${appTipo}: ${serverVersion} (Atual: ${currentVersion})`);
      
      const downloadEndpoint = `/api/config/download-apk/${appTipo}`;
      const finalDownloadUrl = apkUrl.startsWith('http') ? apkUrl : downloadEndpoint;

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
            // Abre o link do APK usando o browser do Capacitor ou window.open
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
              window.Capacitor.Plugins.Browser.open({ url: finalDownloadUrl });
            } else {
              window.open(finalDownloadUrl, '_system');
            }
            
            // Cria elemento <a> com atributo download para garantir o disparo
            const a = document.createElement('a');
            a.href = finalDownloadUrl;
            a.target = '_system';
            a.download = `${appTipo}-v${serverVersion}.apk`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Bloqueia a tela de forma persistente
            if (typeof exibirTelaCarregamentoSistema === 'function') {
              exibirTelaCarregamentoSistema('⚡ Aplicativo Bloqueado', 'Baixando nova versão do sistema. Instale o APK baixado para poder voltar a utilizar o MotoboyExpress.');
            }
          }
        });
      }
    }
  } catch (err) {
    console.warn('[APK Update] Falha ao verificar atualização do APK:', err);
  }
}

const API_BASE_URL = '';
const NOTIFICATION_CHANNEL_ID = 'pedidos';

const isNativeApp = (window.Capacitor && window.Capacitor.isNativePlatform()) || 
                    navigator.userAgent.includes('Capacitor') || 
                    navigator.userAgent.includes('GarconnExpress') || 
                    window.location.protocol === 'file:';

if (isNativeApp && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      registration.unregister().then(success => {
        if (success) console.log("🧹 Service Worker antigo desregistrado com sucesso no ambiente nativo!");
      });
    }
  });
}

function getSoundPath(somTipo) {
  if (somTipo === 'original') {
    const isCordova = window.cordova || window.Capacitor || window.location.protocol === 'file:';
    if (isCordova) {
      return 'notificacao.mp3';
    }
    return '/notificacao.mp3';
  }
  const file = somTipo ? `${somTipo}.wav` : 'campainha_classica.wav';
  const isCordova = window.cordova || window.Capacitor || window.location.protocol === 'file:';
  if (isCordova) {
    return `sons/${file}`;
  }
  return `/sons/${file}`;
}

async function carregarSomGlobalMotoboy() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/config/som-global`);
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('motoboy_som_global', data.somMotoboy || 'campainha_classica');
    }
  } catch (err) {
    console.error('Erro ao carregar som global motoboy:', err);
  }
}

let _toastTemplatesMotoboy = [];

async function carregarConfiguracoesToastsMotoboy() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/toast-config/listar`);
    const data = await res.json();
    if (data.success && Array.isArray(data.templates)) {
      _toastTemplatesMotoboy = data.templates;
    }
  } catch (e) {
    console.warn('⚠️ Erro ao carregar modelos de toast para Motoboy:', e.message);
  }
}

window._motoboyToastDebounce = window._motoboyToastDebounce || new Map();
function dispararToastMotoboy(evento, dados = {}, fallbackText = '', fallbackTipo = 'info') {
  const config = _toastTemplatesMotoboy.find(x => x.evento === evento);
  const ativo = config ? config.ativo !== false : true;
  if (!ativo) {
    console.log(`💬 [Motoboy Toast] Evento [${evento}] está desativado pelo administrador.`);
    return;
  }
  
  const pedidoIdVal = dados.pedido_id || dados.id || dados.pedidoId || '';
  const dedupeKey = `${evento}_${pedidoIdVal}`;
  const now = Date.now();
  if (now - (window._motoboyToastDebounce.get(dedupeKey) || 0) < 4000) {
    console.log(`⚡ [Motoboy Deduplicador] Ignorando evento duplicado: ${dedupeKey}`);
    return;
  }
  window._motoboyToastDebounce.set(dedupeKey, now);

  const template = (config && config.texto) ? config.texto : fallbackText;
  if (!template) return;
  
  const mesaVal = dados.mesa || dados.mesa_numero || dados.mesaNum || 'Delivery';
  const clienteVal = dados.cliente || dados.nomeExibicao || '';
  const itensVal = dados.itens || '';
  const statusVal = dados.status || '';
  const msgVal = dados.mensagem || '';
  const itemVal = dados.item || '';
  const qtdVal = dados.qtd || '';
  
  let msgFinal = template
    .replace(/{mesa}/g, mesaVal)
    .replace(/{cliente}/g, clienteVal)
    .replace(/{itens}/g, itensVal)
    .replace(/{status}/g, statusVal)
    .replace(/{pedido_id}/g, pedidoIdVal)
    .replace(/{mensagem}/g, msgVal)
    .replace(/{item}/g, itemVal)
    .replace(/{qtd}/g, qtdVal);

  const tipo = config ? (config.tipo === 'erro' ? 'error' : (config.tipo === 'sucesso' ? 'success' : 'info')) : fallbackTipo;
  const titulo = config ? (config.label || 'Delivery Express') : 'Delivery Express';

  App.notifications.showLocal(titulo, msgFinal, `${evento}_${pedidoIdVal || Date.now()}`);
}

const App = {
    state: {
        token: localStorage.getItem('motoboy_token'),
        user: JSON.parse(localStorage.getItem('motoboy_user') || '{}'),
        pedidos: [],
        caixaAberto: null,
        soundEnabled: localStorage.getItem('motoboy_sound') !== 'false',
        notifiedEvents: new Set(), // Para evitar duplicidade estrita (evento + id)
        notificacoes: []
    },

    audio: {
        playBell(somTipo) {
            App.notifications.playAlert(somTipo);
        }
    },

    async init() {
        App.notifications.inicializarAudios();
        carregarConfiguracoesToastsMotoboy();
        console.log('🚀 Inicializando Motoboy App v2.0.3...');
        
        exibirTelaCarregamentoSistema('Carregando...', 'Sincronizando entregas...');

        // VERIFICA OTIMIZAÇÃO DE BATERIA (Evita suspensão do Pusher e FCM)
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            try {
                const { BatteryOptimization } = Capacitor.Plugins;
                if (BatteryOptimization) {
                    const { enabled } = await BatteryOptimization.isBatteryOptimizationEnabled();
                    if (enabled) {
                        Swal.fire({
                            title: 'Atenção à Bateria 🔋',
                            text: 'Para não perder nenhum pedido com a tela desligada, o aplicativo não pode sofrer economia de energia. Clique abaixo e permita ignorar as otimizações.',
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
        
        await carregarSomGlobalMotoboy();
        
        if (!this.checkAuth()) {
            ocultarTelaCarregamentoSistema();
            return;
        }

        try {
            await this.notifications.init();
            await this.pusher.init();
        } catch (e) {
            console.error('Erro na inicialização de módulos:', e);
        }
        
        await this.checkCaixaStatus();
        // setInterval(() => this.checkCaixaStatus(), 30000); // Removido para evitar polling excessivo (agora usa apenas Pusher)

        this.loadPedidos();

        this.ui.updateSoundIcon();
        localStorage.setItem('audio_unlocked', 'true');

        this.verificarVersaoSistema();
        setInterval(() => this.verificarVersaoSistema(), 5 * 60 * 1000);

        if (isNativeApp) {
            verificarAtualizacaoApk('motoboy');
        }

        setTimeout(() => {
            ocultarTelaCarregamentoSistema();
            if (window.Capacitor && window.Capacitor.Plugins.SplashScreen) {
                window.Capacitor.Plugins.SplashScreen.hide();
            }
        }, 600);
    },

    async verificarVersaoSistema() {
        const CLIENT_VERSION = '1.3.1';
        try {
            const res = await fetch(`${API_BASE_URL}/api/versao?_t=${new Date().getTime()}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.versao && data.versao !== CLIENT_VERSION) {
                console.log(`🔄 Nova versão do sistema encontrada (${data.versao}). Recarregando...`);
                exibirTelaCarregamentoSistema('🛵 Atualizando Entregas', 'Nova versão do sistema detectada. Aplicando atualizações...');
                setTimeout(() => window.location.reload(true), 1500);
            }
        } catch (e) {
            console.error('Erro ao verificar versão do sistema:', e);
        }
    },

    checkAuth() {
        const screen = document.getElementById('login-screen');
        if (!this.state.token) {
            if (screen) screen.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            ocultarTelaCarregamentoSistema();
            if (window.Capacitor && window.Capacitor.Plugins.SplashScreen) {
                window.Capacitor.Plugins.SplashScreen.hide();
            }
            this.setupLoginForm();
            return false;
        }
        if (screen) screen.style.display = 'none';
        document.body.style.overflow = '';
        return true;
    },

    setupLoginForm() {
        const form = document.getElementById('login-form');
        if (!form) return;
        
        form.onsubmit = async (e) => {
            e.preventDefault();
            const usuario = document.getElementById('login-user').value;
            const senha = document.getElementById('login-pass').value;
            const btn = document.getElementById('btn-login-submit');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENTRANDO...';
            }

            exibirTelaCarregamentoSistema('Conectando...', 'Autenticando entregador e carregando dados...');

            // Atraso de 600ms para a tela de carregamento aparecer
            setTimeout(async () => {
                try {

                const res = await fetch(`${API_BASE_URL}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario, senha })
                });

                const data = await res.json();

                if (data.success) {
                    localStorage.setItem('motoboy_token', data.token);
                    localStorage.setItem('motoboy_user', JSON.stringify(data.garcom));
                    
                    exibirTelaCarregamentoSistema('Carregando...', 'Buscando entregas do sistema...');
                    App.ui.showToast("Login realizado com sucesso!", "success");
                    setTimeout(() => location.reload(), 1000);

                } else if (res.status === 429) {
                    ocultarTelaCarregamentoSistema();
                    Swal.fire({
                        title: 'Sistema de Segurança',
                        text: 'Muitas tentativas incorretas. Conta bloqueada por 15 minutos.',
                        icon: 'warning',
                        confirmButtonColor: '#e67e22',
                        confirmButtonText: 'OK',
                        customClass: { container: 'my-swal-container' }
                    });
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                    }
                } else {
                    ocultarTelaCarregamentoSistema();
                    console.log('❌ Login falhou: Resposta do servidor indicou falha.');
                    Swal.fire({
                        title: 'Acesso Negado',
                        text: 'Usuário ou senha incorretos. Verifique seus dados e tente novamente.',
                        icon: 'error',
                        confirmButtonColor: '#e74c3c',
                        confirmButtonText: 'TENTAR NOVAMENTE',
                        customClass: { container: 'my-swal-container' }
                    });
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                    }
                }
            } catch (err) {
                ocultarTelaCarregamentoSistema();
                console.error('❌ Erro na requisição de login (catch block):', err);
                Swal.fire({
                    title: 'Erro de Conexão',
                    text: 'Não foi possível conectar ao servidor. Verifique sua internet.',
                    icon: 'warning',
                    confirmButtonText: 'OK',
                    customClass: { container: 'my-swal-container' }
                });
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                }
            }
            }, 600); // fim setTimeout login
        };
    },

    async loadPedidos() {
        if (!this.state.token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/pedidos/ativos-detalhado`, {
                headers: { 'Authorization': `Bearer ${this.state.token}` }
            });
            
            if (res.status === 401 || res.status === 403) {
                this.logout();
                return;
            }

            const allPedidos = await res.json();
            this.state.pedidos = Array.isArray(allPedidos) ? allPedidos.filter(p => p.garcom_id === 'DELIVERY') : [];
            this.ui.renderPedidos();
        } catch (e) {
            console.error('Erro ao carregar pedidos:', e);
        }
    },

    async checkCaixaStatus() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/caixa/status?_t=${new Date().getTime()}`);
            const status = res.ok ? await res.json() : null;
            const wasOpen = App.state.caixaAberto;
            const isOpenNow = !!(status && (status.status === 'aberto' || status.id));
            
            App.state.caixaAberto = isOpenNow;
            
            const screen = document.getElementById('closed-screen');
            if (screen) {
                screen.style.display = isOpenNow ? 'none' : 'flex';
                document.body.style.overflow = isOpenNow ? '' : 'hidden';
                
                if (wasOpen !== null && wasOpen !== isOpenNow) {
                    App.notifications.playAlert(); // Toca o som configurado!
                    if (!isOpenNow) {
                        App.ui.showToast("O caixa foi fechado! Bom descanso.", "error", "🔒 CAIXA FECHADO");
                    } else {
                        App.ui.showToast("O caixa foi aberto! Bom trabalho.", "success", "✅ CAIXA ABERTO");
                    }
                }
            }
            if (!isOpenNow) {
                if (typeof App.ui.limparNotificacoes === 'function') App.ui.limparNotificacoes();
            }
            return isOpenNow;
        } catch (e) { 
            console.error("Erro status caixa:", e);
            return App.state.caixaAberto;
        }
    },

    async atualizarStatusCaixaManual(btn) {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> VERIFICANDO...';
        }
        try {
            const isOpen = await this.checkCaixaStatus();
            if (!isOpen) {
                this.ui.showToast("O caixa continua fechado no momento.", "error", "🔒 CAIXA FECHADO");
            } else {
                this.loadPedidos();
            }
        } catch (e) {
            console.error("Erro ao verificar caixa:", e);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sync-alt"></i> ATUALIZAR STATUS';
            }
        }
    },

    async logout() {
        const { isConfirmed } = await Swal.fire({
            title: 'Sair do App?',
            text: "Você precisará fazer login novamente para ver os pedidos.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e67e22',
            cancelButtonColor: '#bdc3c7',
            confirmButtonText: 'SIM, SAIR',
            cancelButtonText: 'CANCELAR'
        });

        if (isConfirmed) {
            exibirTelaCarregamentoSistema('Desconectando...', 'Limpando dados da sessão...');
            
            setTimeout(() => {
                localStorage.removeItem('motoboy_token');
                localStorage.removeItem('motoboy_user');
                location.reload();
            }, 1000);
        }
    },

    // --- GERENCIADOR DE NOTIFICAÇÕES ---
    notifications: {
        somTiposDisponiveis: ['original', 'campainha_classica', 'sino_moderno', 'alerta_digital', 'alerta_urgente', 'suave', 'sino_cristal', 'alerta_moderno'],
        audiosNotificacao: {},
        inicializarAudios() {
            for (const som of this.somTiposDisponiveis) {
                const audio = new Audio(getSoundPath(som));
                audio.preload = 'auto';
                audio.load();
                this.audiosNotificacao[som] = audio;
            }
        },

        async clearNotifications() {
            try {
                if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                    const { PushNotifications } = Capacitor.Plugins;
                    if (PushNotifications && typeof PushNotifications.removeAllDeliveredNotifications === 'function') {
                        await PushNotifications.removeAllDeliveredNotifications();
                        console.log("🧹 Notificações FCM limpas da barra de status (Motoboy).");
                    }
                }
            } catch (e) {
                console.error("Erro ao limpar notificações (Motoboy):", e);
            }
        },

        async init() {
            if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

            const { PushNotifications } = Capacitor.Plugins;

            // Limpa ao abrir
            await this.clearNotifications();

            // Sincroniza status e limpa notificações ao mudar visibilidade do app (primeiro/segundo plano)
            const handleAppStateResume = async () => {
                exibirTelaCarregamentoSistema('Carregando...', 'Sincronizando entregas...');
                await this.clearNotifications();
                await App.checkCaixaStatus();
                if (App.state.caixaAberto) {
                    await App.loadPedidos();
                }
                setTimeout(() => ocultarTelaCarregamentoSistema(), 300);
            };

            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible') {
                    await handleAppStateResume();
                } else if (document.visibilityState === 'hidden') {
                    exibirTelaCarregamentoSistema('Carregando...', 'Sincronizando entregas...');
                    await this.clearNotifications();
                }
            });

            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
                window.Capacitor.Plugins.App.addListener('appStateChange', async ({ isActive }) => {
                    if (isActive) {
                        await handleAppStateResume();
                    } else {
                        exibirTelaCarregamentoSistema('Carregando...', 'Sincronizando entregas...');
                    }
                });
            }

            let perm = await PushNotifications.checkPermissions();
            if (perm.receive !== 'granted') {
                perm = await PushNotifications.requestPermissions();
            }

            if (perm.receive === 'granted') {
                // Pré-registra o canal padrão de fallback
                await PushNotifications.createChannel({
                    id: 'pedidos',
                    name: 'Pedidos Motoboy (Padrão)',
                    description: 'Canal padrão para notificações urgentes',
                    sound: 'notificacao',
                    importance: 5,
                    visibility: 1,
                    vibration: true
                }).catch(e => console.warn('Erro ao criar canal pedidos:', e));

                // Pré-registra TODOS os canais de som disponíveis no Android (sem extensão .wav/.mp3)
                const todosOsSons = ['sino_moderno', 'campainha_classica', 'alerta_digital', 'alerta_urgente', 'suave', 'sino_cristal', 'alerta_moderno', 'notificacao'];
                for (const som of todosOsSons) {
                    try {
                        await PushNotifications.createChannel({
                            id: 'motoboy_canal_' + som,
                            name: 'Motoboy - ' + som.replace(/_/g, ' '),
                            description: 'Canal de notificação com som: ' + som,
                            sound: som,
                            importance: 5,
                            visibility: 1,
                            vibration: true
                        });
                    } catch(e) { console.warn('Canal Motoboy já existe ou erro:', som, e); }
                }
                console.log('✅ Todos os canais FCM do Motoboy registrados no Android.');
                await PushNotifications.register();
            }

            PushNotifications.addListener('registration', (token) => {
                App.state.lastPushToken = token.value;
                this.syncToken(token.value);
            });

            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                // Se for um evento de caixa, atualiza o status imediatamente
                if (notification.data && notification.data.event === 'status-caixa-atualizado') {
                    console.log('📲 [FCM Background] Caixa atualizado (Motoboy):', notification.data);
                    App.checkCaixaStatus();
                    return;
                }

                const pId = String(notification.data?.pedido_id || notification.data?.id || '');
                if (pId) {
                    App.state.notifiedEvents.add(`fcm_${pId}`);
                    console.log('🔕 [Motoboy] Pedido', pId, 'marcado via FCM foreground/bg para evitar dupla notificação');
                }

                App.loadPedidos();
                const status = String(notification.data?.status || '');
                const event = String(notification.data?.event || '');
                
                let eventKey = '';
                if (pId) {
                    if (event === 'novo-pedido') eventKey = `novo_${pId}`;
                    else if (event === 'pedido-cancelado') eventKey = `cancelado_${pId}`;
                    else if (event === 'status-atualizado' && status) eventKey = `${status}_${pId}`;
                    else eventKey = `push_${pId}`;
                } else {
                    eventKey = `push_${notification.id}`;
                }
                
                if (eventKey && !App.state.notifiedEvents.has(eventKey)) {
                    App.state.notifiedEvents.add(eventKey);
                    setTimeout(() => App.state.notifiedEvents.delete(eventKey), 15000);
                }
            });

            PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
                console.log('Push action performed:', notification);
                const data = notification.notification && notification.notification.data;
                const pId = String(data?.pedido_id || data?.id || '');
                if (pId) {
                    App.state.notifiedEvents.add(`fcm_${pId}`);
                    console.log('🔕 [Motoboy] Pedido', pId, 'marcado via clique FCM para evitar dupla notificação');
                }
                // Se clicou em notificação de caixa, sincroniza
                if (data && data.event === 'status-caixa-atualizado') {
                    App.checkCaixaStatus();
                    return;
                }
                App.loadPedidos();
            });
        },

        async syncToken(token) {
            try {
                await fetch(`${API_BASE_URL}/api/subscribe-motoboy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
                    body: JSON.stringify({ endpoint: token })
                });
            } catch (e) {}
        },

        async showLocal(title, body, eventKey = '') {
            // Se já notificamos este evento (via Push ou Pusher recentemente), ignoramos.
            if (eventKey && App.state.notifiedEvents.has(eventKey)) return;
            if (eventKey) {
                App.state.notifiedEvents.add(eventKey);
                setTimeout(() => App.state.notifiedEvents.delete(eventKey), 15000);
            }

            this.playAlert();

            // Apenas exibe o Toast informativo se o app estiver aberto (primeiro plano)
            // Não agendamos notificação nativa local se o app já está aberto, para evitar banners duplicados.
            App.ui.showToast(body, 'info', title);
        },

        playAlert(somTipo) {
            if (document.hidden) return;
            if (!App.state.soundEnabled) return;
            const resolvedSom = somTipo || localStorage.getItem('motoboy_som_global') || 'campainha_classica';
            if (resolvedSom === 'mudo') return;

            const audioObj = this.audiosNotificacao[resolvedSom] || this.audiosNotificacao['campainha_classica'];
            if (audioObj) {
                audioObj.muted = false;
                audioObj.currentTime = 0;
                audioObj.play().catch(err => {
                    console.warn('Erro ao tocar áudio pré-carregado:', err);
                    const fallbackAudio = new Audio(getSoundPath(resolvedSom));
                    fallbackAudio.play().catch(e => console.error(e));
                });
            }
        },
        toggleSoundManual() {
            const check = document.getElementById('check-som');
            App.state.soundEnabled = check ? check.checked : !App.state.soundEnabled;
            localStorage.setItem('motoboy_sound', App.state.soundEnabled);
            App.ui.updateSoundIcon();
            if (App.state.soundEnabled) {
                this.playAlert();
                App.ui.showToast("🔔 Som ativado!", "success");
            } else {
                App.ui.showToast("🔕 Som silenciado.", "warning");
            }
        }
    },

    // --- REAL-TIME (PUSHER) ---
    pusher: {
        instance: null,
        channel: null,

        async init() {
            try {
                const res = await fetch(`${API_BASE_URL}/api/pusher-config`);
                const config = await res.json();
                this.instance = new Pusher(config.key, { cluster: config.cluster, forceTLS: true });
                this.channel = this.instance.subscribe('garconnexpress');
                
                this.channel.bind('teste-toast', (data) => {
                    console.log('📢 Evento recebido: teste-toast', data);
                    if (App.audio && typeof App.audio.playBell === 'function') App.audio.playBell(data.som_tipo);
                    App.notifications.showLocal(data.titulo || 'TESTE DE ALERTA', data.mensagem || '', 'teste-toast');
                    const tipo = data.tipo === 'erro' ? 'error' : (data.tipo === 'sucesso' ? 'success' : 'info');
                    App.ui.showToast(data.mensagem || '', tipo);
                });

                this.channel.bind('versao-app-atualizada', (data) => {
                    console.log('🔄 Versão do código atualizada pelo Admin!', data);
                    if (isNativeApp) {
                        verificarAtualizacaoApk('motoboy', true);
                    } else {
                        exibirTelaCarregamentoSistema('🛵 Atualizando Entregas', 'O administrador aplicou novas configurações. Atualizando sistema...');
                        setTimeout(() => location.reload(true), 1500);
                    }
                });

                this.channel.bind('som-global-atualizado', async (data) => {
                    const novoSom = data.somMotoboy || 'campainha_classica';
                    console.log('🔄 Som global atualizado para:', novoSom);
                    const somAntigo = localStorage.getItem('motoboy_som_global') || 'campainha_classica';
                    localStorage.setItem('motoboy_som_global', novoSom);

                    // Recria o canal FCM com o novo som (para notificações em background)
                    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                        try {
                            const { PushNotifications } = Capacitor.Plugins;
                            if (PushNotifications) {
                                await PushNotifications.deleteChannel({ id: 'motoboy_canal_' + somAntigo });
                                const newCanalId = 'motoboy_canal_' + novoSom;
                                const fcmSound = novoSom === 'original' ? 'notificacao.mp3' : `${novoSom}.wav`;
                                await PushNotifications.createChannel({
                                    id: newCanalId,
                                    name: 'Pedidos e Alertas (' + novoSom + ')',
                                    sound: fcmSound,
                                    importance: 5,
                                    visibility: 1,
                                    vibration: true
                                });
                                console.log(`✅ Canal FCM recriado com som: ${fcmSound} e ID: ${newCanalId}`);
                            }
                        } catch (e) {
                            console.error('Erro ao recriar canal FCM com novo som:', e);
                        }
                    }
                });

                this.channel.bind('toast-config-atualizado', () => {
                    carregarConfiguracoesToastsMotoboy();
                });

                this.channel.bind('comunicado-geral', (data) => {
                    console.log('📢 Evento recebido: comunicado-geral', data);
                    if (data.destinatario === 'todos' || data.destinatario === 'motoboy') {
                        dispararToastMotoboy('comunicado-geral', { mensagem: data.mensagem || '' }, `📢 COMUNICADO GERAL: ${data.mensagem || ''}`, 'info');
                    }
                });

                this.channel.bind('pedido-atrasado-motoboy', (data) => {
                    console.log('📢 Evento: pedido-atrasado-motoboy', data);
                    const pId = String(data.pedido_id || '');
                    dispararToastMotoboy('pedido-atrasado-motoboy', { pedido_id: pId, mensagem: data.mensagem || '' }, `🔥 MOTOBOY: ENTREGA ATRASADA! O pedido #${pId} está parado há mais de 10 minutos!`, 'error');
                });

                this.channel.bind('status-caixa-atualizado', (data) => {
                    App.checkCaixaStatus();
                    const statusTxt = (data && data.status) ? data.status : 'atualizado';
                    dispararToastMotoboy('status-caixa-atualizado', { status: statusTxt }, `💼 Status do caixa: ${statusTxt}`, 'info');
                });

                this.channel.bind('pedido-entregue', (data) => {
                    App.loadPedidos();
                    const pId = String(data.pedido_id || data.id || '');
                    const mesaVal = data.mesa || data.mesa_numero || 'Delivery';
                    dispararToastMotoboy('pedido-entregue', { pedido_id: pId, mesa: mesaVal }, `✅ O pedido #${pId} (${mesaVal}) foi Finalizado com sucesso!`, 'success');
                });

                this.channel.bind('saiu-entrega', (data) => {
                    App.loadPedidos();
                    const pId = String(data.pedido_id || data.id || '');
                    const mesaVal = data.mesa || data.mesa_numero || 'Delivery';
                    dispararToastMotoboy('saiu-entrega', { pedido_id: pId, mesa: mesaVal }, `🛵 O pedido da ${mesaVal} saiu para entrega!`, 'info');
                });

                this.channel.bind('status-atualizado', (data) => {
                    if (data.garcom_id !== 'DELIVERY' && String(data.garcom_id) !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(data.pedido_id || data.id || '');
                    const mesaVal = data.mesa_numero || data.mesa || 'Delivery';
                    const statusStr = data.status || '';

                    if (pId) {
                        if (statusStr === 'entregue' || statusStr === 'concluido') {
                            dispararToastMotoboy('pedido-entregue', { pedido_id: pId, mesa: mesaVal }, `✅ O pedido #${pId} (${mesaVal}) foi Finalizado com sucesso!`, 'success');
                        } else if (statusStr === 'saiu_entrega' || statusStr === 'servido') {
                            dispararToastMotoboy('saiu-entrega', { pedido_id: pId, mesa: mesaVal }, `🛵 O pedido da ${mesaVal} saiu para entrega!`, 'info');
                        } else if (statusStr === 'pronto') {
                            dispararToastMotoboy('pedido-pronto', { pedido_id: pId, mesa: mesaVal }, `🍳 O pedido #${pId} (${mesaVal}) está pronto na cozinha!`, 'success');
                        }
                    }
                });

                this.channel.bind('novo-pedido', (data) => {
                    const p = data.pedido || data;
                    if (p.garcom_id !== 'DELIVERY' && String(p.garcom_id) !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(p.id || p.pedido_id || '');
                    const mesaVal = p.mesa_numero || p.mesa || 'Delivery';
                    if (pId) {
                        const isAddition = !!data.is_addition;
                        if (isAddition) {
                            dispararToastMotoboy('item-adicionado', { pedido_id: pId, mesa: mesaVal }, `➕ Novos itens adicionados no pedido #${pId}!`, 'info');
                        } else {
                            dispararToastMotoboy('novo-pedido', { pedido_id: pId, mesa: mesaVal }, `🍕 Novo pedido #${pId} recebido!`, 'info');
                        }
                    }
                });

                this.channel.bind('pedido-cancelado', (data) => {
                    const pId = String(data.pedido_id || data.id || (data.pedido ? data.pedido.id : '') || '');
                    if (String(data.garcom_id) !== 'DELIVERY' && !(data.pedido && String(data.pedido.garcom_id) === 'DELIVERY')) return;
                    if (data.para_cozinha === true) return; // Cozinha já vai lidar com o cancelamento
                    App.loadPedidos();
                    if (pId) {
                        App.notifications.showLocal(`❌ PEDIDO REMOVIDO`, `O pedido #${pId} foi cancelado.`, `cancelado_${pId}`);
                        const modal = document.getElementById('modal-cancelamento');
                        const modalMsg = document.getElementById('modal-mensagem');
                        if (modal && modalMsg) {
                            modalMsg.innerHTML = `O Delivery <strong>#${pId}</strong> foi cancelado!<br><br><span style="font-size: 1rem; color: #7f8c8d;">Detalhe: ${data.mensagem || 'Cancelado pelo administrador.'}</span>`;
                            modal.classList.add('active');
                            App.audio.playBell(); // Toca o som para alertar o motoboy
                        }
                    }
                });
            } catch (e) { console.error('Erro Pusher:', e); }
        }
    },

    // --- UI ---
    ui: {
        updateSoundIcon() {
            const check = document.getElementById('check-som');
            const label = document.getElementById('label-som');
            if (check) check.checked = App.state.soundEnabled;
            if (label) {
                label.innerText = App.state.soundEnabled ? '🔔 SOM' : '🔕 MUDO';
                label.style.color = App.state.soundEnabled ? '#2ecc71' : '#bdc3c7';
            }
            for (const som in App.notifications.audiosNotificacao) {
                const aud = App.notifications.audiosNotificacao[som];
                if (aud) aud.muted = !App.state.soundEnabled;
            }
        },
        adicionarNotificacaoPainel(mensagem, titulo, tipo) {
            App.state.notificacoes.unshift({
                id: Date.now(),
                mensagem: mensagem,
                titulo: titulo || 'Notificação',
                tipo: tipo,
                hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            });
            if (App.state.notificacoes.length > 50) App.state.notificacoes.pop();
            this.atualizarBadgeNotificacoes();
            this.renderizarListaNotificacoes();
        },
        atualizarBadgeNotificacoes() {
            const badge = document.getElementById('badge-notificacoes');
            if (!badge) return;
            if (App.state.notificacoes.length > 0) {
                badge.innerText = App.state.notificacoes.length > 99 ? '99+' : App.state.notificacoes.length;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        },
        renderizarListaNotificacoes() {
            const lista = document.getElementById('lista-notificacoes');
            if (!lista) return;
            if (App.state.notificacoes.length === 0) {
                lista.innerHTML = '<div id="notificacao-vazia" style="text-align: center; color: #7f8c8d; padding: 20px 0; font-size: 0.9rem;">Nenhuma nova notificação.</div>';
                return;
            }
            lista.innerHTML = App.state.notificacoes.map(notif => {
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
        },
        togglePainelNotificacoes() {
            const painel = document.getElementById('painel-notificacoes');
            const badge = document.getElementById('badge-notificacoes');
            if (painel.style.display === 'none') {
                painel.style.display = 'flex';
                if (badge) badge.style.display = 'none';
            } else {
                painel.style.display = 'none';
            }
        },
        limparNotificacoes() {
            App.state.notificacoes = [];
            this.atualizarBadgeNotificacoes();
            this.renderizarListaNotificacoes();
            document.getElementById('painel-notificacoes').style.display = 'none';
        },

        requestAudioUnlock() {
            Swal.fire({
                title: 'Ativar Alertas?',
                text: 'Clique para permitir o som de novos pedidos.',
                icon: 'info',
                confirmButtonText: 'ATIVAR ÁUDIO',
                confirmButtonColor: '#e67e22'
            }).then((r) => {
                if (r.isConfirmed) {
                    localStorage.setItem('audio_unlocked', 'true');
                    for (const som in App.notifications.audiosNotificacao) {
                        const aud = App.notifications.audiosNotificacao[som];
                        aud.muted = true;
                        aud.play().then(() => {
                            aud.pause();
                            aud.currentTime = 0;
                            aud.muted = !App.state.soundEnabled;
                        }).catch(e => console.warn(e));
                    }
                    App.notifications.playAlert();
                }
            });
        },

        renderPedidos() {
            const sections = {
                'a-caminho': document.getElementById('container-a-caminho'),
                'pendente': document.getElementById('container-pendentes'),
                'entregue': document.getElementById('container-entregues')
            };
            const counts = {
                'a-caminho': document.getElementById('count-pronto'),
                'pendente': document.getElementById('count-pendente'),
                'entregue': document.getElementById('count-entregues')
            };

            if (!sections['a-caminho']) return;

            const t0 = performance.now();

            const pedidosPorCat = { 'a-caminho': [], 'pendente': [], 'entregue': [] };
            const n = { 'a-caminho': 0, 'pendente': 0, 'entregue': 0 };

            App.state.pedidos.forEach(p => {
                const s = String(p.status).toLowerCase();
                let cat = 'pendente';
                if (s === 'entregue' || s === 'aguardando_fechamento') cat = 'entregue';
                else if (['pronto', 'servido', 'saiu_entrega'].includes(s)) cat = 'a-caminho';
                
                pedidosPorCat[cat].push(p);
                n[cat]++;
            });

            let nosRecriados = 0;
            let nosDeletados = 0;

            Object.keys(sections).forEach(cat => {
                const sectionContainer = sections[cat];
                if (!sectionContainer) return;

                const emptyState = sectionContainer.querySelector('.empty-state');
                if (emptyState && n[cat] > 0) {
                    emptyState.remove();
                }

                const existingCards = Array.from(sectionContainer.querySelectorAll('.pedido-card'));
                const activeIdsInCat = new Set(pedidosPorCat[cat].map(p => String(p.id)));

                existingCards.forEach(card => {
                    const id = card.dataset.id;
                    if (!activeIdsInCat.has(id)) {
                        const itemRowsCount = card.querySelectorAll('.item-row').length;
                        nosDeletados += 10 + (itemRowsCount * 2);
                        card.remove();
                    }
                });

                pedidosPorCat[cat].forEach(p => {
                    let card = document.getElementById(`delivery-card-${p.id}`);
                    const itemsStateKey = JSON.stringify(p.itens ? p.itens.map(i => `${i.menu_id}-${i.quantidade}-${i.status}`) : []);
                    const stateKey = `${p.status}-${p.total}-${itemsStateKey}-${p.observacao}`;
                    const cardNodesCount = 10 + (p.itens ? p.itens.length * 2 : 0);

                    if (!card) {
                        card = this.createCard(p, cat);
                        card.dataset.state = stateKey;
                        sectionContainer.appendChild(card);
                        nosRecriados += cardNodesCount;
                    } else {
                        if (card.parentElement !== sectionContainer || card.dataset.state !== stateKey) {
                            const isDone = cat === 'entregue';
                            const isReady = cat === 'a-caminho';
                            let displayStatus = cat.replace('-', ' ').toUpperCase();
                            if (cat === 'a-caminho') displayStatus = 'PRONTO / A CAMINHO';
                            else if (cat === 'pendente') displayStatus = 'PREPARANDO';

                            let buttonHTML = '';
                            if (isDone) {
                                buttonHTML = `<button class="btn-entregar" style="background:#bdc3c7; box-shadow:none; cursor:not-allowed;" disabled><i class="fas fa-check-double"></i> ENTREGUE</button>`;
                            } else if (isReady) {
                                buttonHTML = `<button class="btn-entregar" onclick="App.ui.confirmarEntrega(${p.id}, this)"><i class="fas fa-motorcycle"></i> CONFIRMAR ENTREGA</button>`;
                            } else {
                                buttonHTML = `<button class="btn-entregar" style="background:#94a3b8; box-shadow: 0 4px 0 #64748b; cursor:not-allowed;" disabled><i class="fas fa-clock"></i> AGUARDANDO COZINHA</button>`;
                            }

                            let cliente = "Consumidor";
                            let endereco = "Entrega no balcão/Local";
                            let contato = "Não informado";
                            if (p.observacao) {
                                const lines = p.observacao.split('\n');
                                const lNome = lines.find(l => /👤\s*Cliente:/i.test(l));
                                const lEnd = lines.find(l => /🏠\s*End:/i.test(l));
                                const lTel = lines.find(l => /(📞\s*Tel:|📱\s*WhatsApp:)/i.test(l));
                                if (lNome) cliente = lNome.replace(/👤\s*Cliente:/i, '').trim();
                                if (lEnd) endereco = lEnd.replace(/🏠\s*End:/i, '').trim();
                                if (lTel) contato = lTel.replace(/(📞\s*Tel:|📱\s*WhatsApp:)/i, '').trim();
                            }

                            card.className = `pedido-card ${cat}`;
                            card.innerHTML = `
                                <div class="pedido-header">
                                    <div>
                                        <span class="pedido-id">#${p.id}</span>
                                        <span class="status-badge ${cat}">${displayStatus}</span>
                                    </div>
                                    <div style="text-align: right;">
                                        <div class="pedido-total">R$ ${parseFloat(p.total).toFixed(2).replace('.', ',')}</div>
                                        <span class="pedido-time">${new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>
                                <div class="pedido-body">
                                    <strong class="cliente-info">${cliente}</strong>
                                    <div class="endereco-info"><i class="fas fa-map-marker-alt"></i> ${endereco}</div>
                                    <div class="contato-info" style="font-size: 0.9rem; color: #27ae60; font-weight: 700; margin-bottom: 10px;">
                                        <i class="fab fa-whatsapp"></i> ${contato}
                                    </div>
                                    <div class="pedido-itens">
                                        ${p.itens ? p.itens.map(i => `<div class="item-row">${i.quantidade}x ${i.nome}</div>`).join('') : ''}
                                    </div>
                                </div>
                                ${buttonHTML}
                            `;
                            card.dataset.state = stateKey;
                            nosRecriados += cardNodesCount;
                        }
                        sectionContainer.appendChild(card);
                    }
                });

                if (n[cat] === 0) {
                    sectionContainer.innerHTML = '<div class="empty-state">Nenhum pedido.</div>';
                }
                if (counts[cat]) counts[cat].innerText = n[cat];
            });

            const t1 = performance.now();
            console.log(`⚡ [Performance Motoboy] Diffing DOM em ${(t1 - t0).toFixed(2)}ms. Nós recriados: ${nosRecriados}. Nós deletados: ${nosDeletados}.`);
        },

        createCard(p, cat) {
            const card = document.createElement('div');
            card.className = `pedido-card ${cat}`;
            card.id = `delivery-card-${p.id}`;
            card.dataset.id = p.id;
            const time = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isDone = cat === 'entregue';
            const isReady = cat === 'a-caminho';

            let cliente = "Consumidor";
            let endereco = "Entrega no balcão/Local";
            let contato = "Não informado";

            if (p.observacao) {
                const lines = p.observacao.split('\n');
                const lNome = lines.find(l => /👤\s*Cliente:/i.test(l));
                const lEnd = lines.find(l => /🏠\s*End:/i.test(l));
                const lTel = lines.find(l => /(📞\s*Tel:|📱\s*WhatsApp:)/i.test(l));

                if (lNome) cliente = lNome.replace(/👤\s*Cliente:/i, '').trim();
                if (lEnd) endereco = lEnd.replace(/🏠\s*End:/i, '').trim();
                if (lTel) contato = lTel.replace(/(📞\s*Tel:|📱\s*WhatsApp:)/i, '').trim();
            }

            let displayStatus = cat.replace('-', ' ').toUpperCase();
            if (cat === 'a-caminho') displayStatus = 'PRONTO / A CAMINHO';
            else if (cat === 'pendente') displayStatus = 'PREPARANDO';

            let buttonHTML = '';
            if (isDone) {
                buttonHTML = `<button class="btn-entregar" style="background:#bdc3c7; box-shadow:none; cursor:not-allowed;" disabled><i class="fas fa-check-double"></i> ENTREGUE</button>`;
            } else if (isReady) {
                buttonHTML = `<button class="btn-entregar" onclick="App.ui.confirmarEntrega(${p.id}, this)"><i class="fas fa-motorcycle"></i> CONFIRMAR ENTREGA</button>`;
            } else {
                buttonHTML = `<button class="btn-entregar" style="background:#94a3b8; box-shadow: 0 4px 0 #64748b; cursor:not-allowed;" disabled><i class="fas fa-clock"></i> AGUARDANDO COZINHA</button>`;
            }

            card.innerHTML = `
                <div class="pedido-header">
                    <div>
                        <span class="pedido-id">#${p.id}</span>
                        <span class="status-badge ${cat}">${displayStatus}</span>
                    </div>
                    <div style="text-align: right;">
                        <div class="pedido-total">R$ ${parseFloat(p.total).toFixed(2).replace('.', ',')}</div>
                        <span class="pedido-time">${time}</span>
                    </div>
                </div>
                <div class="pedido-body">
                    <strong class="cliente-info">${cliente}</strong>
                    <div class="endereco-info"><i class="fas fa-map-marker-alt"></i> ${endereco}</div>
                    <div class="contato-info" style="font-size: 0.9rem; color: #27ae60; font-weight: 700; margin-bottom: 10px;">
                        <i class="fab fa-whatsapp"></i> ${contato}
                    </div>
                    <div class="pedido-itens">
                        ${p.itens ? p.itens.map(i => `<div class="item-row">${i.quantidade}x ${i.nome}</div>`).join('') : ''}
                    </div>
                </div>
                ${buttonHTML}
            `;
            return card;
        },

        async confirmarEntrega(id, btn) {
            const { isConfirmed } = await Swal.fire({ title: 'Entregue?', text: `Confirmar entrega do Pedido #${id}?`, icon: 'question', showCancelButton: true, confirmButtonText: 'Sim, entregar!' });
            if (!isConfirmed) return;
            btn.disabled = true;
            try {
                showLoading(true, "Confirmando entrega...");
                const res = await fetch(`${API_BASE_URL}/api/pedidos/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
                    body: JSON.stringify({ status: 'aguardando_fechamento' })
                });
                if (res.ok) await App.loadPedidos(); else btn.disabled = false;
            } catch (e) { btn.disabled = false; } finally {
                showLoading(false);
            }
        },

        showToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
            if (typeof this.adicionarNotificacaoPainel === 'function') this.adicionarNotificacaoPainel(msg, titulo, tipo);
            if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
                try {
                    new Notification(titulo || (tipo === 'success' ? 'SUCESSO' : tipo.toUpperCase()), { body: msg, tag: 'toast-' + Date.now(), renotify: false });
                } catch(e) {}
            }
            let c = document.getElementById('toast-container');
            if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
            
            const t = document.createElement('div');
            let classeTipo = tipo;
            if (tipo === 'sucesso') classeTipo = 'success';
            if (tipo === 'erro') classeTipo = 'error';
            
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
            c.appendChild(t);
            
            setTimeout(() => t.classList.add('show'), 10);
            
            const autoClose = setTimeout(() => {
                t.classList.remove('show');
                setTimeout(() => { if (t.parentNode) t.remove(); }, 400);
            }, duracao);
            
            t.querySelector('.toast-close').onclick = () => {
                clearTimeout(autoClose);
                t.classList.remove('show');
                setTimeout(() => { if (t.parentNode) t.remove(); }, 400);
            };
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;


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

function showLoading(show = true, text = "Processando...") {
  const el = document.getElementById('loading-rapido');
  const txt = document.getElementById('loading-rapido-texto');
  if (el) {
    if (txt) txt.innerText = text;
    el.style.display = show ? 'flex' : 'none';
  }
}

// --- DESBLOQUEIO AUTOMÁTICO DE ÁUDIO ---
let audioDesbloqueado = false;
const desbloquearAudioSistema = () => {
    if (audioDesbloqueado) return;
    audioDesbloqueado = true;

    for (const som in App.notifications.audiosNotificacao) {
        const aud = App.notifications.audiosNotificacao[som];
        if (aud) {
            const prevMuted = aud.muted;
            aud.muted = true;
            aud.play().then(() => {
                aud.pause();
                aud.currentTime = 0;
                aud.muted = prevMuted;
            }).catch(e => console.warn('Erro ao pré-tocar som para desbloqueio:', e));
        }
    }
    console.log('🔊 Áudios do aplicativo motoboy desbloqueados com sucesso no primeiro toque!');
    
    // Remove listeners para economizar recursos
    document.removeEventListener('click', desbloquearAudioSistema);
    document.removeEventListener('touchstart', desbloquearAudioSistema);
};

document.addEventListener('click', desbloquearAudioSistema);
document.addEventListener('touchstart', desbloquearAudioSistema);
