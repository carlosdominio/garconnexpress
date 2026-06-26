/**
 * Motoboy Express - Aplicativo Nativo (Remake Pro)
 * Versão 2.0.3 - Estabilidade Máxima
 */

const API_BASE_URL = 'https://garconnexpress.vercel.app';
const NOTIFICATION_CHANNEL_ID = 'pedidos';

const App = {
    state: {
        token: localStorage.getItem('motoboy_token'),
        user: JSON.parse(localStorage.getItem('motoboy_user') || '{}'),
        pedidos: [],
        caixaAberto: true,
        soundEnabled: localStorage.getItem('motoboy_sound') === 'true',
        notifiedEvents: new Set(), // Para evitar duplicidade estrita (evento + id)
        notificacoes: []
    },

    async init() {
        console.log('🚀 Inicializando Motoboy App v2.0.3...');

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
        
        if (!this.checkAuth()) return;

        try {
            await this.notifications.init();
            await this.pusher.init();
        } catch (e) {
            console.error('Erro na inicialização de módulos:', e);
        }
        
        this.checkCaixaStatus();
        setInterval(() => this.checkCaixaStatus(), 30000);

        this.loadPedidos();

        this.ui.updateSoundIcon();
        if (!localStorage.getItem('audio_unlocked')) {
            this.ui.requestAudioUnlock();
        }
    },

    checkAuth() {
        const screen = document.getElementById('login-screen');
        if (!this.state.token) {
            if (screen) screen.style.display = 'flex';
            document.body.style.overflow = 'hidden';
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

            if (!usuario || !senha) {
                Swal.fire({
                    title: 'Atenção',
                    text: 'Por favor, preencha todos os campos antes de entrar.',
                    icon: 'warning',
                    confirmButtonColor: '#e67e22',
                    customClass: { container: 'my-swal-container' }
                });
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENTRANDO...';
            }

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
                    
                    Swal.fire({
                        title: 'Acesso Autorizado',
                        text: `Olá ${data.garcom.nome}, bom trabalho!`,
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    setTimeout(() => location.reload(), 2000);
                } else if (res.status === 429) {
                    Swal.fire({
                        title: 'Sistema de Segurança',
                        text: 'Muitas tentativas incorretas. Conta bloqueada por 15 minutos.',
                        icon: 'warning',
                        confirmButtonColor: '#e67e22',
                        confirmButtonText: 'OK',
                        customClass: {
                            container: 'my-swal-container'
                        }
                    });
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                    }
                } else {
                    console.log('❌ Login falhou: Resposta do servidor indicou falha.');
                    Swal.fire({
                        title: 'Acesso Negado',
                        text: 'Usuário ou senha incorretos. Verifique seus dados e tente novamente.',
                        icon: 'error',
                        confirmButtonColor: '#e74c3c',
                        confirmButtonText: 'TENTAR NOVAMENTE',
                        customClass: {
                            container: 'my-swal-container'
                        }
                    });
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                    }
                }
            } catch (err) {
                console.error('❌ Erro na requisição de login (catch block):', err);
                Swal.fire({
                    title: 'Erro de Conexão',
                    text: 'Não foi possível conectar ao servidor. Verifique sua internet.',
                    icon: 'warning',
                    confirmButtonText: 'OK',
                    customClass: {
                        container: 'my-swal-container'
                    }
                });
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                }
            }
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
            const res = await fetch(`${API_BASE_URL}/api/caixa/status`);
            const status = await res.json();
            this.state.caixaAberto = !!status;
            const screen = document.getElementById('closed-screen');
            if (screen) {
                screen.style.display = this.state.caixaAberto ? 'none' : 'flex';
                document.body.style.overflow = this.state.caixaAberto ? '' : 'hidden';
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
            localStorage.removeItem('motoboy_token');
            localStorage.removeItem('motoboy_user');
            location.reload();
        }
    },

    // --- GERENCIADOR DE NOTIFICAÇÕES ---
    notifications: {
        audio: new Audio(`${API_BASE_URL}/notificacao.mp3`),

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
                if (document.visibilityState === 'visible' || document.visibilityState === 'hidden') {
                    await this.clearNotifications();
                }
            });

            let perm = await PushNotifications.checkPermissions();
            if (perm.receive !== 'granted') {
                perm = await PushNotifications.requestPermissions();
            }

            if (perm.receive === 'granted') {
                await PushNotifications.createChannel({
                    id: NOTIFICATION_CHANNEL_ID,
                    name: 'Pedidos e Alertas',
                    sound: 'notificacao.mp3',
                    importance: 5,
                    visibility: 1,
                    vibration: true
                });
                await PushNotifications.register();
            }

            PushNotifications.addListener('registration', (token) => {
                App.state.lastPushToken = token.value;
                this.syncToken(token.value);
            });

            PushNotifications.addListener('pushNotificationReceived', (notification) => {
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
                    
                    this.playAlert();
                    App.ui.showToast(notification.body || 'Novo alerta!', 'info', notification.title);
                }
            });

            PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
                console.log('Push action performed:', notification);
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

        playAlert() {
            if (document.hidden) return; // Evita conflito com som nativo em segundo plano
            if (!App.state.soundEnabled) return;
            
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                
                // Plim suave estilo WhatsApp
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.08);
                
                gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
                gainNode.gain.linearRampToValueAtTime(0.6, audioCtx.currentTime + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
                
                osc.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                
                osc.start();
                osc.stop(audioCtx.currentTime + 0.3);
            } catch (e) {
                this.audio.currentTime = 0;
                this.audio.play().catch(err => console.log('Áudio bloqueado:', err));
            }
        },

        toggleSound() {
            App.state.soundEnabled = !App.state.soundEnabled;
            localStorage.setItem('motoboy_sound', App.state.soundEnabled);
            App.ui.updateSoundIcon();
            if (App.state.soundEnabled) {
                this.playAlert();
                App.ui.showToast("Som ativado!", "success");
            } else {
                App.ui.showToast("Som silenciado.", "warning");
            }
        },
        toggleSoundManual() {
            const check = document.getElementById('check-som');
            App.state.soundEnabled = check ? check.checked : !App.state.soundEnabled;
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
                
                this.channel.bind('status-caixa-atualizado', () => App.checkCaixaStatus());

                this.channel.bind('status-atualizado', (data) => {
                    if (data.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(data.pedido_id || '');
                    if (['cancelado', 'pronto', 'servido', 'saiu_entrega'].includes(data.status) && pId) {
                        let title = 'Motoboy Pro';
                        let body = `Pedido #${pId} atualizado!`;
                        if (data.status === 'cancelado') { title = '❌ PEDIDO CANCELADO'; body = `Pedido #${pId} foi cancelado.`; }
                        if (data.status === 'pronto') { title = '🍳 PEDIDO PRONTO'; body = `Pedido #${pId} pronto na cozinha.`; }
                        if (data.status === 'servido' || data.status === 'saiu_entrega') { title = '🛵 A CAMINHO'; body = `Pedido #${pId} saiu para entrega!`; }
                        
                        App.notifications.showLocal(title, body, `${data.status}_${pId}`);
                    }
                });

                this.channel.bind('novo-pedido', (data) => {
                    const p = data.pedido || data;
                    if (p.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(p.id || p.pedido_id || '');
                    if (pId) {
                        App.notifications.showLocal(`🆕 NOVO DELIVERY`, `Pedido #${pId} recebido!`, `novo_${pId}`);
                    }
                });

                this.channel.bind('pedido-cancelado', (data) => {
                    const pId = String(data.pedido_id || data.id || (data.pedido ? data.pedido.id : '') || '');
                    if (String(data.garcom_id) !== 'DELIVERY' && !(data.pedido && String(data.pedido.garcom_id) === 'DELIVERY')) return;
                    App.loadPedidos();
                    if (pId) {
                        App.notifications.showLocal(`❌ PEDIDO REMOVIDO`, `O pedido #${pId} foi cancelado.`, `cancelado_${pId}`);
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
                label.innerText = App.state.soundEnabled ? '🔊 SOM' : '🔇 MUDO';
                label.style.color = App.state.soundEnabled ? '#2ecc71' : '#bdc3c7';
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
                buttonHTML = `<button class="btn-entregar" style="background:#f39c12; box-shadow: 0 4px 0 #d68910; cursor:not-allowed;" disabled><i class="fas fa-clock"></i> AGUARDANDO COZINHA</button>`;
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

        showToast(msg, tipo = 'success', titulo = '') {
            if (typeof this.adicionarNotificacaoPainel === 'function') this.adicionarNotificacaoPainel(msg, titulo, tipo);
            let c = document.getElementById('toast-container');
            if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
            const t = document.createElement('div');
            t.className = `toast-notificacao ${tipo}`;
            t.innerHTML = `<div class="toast-content"><strong>${titulo || ''}</strong><br>${msg}</div>`;
            c.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4000);
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
