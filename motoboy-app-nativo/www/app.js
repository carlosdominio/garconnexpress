/**
 * Motoboy Express - Aplicativo Nativo (Remake Pro)
 * Versão 2.0.3 - Estabilidade Máxima
 */

const API_BASE_URL = 'https://garconnexpress.vercel.app';
const NOTIFICATION_CHANNEL_ID = 'pedidos';

const isNativeApp = (window.Capacitor && window.Capacitor.isNativePlatform()) || 
                    navigator.userAgent.includes('Capacitor') || 
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
    // Tenta o endpoint principal do servidor
    const res = await fetch(`${API_BASE_URL}/api/config/som-global`);
    if (res.ok) {
      const data = await res.json();
      // Aceita tanto {success, somMotoboy} quanto {somMotoboy} direto
      const somMotoboy = data.somMotoboy || data.som_motoboy;
      if (somMotoboy) {
        localStorage.setItem('motoboy_som_global', somMotoboy);
        console.log('🔔 Som global carregado:', somMotoboy);
        return;
      }
    }
  } catch (err) {
    console.warn('Aviso: endpoint som-global indisponível, tentando fallback...');
  }
  // Fallback: tenta /api/config/som (endpoint de controle ativo/inativo)
  try {
    const res2 = await fetch(`${API_BASE_URL}/api/config/som`);
    if (res2.ok) {
      const data2 = await res2.json();
      // Se mp3_ativo = false, usa 'mudo'. Senão mantém o último salvo ou usa padrão
      if (data2.mp3_ativo === false) {
        localStorage.setItem('motoboy_som_global', 'mudo');
      } else {
        // Mantém o som já salvo ou usa campainha_classica como padrão
        if (!localStorage.getItem('motoboy_som_global') || localStorage.getItem('motoboy_som_global') === 'mudo') {
          localStorage.setItem('motoboy_som_global', 'campainha_classica');
        }
      }
    }
  } catch (err2) {
    console.error('Erro ao carregar som global motoboy:', err2);
  }
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
        console.log('🚀 Inicializando Motoboy App v2.0.3...');
        
        const ov = document.getElementById('loading-app');
        const ovMsg = document.getElementById('loading-text');
        if (ov && ovMsg) {
            ov.classList.remove('hidden');
            ovMsg.textContent = 'Sincronizando entregas...';
        }

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
        
        try {
            await this.notifications.init();
        } catch (e) {
            console.error('Erro ao inicializar notificações no boot:', e);
        }
        
        if (!this.checkAuth()) return;

        try {
            await carregarConfiguracoesToasts();
            await this.pusher.init();
        } catch (e) {
            console.error('Erro na inicialização de módulos pós-login:', e);
        }
        
        this.checkCaixaStatus();
        setInterval(() => this.checkCaixaStatus(), 30000);

        this.loadPedidos();

        this.ui.updateSoundIcon();
        localStorage.setItem('audio_unlocked', 'true');

        setTimeout(() => {
            if (ov) ov.classList.add('hidden');
            if (window.Capacitor && window.Capacitor.Plugins.SplashScreen) {
                window.Capacitor.Plugins.SplashScreen.hide();
            }
        }, 600);
    },

    checkAuth() {
        const screen = document.getElementById('login-screen');
        const ov = document.getElementById('loading-app');
        if (!this.state.token) {
            if (screen) screen.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (ov) ov.classList.add('hidden'); // Esconde o loading para mostrar o login
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

            const ov = document.getElementById('loading-app');
            const ovMsg = document.getElementById('loading-text');
            if (ov && ovMsg) {
                ov.classList.remove('hidden');
                ovMsg.textContent = 'Entrando...';
            }

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
                    
                    if (ovMsg) ovMsg.textContent = 'Carregando entregas do sistema...';
                    App.ui.showToast("Login realizado com sucesso!", "success");
                    setTimeout(() => location.reload(), 1000);

                } else if (res.status === 429) {
                    if (ov) ov.classList.add('hidden');
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
                    if (ov) ov.classList.add('hidden');
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
                if (ov) ov.classList.add('hidden');
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
            const status = await res.json();
            const wasOpen = App.state.caixaAberto;
            const isOpenNow = !!status;
            
            if (wasOpen === isOpenNow) return; // Se não mudou, não faz nada
            
            App.state.caixaAberto = isOpenNow;
            const screen = document.getElementById('closed-screen');
            if (screen) {
                screen.style.display = isOpenNow ? 'none' : 'flex';
                document.body.style.overflow = isOpenNow ? '' : 'hidden';
                
                if (wasOpen !== null) { // Não notifica na primeira carga
                    if (!isOpenNow) {
                        dispararToastSistema('status-caixa-atualizado', { status: 'FECHADO' }, "O caixa foi fechado! Bom descanso.", "error");
                    } else {
                        dispararToastSistema('status-caixa-atualizado', { status: 'ABERTO' }, "O caixa foi aberto! Bom trabalho.", "success");
                    }
                }
            }
            if (!isOpenNow) {
                if (typeof App.ui.limparNotificacoes === 'function') App.ui.limparNotificacoes();
            }
        } catch (e) { console.error("Erro status caixa:", e); }
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
            const ov = document.getElementById('loading-app');
            const ovMsg = document.getElementById('loading-text');
            if (ov && ovMsg) {
                ov.classList.remove('hidden');
                ovMsg.textContent = 'Saindo da conta...';
            }
            
            setTimeout(() => {
                localStorage.removeItem('motoboy_token');
                localStorage.removeItem('motoboy_user');
                location.reload();
            }, 500);
        }
    },

    // --- GERENCIADOR DE NOTIFICAÇÕES ---
    notifications: {
        somTiposDisponiveis: ['original', 'campainha_classica', 'sino_moderno', 'alerta_digital', 'alerta_urgente', 'suave'],
        audiosNotificacao: {},
        inicializarAudios() {
            for (const som of this.somTiposDisponiveis) {
                this.audiosNotificacao[som] = new Audio(getSoundPath(som));
            }
            // Desbloqueia o áudio no primeiro clique na tela (Autoplay Policy Bypass)
            const self = this;
            document.body.addEventListener('click', function unlockAudio() {
                for (const som of self.somTiposDisponiveis) {
                    const aud = self.audiosNotificacao[som];
                    if (aud) {
                        aud.play().then(() => {
                            aud.pause();
                            aud.currentTime = 0;
                        }).catch(() => {});
                    }
                }
                console.log('🔊 Áudios desbloqueados por interação do usuário!');
                document.body.removeEventListener('click', unlockAudio);
            }, { once: true });
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

            // Limpa ao voltar para primeiro plano OU ao ir para segundo plano (ao sair do app)
            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible') {
                    await this.clearNotifications();
                    // Sincroniza o status do caixa ao voltar ao primeiro plano
                    App.checkCaixaStatus();
                } else if (document.visibilityState === 'hidden') {
                    await this.clearNotifications();
                }
            });

            // =====================================================================
            // CRIA TODOS OS CANAIS DE SOM ANTES DE PEDIR PERMISSÃO
            // (igual ao app do Garçom - garante que os canais existam sempre)
            // =====================================================================
            if (window.Capacitor.getPlatform() === 'android') {
                const sons = {
                    'original': 'notificacao',
                    'campainha_classica': 'campainha_classica',
                    'sino_moderno': 'sino_moderno',
                    'alerta_digital': 'alerta_digital',
                    'alerta_urgente': 'alerta_urgente',
                    'suave': 'suave'
                };

                // Apaga canais antigos
                try { await PushNotifications.deleteChannel({ id: 'pedidos' }); } catch(e) {}
                try { await PushNotifications.deleteChannel({ id: 'motoboy_v1' }); } catch(e) {}

                // Cria TODOS os canais personalizados
                for (const [somTipo, somRec] of Object.entries(sons)) {
                    const canalId = 'motoboy_canal_' + somTipo;
                    try {
                        await PushNotifications.createChannel({
                            id: canalId,
                            name: 'Alertas (' + somTipo.replace(/_/g, ' ') + ')',
                            description: 'Canal de alerta do Motoboy com som ' + somTipo,
                            sound: somRec,
                            importance: 5,
                            visibility: 1,
                            vibration: true
                        });
                        console.log('✅ Canal criado: ' + canalId);
                    } catch (e) {
                        console.error('Erro ao criar canal ' + canalId + ':', e);
                    }
                }
            }

            // Agora verifica/solicita permissão
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive !== 'granted') {
                perm = await PushNotifications.requestPermissions();
            }

            if (perm.receive === 'granted') {
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

                App.loadPedidos();
                const pId = String(notification.data?.pedido_id || '');
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
                    
                    // Toca o som quando o app recebe a notificação FCM em foreground
                    App.notifications.playAlert();
                    App.ui.showToast(notification.body || 'Novo alerta!', 'info', notification.title);
                }
            });

            PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
                console.log('Push action performed:', notification);
                // Se clicou em notificação de caixa, sincroniza
                if (notification.notification && notification.notification.data && notification.notification.data.event === 'status-caixa-atualizado') {
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
            // NOTA: Não bloquear por document.hidden — no Android nativo o áudio
            // deve tocar mesmo com a tela apagada ou o app em background parcial.
            if (!App.state.soundEnabled) return;
            const resolvedSom = somTipo || localStorage.getItem('motoboy_som_global') || 'campainha_classica';
            if (resolvedSom === 'mudo') return;

            const audioObj = this.audiosNotificacao[resolvedSom] || this.audiosNotificacao['campainha_classica'];
            if (audioObj) {
                audioObj.muted = false;
                audioObj.currentTime = 0;
                audioObj.play().catch(err => {
                    console.warn('Erro ao tocar áudio pré-carregado:', err);
                    // Fallback: nova instância
                    const fallbackAudio = new Audio(getSoundPath(resolvedSom));
                    fallbackAudio.play().catch(e => {
                        // Segundo fallback: som original
                        const emergency = new Audio(getSoundPath('original'));
                        emergency.play().catch(e2 => console.error('Falha crítica de áudio:', e2));
                    });
                });
            }
        },
        toggleSoundManual() {
            App.state.soundEnabled = !App.state.soundEnabled;
            localStorage.setItem('motoboy_sound', App.state.soundEnabled);
            App.ui.updateSoundIcon();
            if (App.state.soundEnabled) {
                this.playAlert();
                App.ui.showToast("Som ativado!", "success");
            } else {
                App.ui.showToast("Som silenciado.", "warning");
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
                    console.log('📢 Teste de Toast recebido no Motoboy:', data);
                    if (App.audio && typeof App.audio.playBell === 'function') App.audio.playBell(data.som_tipo);
                    const tipo = data.tipo === 'erro' ? 'error' : (data.tipo === 'sucesso' ? 'success' : 'info');
                    App.ui.showToast(data.mensagem || '', tipo);
                });

                this.channel.bind('som-global-atualizado', (data) => {
                    console.log('🔄 Som global updated:', data);
                    localStorage.setItem('motoboy_som_global', data.somMotoboy || 'campainha_classica');
                });

                this.channel.bind('comunicado-geral', (data) => {
                    console.log('📢 Evento recebido: comunicado-geral', data);
                    if (data.destinatario === 'todos' || data.destinatario === 'motoboy') {
                        if (App.audio && typeof App.audio.playBell === 'function') App.audio.playBell();
                        App.notifications.showLocal('📢 COMUNICADO GERAL', data.mensagem || '', 'broadcast');
                        App.ui.showToast(data.mensagem || '', 'info');
                    }
                });

                this.channel.bind('pedido-atrasado-motoboy', (data) => {
                    console.log('📢 Evento: pedido-atrasado-motoboy', data);
                    if (App.audio && typeof App.audio.playBell === 'function') App.audio.playBell();
                    App.notifications.showLocal('⚠️ ENTREGA ATRASADA', data.mensagem || '', 'atrasado');
                    App.ui.showToast(data.mensagem || '', 'error');
                });

                this.channel.bind('status-caixa-atualizado', () => App.checkCaixaStatus());

                this.channel.bind('status-atualizado', (data) => {
                    if (data.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(data.pedido_id || '');
                    if (['pronto', 'servido', 'saiu_entrega', 'entregue'].includes(data.status) && pId) {
                        if (App.audio && typeof App.audio.playBell === 'function') App.audio.playBell();
                        let title = 'Motoboy Pro';
                        let body = `Pedido #${pId} updated!`;
                        if (data.status === 'pronto') {
                            title = '🍳 PEDIDO PRONTO';
                            body = `Pedido #${pId} pronto na cozinha.`;
                            dispararToastSistema('pedido-pronto', { mesa: 'Delivery', pedido_id: pId }, body, 'success');
                        }
                        if (data.status === 'servido' || data.status === 'saiu_entrega') {
                            title = '🛵 A CAMINHO';
                            body = `Pedido #${pId} saiu para entrega!`;
                            dispararToastSistema('saiu-entrega', { mesa: 'Delivery', pedido_id: pId }, body, 'info');
                        }
                        if (data.status === 'entregue') {
                            title = '✅ ENTREGUE';
                            body = `Pedido #${pId} finalizado!`;
                            dispararToastSistema('pedido-entregue', { mesa: 'Delivery', pedido_id: pId }, body, 'success');
                        }
                        
                        App.notifications.showLocal(title, body, `${data.status}_${pId}`);
                    }
                });

                this.channel.bind('novo-pedido', (data) => {
                    const p = data.pedido || data;
                    if (p.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(p.id || p.pedido_id || '');
                    if (pId) {
                        if (App.audio && typeof App.audio.playBell === 'function') App.audio.playBell();
                        dispararToastSistema('novo-pedido', { mesa: 'Delivery', pedido_id: pId }, `Novo pedido recebido #${pId}`, 'info');
                        App.notifications.showLocal(`🆕 NOVO DELIVERY`, `Pedido #${pId} recebido!`, `novo_${pId}`);
                    }
                });

                this.channel.bind('pedido-cancelado', (data) => {
                    const pId = String(data.pedido_id || data.id || (data.pedido ? data.pedido.id : '') || '');
                    if (String(data.garcom_id) !== 'DELIVERY' && !(data.pedido && String(data.pedido.garcom_id) === 'DELIVERY')) return;
                    if (data.para_cozinha === true) return; // Cozinha já vai lidar com o cancelamento
                    App.loadPedidos();
                    if (pId) {
                        const mesaStr = data.mesa_numero || 'Delivery';
                        dispararToastSistema('pedido-cancelado', { mesa: mesaStr, pedido_id: pId }, `O pedido #${pId} foi cancelado.`, 'error');
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
            const icone = document.getElementById('icone-som');
            const btn = document.getElementById('btn-som');
            if (icone) {
                icone.className = App.state.soundEnabled ? 'fas fa-volume-up' : 'fas fa-volume-mute';
            }
            if (btn) {
                if (App.state.soundEnabled) {
                    btn.style.background = 'rgba(255,255,255,1)';
                    btn.style.color = '#e67e22';
                } else {
                    btn.style.background = 'rgba(255,255,255,0.2)';
                    btn.style.color = 'white';
                }
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

            Object.values(sections).forEach(s => { if(s) s.innerHTML = ''; });
            const n = { 'a-caminho': 0, 'pendente': 0, 'entregue': 0 };

            App.state.pedidos.forEach(p => {
                const s = String(p.status).toLowerCase();
                let cat = 'pendente';
                if (s === 'entregue' || s === 'aguardando_fechamento') cat = 'entregue';
                else if (['pronto', 'servido', 'saiu_entrega'].includes(s)) cat = 'a-caminho';
                
                if (sections[cat]) {
                    sections[cat].appendChild(this.createCard(p, cat));
                    n[cat]++;
                }
            });

            Object.keys(sections).forEach(k => {
                if (sections[k] && n[k] === 0) sections[k].innerHTML = '<div class="empty-state">Nenhum pedido.</div>';
                if (counts[k]) counts[k].innerText = n[k];
            });
        },

        createCard(p, cat) {
            const card = document.createElement('div');
            card.className = `pedido-card ${cat}`;
            const time = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isDone = cat === 'entregue';
            const isReady = cat === 'a-caminho';

            let cliente = "Consumidor";
            let endereco = "Entrega no balcão/Local";
            let contato = "Não informado";

            if (p.observacao) {
                const lines = p.observacao.split('\n');
                const lNome = lines.find(l => l.includes('👤 Cliente:'));
                const lEnd = lines.find(l => l.includes('🏠 End:'));
                const lTel = lines.find(l => l.includes('📞 Tel:') || l.includes('📱 WhatsApp:'));

                if (lNome) cliente = lNome.replace('👤 Cliente:', '').trim();
                if (lEnd) endereco = lEnd.replace('🏠 End:', '').trim();
                if (lTel) contato = lTel.replace(/📞 Tel:|📱 WhatsApp:/, '').trim();
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
                const res = await fetch(`${API_BASE_URL}/api/pedidos/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
                    body: JSON.stringify({ status: 'aguardando_fechamento' })
                });
                if (res.ok) App.loadPedidos(); else btn.disabled = false;
            } catch (e) { btn.disabled = false; }
        },

        showToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
            if (typeof this.adicionarNotificacaoPainel === 'function') this.adicionarNotificacaoPainel(msg, titulo, tipo);
            if ("Notification" in window && Notification.permission === "granted") {
                try {
                    new Notification(titulo || (tipo === 'success' ? 'SUCESSO' : tipo.toUpperCase()), { body: msg, tag: 'toast-' + Date.now(), renotify: true });
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
  const pedidoIdVal = dados.pedido_id || dados.id || dados.pedidoId || '';
  
  let msgFinal = template
    .replace(/{mesa}/g, mesaVal)
    .replace(/{cliente}/g, clienteVal)
    .replace(/{itens}/g, itensVal)
    .replace(/{status}/g, statusVal)
    .replace(/{pedido_id}/g, pedidoIdVal)
    .replace(/{mensagem}/g, msgVal);
    
  const tipo = config ? (config.tipo === 'erro' ? 'error' : (config.tipo === 'sucesso' ? 'success' : 'info')) : fallbackTipo;
  App.ui.showToast(msgFinal, tipo);
}
