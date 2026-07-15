const express = require('express');
const helmet = require('helmet');
// v1.0.1 - Deploy forçado para ativação do menu bot
const path = require('path');
// Carregamento condicional do SQLite para evitar erros no Vercel
let Database = null;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.log("⚠️ SQLite não carregado (provavelmente ambiente Vercel/Postgres)");
}
const { Pool } = require('pg');
const Pusher = require('pusher');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const ioClient = require('socket.io-client');
const webpush = require('web-push');
const admin = require('firebase-admin');

// Configuração de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });

// --- Configuração VAPID (Web Push - Navegador) ---
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn("⚠️ AVISO: VAPID keys para Web Push ausentes nas variáveis de ambiente!");
} else {
  webpush.setVapidDetails(
    'mailto:contato@garconnexpress.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// --- Configuração Firebase Admin (App Nativo Android/iOS) ---
try {
  // Inicializa App Padrão (Garçom)
  if (admin.apps.length === 0) {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      console.log('📦 Firebase Admin (Garçom) inicializado via Variável de Ambiente.');
    } else {
      try {
        serviceAccount = require('./firebase-adminsdk.json');
        console.log('📦 Firebase Admin (Garçom) inicializado via Arquivo Local.');
      } catch (e) {
        console.log('⚠️ Arquivo firebase-adminsdk.json não encontrado.');
      }
    }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase Admin (Garçom) pronto.');
    }
  }

  // Inicializa App Secundário (Motoboy) se houver configuração
  const hasMotoboyApp = admin.apps.find(app => app.name === 'motoboy');


  if (!hasMotoboyApp) {
    let serviceAccountMotoboy;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_MOTOBOY) {
      serviceAccountMotoboy = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_MOTOBOY);
      console.log('✅ Firebase Admin (Motoboy) inicializado via Variável de Ambiente.');
    } else {
      try {
        serviceAccountMotoboy = require('./firebase-adminsdk-motoboy.json');
        console.log('✅ Firebase Admin (Motoboy) inicializado via Arquivo Local.');
      } catch (e) {
        console.log('⚠️ Arquivo firebase-adminsdk-motoboy.json não encontrado.');
      }
    }

    if (serviceAccountMotoboy) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountMotoboy)
      }, 'motoboy');
      console.log('✅ Firebase Admin (Motoboy) pronto.');
    }
  }

  // Inicializa App Terciário (Cozinha) se houver configuração
  const hasCozinhaApp = admin.apps.find(app => app.name === 'cozinha');
  if (!hasCozinhaApp) {
    let serviceAccountCozinha;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_COZINHA) {
      serviceAccountCozinha = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_COZINHA);
      console.log('✅ Firebase Admin (Cozinha) inicializado via Variável de Ambiente.');
    } else {
      try {
        serviceAccountCozinha = require('./firebase-adminsdk-cozinha.json');
        console.log('✅ Firebase Admin (Cozinha) inicializado via Arquivo Local.');
      } catch (e) {
        console.log('⚠️ Arquivo firebase-adminsdk-cozinha.json não encontrado.');
      }
    }

    if (serviceAccountCozinha) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountCozinha)
      }, 'cozinha');
      console.log('✅ Firebase Admin (Cozinha) pronto.');
    }
  }
} catch (error) {
  console.log('⚠️ Erro ao configurar Firebase Admin SDK:', error.message);
}

const app = express();
app.set('trust proxy', 1); // Necessário para Rate Limit funcionar no Vercel/Render

// Adiciona headers de segurança (desativando algumas políticas estritas para evitar quebra de imagens e recursos externos)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false
}));

// --- CORREÇÃO DE ERRO LOCAL (VERCEL ANALYTICS MOCK) ---
// Impede erro 404 e erro de MIME Type no console do navegador rodando localmente
app.use('/_vercel', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send('// Mock local do Vercel Analytics para evitar erro no console');
});

// Middleware manual para garantir que OPTIONS responda sempre com sucesso e headers corretos
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://garconnexpress.vercel.app',
    'http://localhost:3000',
    'http://localhost',
    'capacitor://localhost',
    'http://10.0.2.2'
  ];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    // Para requisições server-to-server ou app nativo antigo
    res.header('Access-Control-Allow-Origin', '*');
  }

  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Middleware de Sanitização Global (Anti-XSS) - Limpa todos os textos que o cliente envia
const sanitizeHtml = require('sanitize-html');
const sanitizePayload = (obj) => {
  for (let key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = sanitizeHtml(obj[key], { allowedTags: [], allowedAttributes: {} });
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizePayload(obj[key]);
    }
  }
};
app.use((req, res, next) => {
  if (req.body) sanitizePayload(req.body);
  if (req.query) sanitizePayload(req.query);
  next();
});
app.use(cookieParser());

// Garante que o banco de dados está inicializado para qualquer chamada de API
app.use('/api/', ensureDbInitialized);

// --- CONFIGURAÇÕES DE CARDAPIO E DELIVERY (CONTROLE INDEPENDENTE) ---
app.get('/api/configs/cardapio-status', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_aberto'");
    const status = result.rows && result.rows.length > 0 ? result.rows[0].valor === 'true' : true; // Por padrao é true
    res.json({ cardapio_aberto: status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/configs/cardapio-toggle', ensureDbInitialized, isAdmin, async (req, res) => {
  const { enabled } = req.body;
  try {
    const valor = enabled ? 'true' : 'false';
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('cardapio_aberto', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('cardapio_aberto', ?)", [valor]);
    }
    
    await safePusherTrigger('garconnexpress', 'cardapio-status-atualizado', { cardapio_aberto: enabled });
    res.json({ success: true, cardapio_aberto: enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- AGENDAMENTO AUTOMÁTICO DO CARDÁPIO ---
app.get('/api/configs/cardapio-horarios', ensureDbInitialized, async (req, res) => {
  try {
    const rAuto = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_auto'");
    const rAbrir = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_hora_abrir'");
    const rFechar = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_hora_fechar'");
    
    res.json({
      cardapio_auto: rAuto.rows && rAuto.rows.length > 0 ? rAuto.rows[0].valor === 'true' : false,
      hora_abrir: rAbrir.rows && rAbrir.rows.length > 0 ? rAbrir.rows[0].valor : '',
      hora_fechar: rFechar.rows && rFechar.rows.length > 0 ? rFechar.rows[0].valor : ''
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/configs/cardapio-horarios', ensureDbInitialized, isAdmin, async (req, res) => {
  const { auto, hora_abrir, hora_fechar } = req.body;
  try {
    const salvar = async (chv, val) => {
        if (isPostgres) {
            await query("INSERT INTO sistema_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [chv, val]);
        } else {
            await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [chv, val]);
        }
    };
      
    await salvar('cardapio_auto', auto ? 'true' : 'false');
    await salvar('cardapio_hora_abrir', hora_abrir || '');
    await salvar('cardapio_hora_fechar', hora_fechar || '');
    
    if(auto) {
       verificarHorarioCardapio(hora_abrir, hora_fechar); 
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

async function verificarHorarioCardapio(hora_abrir, hora_fechar) {
    if (!hora_abrir || !hora_fechar) return;
    
    const agora = new Date();
    const options = { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false };
    const formatter = new Intl.DateTimeFormat('pt-BR', options);
    const timeParts = formatter.formatToParts(agora);
    const hour = timeParts.find(p => p.type === 'hour').value;
    const minute = timeParts.find(p => p.type === 'minute').value;
    const timeString = `${hour}:${minute}`;
    
    let deveEstarAberto = false;
    if (hora_abrir < hora_fechar) {
        deveEstarAberto = timeString >= hora_abrir && timeString < hora_fechar;
    } else {
        deveEstarAberto = timeString >= hora_abrir || timeString < hora_fechar;
    }
    
    const result = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_aberto'");
    const statusAtual = result.rows && result.rows.length > 0 ? result.rows[0].valor === 'true' : true;
    
    if (statusAtual !== deveEstarAberto) {
        const valor = deveEstarAberto ? 'true' : 'false';
        if (isPostgres) {
            await query("INSERT INTO sistema_config (chave, valor) VALUES ('cardapio_aberto', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
        } else {
            await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('cardapio_aberto', ?)", [valor]);
        }
        
        if (typeof safePusherTrigger !== 'undefined') {
            await safePusherTrigger('garconnexpress', 'cardapio-status-atualizado', { cardapio_aberto: deveEstarAberto });
        }
        console.log(`🤖 Agendamento Cardápio: Alterado para ${deveEstarAberto ? 'ABERTO' : 'FECHADO'} as ${timeString}`);
    }
}

// CRON JOB Roda a cada minuto (Apenas em ambiente local/tradicional, não no Vercel para evitar database timeouts em containers congelados)
if (!process.env.VERCEL) {
  setInterval(async () => {
      // 1. Agendamento do FCM Customizado
      try {
          await checkAndSendScheduledFCM();
      } catch(e) { console.error("Erro interval FCM:", e); }

      // 2. Horário do Cardápio Automático
      try {
          const rAuto = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_auto'");
          if (!rAuto.rows || rAuto.rows.length === 0 || rAuto.rows[0].valor !== 'true') return;

          const rAbrir = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_hora_abrir'");
          const rFechar = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_hora_fechar'");
          
          const hora_abrir = rAbrir.rows && rAbrir.rows.length > 0 ? rAbrir.rows[0].valor : null;
          const hora_fechar = rFechar.rows && rFechar.rows.length > 0 ? rFechar.rows[0].valor : null;
          
          verificarHorarioCardapio(hora_abrir, hora_fechar);
      } catch(e) { }
  }, 60000);
}


// ENDPOINT PARA VERCEL CRON JOBS
app.get('/api/cron/cardapio', async (req, res) => {
    if (typeof botUrlFinal !== 'undefined' && botUrlFinal) {
        const pingUrl = botUrlFinal.endsWith('/') ? `${botUrlFinal}health` : `${botUrlFinal}/health`;
        await fetch(pingUrl).catch((err) => console.log('⚠️ Erro ao acordar o robô no Render:', err.message));
    }
    try {
        await checkAndSendScheduledFCM();
        // --- FAXINA AUTOMÁTICA DIÁRIA (RODA APENAS 1 VEZ POR DIA) ---
        const hoje = new Date().toISOString().substring(0, 10);
        const rFaxina = await query("SELECT valor FROM sistema_config WHERE chave = 'ultima_faxina'");
        const ultimaFaxina = rFaxina.rows && rFaxina.rows.length > 0 ? rFaxina.rows[0].valor : null;
        if (ultimaFaxina !== hoje) {
            console.log('🧹 Registrando Faxina Diária Automática para hoje...', hoje);
            if (isPostgres) {
                await query("INSERT INTO sistema_config (chave, valor) VALUES ('ultima_faxina', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [hoje]);
            } else {
                await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('ultima_faxina', ?)", [hoje]);
            }

            // Executa as queries pesadas em segundo plano sem bloquear a requisição HTTP da Cron
            (async () => {
                try {
                    console.log('🧹 Executando limpeza da Faxina Diária...');
                    await query("UPDATE mesas SET status = 'livre', garcom_id = NULL WHERE garcom_id IS NOT NULL AND garcom_id != 'ADMIN' AND garcom_id != 'QRCODE' AND garcom_id != 'DELIVERY' AND garcom_id NOT IN (SELECT usuario FROM garcons WHERE usuario IS NOT NULL)");
                    await query("UPDATE pedidos SET status = 'cancelado' WHERE status NOT IN ('entregue', 'cancelado', 'servido', 'fechado', 'pago', 'concluido', 'aguardando_fechamento') AND garcom_id IS NOT NULL AND garcom_id != 'ADMIN' AND garcom_id != 'QRCODE' AND garcom_id != 'DELIVERY' AND garcom_id NOT IN (SELECT usuario FROM garcons WHERE usuario IS NOT NULL)");

                    const limite = new Date();
                    limite.setDate(limite.getDate() - 30);
                    const limiteStr = limite.toISOString().replace('T', ' ').substring(0, 19);
                    const statusTerminais = "'entregue', 'cancelado', 'servido', 'fechado', 'pago', 'concluido', 'concluído', 'aguardando_fechamento'";
                    
                    await query(`DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE status IN (${statusTerminais}) AND created_at < ?)`, [limiteStr]);
                    await query(`DELETE FROM pedidos WHERE status IN (${statusTerminais}) AND created_at < ?`, [limiteStr]);
                    console.log('✅ FAXINA AUTOMATICA CONCLUIDA:', hoje);
                } catch (err) {
                    console.error('❌ Erro na Faxina Diária Automática:', err.message);
                }
            })();
        }
        // --- FIM FAXINA ---

        const rAuto = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_auto'");
        if (!rAuto.rows || rAuto.rows.length === 0 || rAuto.rows[0].valor !== 'true') return res.status(200).json({ status: 'skip' });

        const rAbrir = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_hora_abrir'");
        const rFechar = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_hora_fechar'");
        
        const hora_abrir = rAbrir.rows && rAbrir.rows.length > 0 ? rAbrir.rows[0].valor : null;
        const hora_fechar = rFechar.rows && rFechar.rows.length > 0 ? rFechar.rows[0].valor : null;
        
        await verificarHorarioCardapio(hora_abrir, hora_fechar);
        res.status(200).json({ status: 'success' });
    } catch(e) { 
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/configs/delivery-status', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query("SELECT valor FROM sistema_config WHERE chave = 'delivery_aberto'");
    const status = result.rows && result.rows.length > 0 ? result.rows[0].valor === 'true' : true;
    res.json({ delivery_aberto: status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/configs/delivery-toggle', ensureDbInitialized, isAdmin, async (req, res) => {
  const { enabled } = req.body;
  try {
    const valor = enabled ? 'true' : 'false';
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('delivery_aberto', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('delivery_aberto', ?)", [valor]);
    }
    
    await safePusherTrigger('garconnexpress', 'delivery-status-atualizado', { delivery_aberto: enabled });
    res.json({ success: true, delivery_aberto: enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// INTEGRAÇÃO WHATSAPP (BOT EXTERNO)
const DEFAULT_BOT_URL = 'https://meu-zap-bot-rd8m.onrender.com/';
const botUrlFinal = process.env.WHATSAPP_BOT_URL || DEFAULT_BOT_URL;

let whatsappSocket = null;
let whatsappRealStatus = 'DESCONECTADO';
const clientesEmAtendimento = new Map(); // Armazena { numero: timestamp } - ESCOPO GLOBAL

if (botUrlFinal) {
  const botSecret = process.env.BOT_SECRET || process.env.JWT_SECRET || 'seusegredomuitolouco123';
  whatsappSocket = ioClient(botUrlFinal, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    auth: {
      token: botSecret
    },
    query: {
      token: botSecret
    }
  });

  whatsappSocket.on('status', (data) => {
    if (data && data.status) {
      whatsappRealStatus = data.status;
    }
  });

  // Se a conexão via websocket cair, marca como desconectado
  whatsappSocket.on('disconnect', () => {
    whatsappRealStatus = 'DESCONECTADO';
  });

  whatsappSocket.on('new_msg', async (data) => {
    try {
      if (!data || !data.from || !data.body || data.fromMe) return;
      
      const from = data.from.split('@')[0].replace(/\D/g, '');
      const msg = data.body.trim();

      // APENAS VINCULA O CLIENTE AO CACHE, SEM FORÇAR O MODO HUMANO
      // Deixamos o Robô enviar o menu automático primeiro.
      if (msg.includes('🛍️ *NOVO PEDIDO - DELIVERY*') || msg.includes('🛵 DELIVERY')) {
        clientesEmAtendimento.set(from, Date.now() + (4 * 60 * 60 * 1000));
        console.log(`📦 [Server] Pedido detectado para ${from}. Mantendo modo automático do Robô.`);
      }
    } catch (err) {
      console.error('⚠️ Erro ao sincronizar status do WhatsApp:', err.message);
    }
  });
}

// Cache simples para configurações
let configCache = {
  whatsapp_enabled: null,
  lastUpdate: 0
};

async function isWhatsAppEnabled() {
  const now = Date.now();
  if (configCache.whatsapp_enabled !== null && (now - configCache.lastUpdate < 60000)) {
    return configCache.whatsapp_enabled;
  }
  try {
    const config = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
    configCache.whatsapp_enabled = config.rows[0]?.valor === 'true';
    configCache.lastUpdate = now;
    return configCache.whatsapp_enabled;
  } catch (e) {
    return true; // Default
  }
}

// Aguarda a conexão do socket por até um determinado tempo (essencial para cold starts na Vercel)
async function ensureSocketConnected(timeoutMs = 2500) {
  if (!whatsappSocket) return false;
  if (whatsappSocket.connected) return true;

  return new Promise((resolve) => {
    const onConnect = () => {
      cleanup();
      resolve(true);
    };
    const onError = (err) => {
      console.warn('⚠️ [WhatsApp] Erro de conexão ao tentar conectar via socket:', err.message);
      cleanup();
      resolve(false);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    function cleanup() {
      whatsappSocket.off('connect', onConnect);
      whatsappSocket.off('connect_error', onError);
      clearTimeout(timer);
    }

    whatsappSocket.on('connect', onConnect);
    whatsappSocket.on('connect_error', onError);
    whatsappSocket.connect();
  });
}

async function sendWhatsAppMessage(text, targetNumber = null, pedidoId = 9999) {
  console.log(`🔎 [WhatsApp] Tentando disparar notificação: "${text.substring(0, 50)}..."`);
  try {
    if (!await isWhatsAppEnabled()) {
      console.log('🚫 [WhatsApp] Automação desativada nas configurações do sistema');
      return;
    }

    let numbersList = [];
    
    if (targetNumber) {
      numbersList = [targetNumber];
    } else {
      try {
        const configNums = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_notify_numbers'");
        if (configNums.rows && configNums.rows.length > 0 && configNums.rows[0].valor) {
          numbersList = configNums.rows[0].valor.split(',').map(n => n.trim()).filter(Boolean);
        }
      } catch (dbErr) {
        console.warn('⚠️ [WhatsApp] Não foi possível buscar número no banco:', dbErr.message);
      }

      // Fallback: variável de ambiente ou número hardcoded
      if (numbersList.length === 0) {
        const fallback = process.env.WHATSAPP_NOTIFY_NUMBER || '558293157048';
        numbersList = [fallback];
        console.log(`⚠️ [WhatsApp] Usando número fallback: ${fallback}`);
      }
    }

    // Espera até 2.5s para o socket se conectar (essencial em serverless/Vercel)
    const isConnected = await ensureSocketConnected(2500);

    if (isConnected && numbersList.length > 0) {
      // Remove duplicados e limpa os números
      const uniqueNumbers = [...new Set(numbersList.map(n => n.replace(/\D/g, '')))];
      console.log(`🤖 [WhatsApp] Bot CONECTADO via Socket. Enviando para: ${uniqueNumbers.join(', ')}`);

      uniqueNumbers.forEach(num => {
        // Renomeia o chat caso seja a primeira vez ou tenha perdido o nome
        whatsappSocket.emit('rename_chat', { jid: num + '@s.whatsapp.net', name: 'Notificações Meu zap 🔔' });
        // Fixa a conversa (PIN) no WhatsApp para sempre ficar no topo
        whatsappSocket.emit('pin_chat', { jid: num + '@s.whatsapp.net' });
        // Envia para o bot usando apenas os dígitos (formato que funcionou nos testes)
        whatsappSocket.emit('send_msg', { number: num, text: text });
      });

      // AWAIT CRÍTICO PARA VERCEL: Dá 1.5s para o socket enviar os pacotes antes da Vercel congelar a execução
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log(`✅ [WhatsApp] Pacotes enviados via socket. (Delay de 1.5s concluído)`);
      return true;
    } else {
      console.log('⚠️ [WhatsApp] FALHA NO ENVIO: Bot desconectado ou lista de números vazia.');
      console.log(`   - Socket conectado: ${whatsappSocket ? whatsappSocket.connected : 'null'}`);
      console.log(`   - Números encontrados: ${numbersList.length}`);
      return false;
    }
  } catch (e) {
    console.error('❌ Erro interno ao enviar WhatsApp:', e.message);
    return false;
  }
}

// Log global de todas as requisições
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
  next();
});

if (!process.env.JWT_SECRET) {
  console.warn('\n⚠️  [SEGURANÇA] JWT_SECRET não está definido como variável de ambiente!');
  console.warn('   Para produção, defina JWT_SECRET no Vercel/Render com um valor gerado por:');
  console.warn('   node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}
const JWT_SECRET = process.env.JWT_SECRET || 'seusegredomuitolouco123';
const saltRounds = 10;

const rateLimit = require('express-rate-limit');

// Limitador Global (Anti-DDoS)
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 3000,
  message: { error: 'Muitas requisições. Tente novamente mais tarde.' }
});
app.use('/api/', globalLimiter);

// Limitador de Login (Anti-Força Bruta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30,
  message: { error: 'Muitas tentativas de login incorretas. Conta bloqueada por 15 minutos.' }
});

// Limitador de Pedidos (Anti-Spam Delivery)
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 50, // Limite de 5 pedidos a cada 10 min
  skip: (req) => {
    // Pula o rate limit se for garçom, admin ou cliente validado (QR Code)
    const token = req.cookies.admin_token || req.cookies.garcom_token || req.cookies.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            return true; // Se tem token válido, permite
        } catch (e) {
            return false;
        }
    }
    return false;
  },
  message: { error: 'Limite de pedidos excedido. Tente novamente em breve.' }
});

// Limitador de Status (Anti-Race Condition para Cozinha/Garçom/Motoboy)
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // Limite de 60 alterações por minuto por IP
  message: { error: 'Calma! Muitas atualizações de status. Aguarde um instante.' }
});



// INICIALIZAÇÃO DO PUSHER (Com as novas chaves do usuário)
const pusherConfig = {
  appId: (process.env.PUSHER_APP_ID || "2122978").trim(),
  key: (process.env.PUSHER_APP_KEY || "5b2b284e309dea9d90fb").trim(),
  secret: (process.env.PUSHER_APP_SECRET || "11b8e639d6b1d940871a").trim(),
  cluster: (process.env.PUSHER_CLUSTER || "sa1").trim(),
  useTLS: true
};

let pusher = new Pusher(pusherConfig);
console.log('📡 PUSHER CONFIGURADO COM SUCESSO (LOCAL/VERCEL)');

const isPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let db;

if (isPostgres) {
    // Configuração OTIMIZADA para Vercel/Neon
    let connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    // Remove sslmode da string para evitar conflito/aviso e deixar o objeto ssl controlar
    if (connectionString) {
      try {
        const url = new URL(connectionString);
        url.searchParams.delete('sslmode');
        connectionString = url.toString();
      } catch (e) {
        // Se falhar o parse, usa como está
      }
    }
    
    db = new Pool({ 
      connectionString,
      ssl: { 
        rejectUnauthorized: false, // Aceita certificados self-signed do Neon
        require: true 
      },
      max: process.env.VERCEL ? 2 : 10, // Conexões limitadas em Serverless (Vercel) para evitar estourar o limite de conexões do Neon
      idleTimeoutMillis: process.env.VERCEL ? 8000 : 30000, // Tempo menor para liberar conexões inativas mais rápido no Vercel
      connectionTimeoutMillis: process.env.VERCEL ? 4000 : 15000, // Menor tempo no Vercel para dar tempo ao retry rápido
    });
    
    db.on('error', (err) => {
      console.error('⚠️ Erro no Pool do Postgres (recuperável):', err.message);
    });
  } else {
  if (!Database) {
    console.error("❌ ERRO CRÍTICO: SQLite não disponível e Postgres não configurado.");
    process.exit(1);
  }
  db = new Database(path.join(__dirname, 'garconnexpress.db'));
}



async function query(text, params) {
  const executeQuery = async () => {
    if (isPostgres) {
      let i = 1;
      const pgText = text.replace(/\?/g, () => `$${i++}`);
      const res = (params && params.length > 0) ? await db.query(pgText, params) : await db.query(pgText);
      return { 
        rows: res.rows || [], 
        changes: res.rowCount || 0, 
        lastInsertRowid: (res.rows && res.rows.length > 0) ? (res.rows[0].id || null) : null 
      };
    } else {
      const stmt = db.prepare(text);
      if (text.trim().toUpperCase().startsWith('SELECT') || text.trim().toUpperCase().includes('RETURNING')) {
        const rows = stmt.all(...(params || []));
        return { 
          rows: rows,
          lastInsertRowid: (rows && rows.length > 0) ? (rows[0].id || null) : null
        };
      } else {
        const info = stmt.run(...(params || []));
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
      }
    }
  };

  try {
    // Para Postgres, usa retry automático em caso de timeout
    if (isPostgres) {
      return await retryWithDelay(executeQuery, 3, 500);
    } else {
      return await executeQuery();
    }
  } catch (err) {
    console.error('DATABASE ERROR:', err.message);
    throw err;
  }
}

async function safePusherTrigger(channel, event, data) {
  if (!pusher) {
    console.log(`⚠️ Pusher não configurado. Ignorando evento: ${event}`);
    return;
  }
  try {
    console.log(`📡 [Pusher] Enviando: Canal=${channel}, Evento=${event}`);
    
    // Calcula previamente se é para a cozinha para injetar no websocket
    let enviaCozinha = false;
    if (event === 'novo-pedido' || event === 'pedido-cancelado') {
      const pId = data.pedido_id || data.id || (data.pedido ? data.pedido.id : null);
      if (pId) {
        if (event === 'novo-pedido') {
          if (data.para_cozinha !== undefined) {
            enviaCozinha = data.para_cozinha;
          } else {
            const itensIds = data.itens ? data.itens.map(i => i.menu_id) : [];
            enviaCozinha = await checkTemItemCozinha(itensIds);
          }
        } else if (event === 'pedido-cancelado') {
          try {
            const itensCancelados = (await query("SELECT menu_id FROM pedido_itens WHERE pedido_id = ?", [pId])).rows;
            const itensIds = itensCancelados.map(i => i.menu_id);
            enviaCozinha = await checkTemItemCozinha(itensIds);
          } catch (e) {
            enviaCozinha = true; // Fallback se der erro
          }
        }
      }
      data.para_cozinha = enviaCozinha; // INJETA NO WEBSOCKET
    }

    // No Vercel, precisamos de uma confirmação real do envio
    await pusher.trigger(channel, event, data);
    console.log(`✅ [Pusher] Sucesso: ${event}`);
    
    // --- WEB PUSH NATIVO (BACKGROUND) E FCM (NATIVO ANDROID/IOS) ---
    // Dispara notificação nativa para todos os garçons inscritos quando houver eventos cruciais
    const eventsToPush = ['novo-pedido', 'pedido-cancelado', 'chamado-garcom', 'pedido-pronto', 'rascunho-recebido', 'solicitacao-fechamento-cliente', 'status-atualizado', 'status-caixa-atualizado', 'estoque-baixo'];
    if (eventsToPush.includes(event)) {
      try {
        const subs = (await query("SELECT * FROM push_subscriptions")).rows;
        
        let enviaCozinha = data.para_cozinha;
        if (enviaCozinha === undefined) {
          const pId = data.pedido_id || data.id || (data.pedido ? (data.pedido.id || data.pedido.pedido_id) : '');
          if (pId) {
            try {
              const itensRes = await query("SELECT menu_id FROM pedido_itens WHERE pedido_id = ?", [pId]);
              if (itensRes.rows && itensRes.rows.length > 0) {
                const menuIds = itensRes.rows.map(i => i.menu_id);
                enviaCozinha = await checkTemItemCozinha(menuIds);
              }
            } catch (err) {
              console.error("Erro ao verificar itens da cozinha para push:", err);
            }
          }
        }
        if (enviaCozinha === undefined) enviaCozinha = true;
        const mesaRaw = data.mesa_numero || (data.pedido ? data.pedido.mesa_numero : 'BALCÃO');
        let mesaFormatada = mesaRaw;
        if (mesaRaw !== 'BALCÃO' && !String(mesaRaw).toUpperCase().includes('DELIVERY') && !String(mesaRaw).toUpperCase().includes('MESA')) {
            mesaFormatada = `Mesa ${mesaRaw}`;
        }
 
        const configData = (await query("SELECT chave, valor FROM sistema_config WHERE chave LIKE 'fcm_title_%' OR chave LIKE 'fcm_body_%' OR chave IN ('config_som_garcom', 'config_som_cozinha', 'config_som_motoboy')")).rows;
        const configMap = {};
        for (const r of configData) configMap[r.chave] = r.valor;
 
        const resolveTemplate = (evt, defaultT, defaultB) => {
          let t = configMap[`fcm_title_${evt}`] || defaultT;
          let b = configMap[`fcm_body_${evt}`] || defaultB;
          let s = configMap[`fcm_sound_${evt}`] !== 'false';
          const mapVars = (str) => {
            if (!str) return '';
            const itemsList = data.itens ? data.itens.map(i => `${i.qtd || 1}x ${i.nome || i.titulo || ''}`).join(', ') : '';
            return str
              .replace(/{mesa}/g, mesaFormatada)
              .replace(/{status}/g, data.status === 'fechado' ? '🔴 O caixa foi FECHADO. Atendimento encerrado.' : '🟢 O caixa foi ABERTO. Bom trabalho!')
              .replace(/{itens}/g, itemsList)
              .replace(/{item}/g, data.item || data.nome || '')
              .replace(/{qtd}/g, data.qtd || data.estoque || '1')
              .replace(/{pedido_id}/g, String(data.pedido_id || data.id || ''));
          };
          return { title: mapVars(t), body: mapVars(b), som: s };
        };
 
        // Determina se o evento é para o Motoboy (Delivery) ou Garçom
        const isDelivery = data.garcom_id === 'DELIVERY' || (data.pedido && data.pedido.garcom_id === 'DELIVERY');

        // Compila o título/mensagem padrão de acordo com o template
        let msgGarcom = { title: 'GarçomExpress', body: '' };
        let msgCozinha = { title: 'CozinhaExpress', body: '' };
        let msgMotoboy = { title: 'Delivery Express', body: '' };

        if (event === 'novo-pedido') {
          const evKey = data.is_addition ? 'item-adicionado' : 'novo-pedido';
          const defT = data.is_addition ? '➕ ITEM ADICIONADO' : '🚀 NOVO PEDIDO';
          const defB = data.is_addition ? '{mesa} pediu mais itens!' : '{mesa}';
          msgGarcom = resolveTemplate(evKey, defT, defB);
          msgCozinha = resolveTemplate(evKey, defT, defB);
          msgMotoboy = resolveTemplate(evKey, data.is_addition ? '➕ ITEM ADICIONADO' : '🚀 NOVO DELIVERY', data.is_addition ? '{mesa} pediu mais itens!' : 'Novo pedido #{pedido_id} recebido!');
        } else if (event === 'pedido-cancelado') {
          msgGarcom = resolveTemplate('pedido-cancelado', '❌ PEDIDO CANCELADO', '{mesa}');
          msgCozinha = resolveTemplate('pedido-cancelado', '❌ PEDIDO CANCELADO', '{mesa}');
          msgMotoboy = resolveTemplate('pedido-cancelado', '❌ PEDIDO CANCELADO', 'O pedido #{pedido_id} foi cancelado.');
        } else if (event === 'chamado-garcom') {
          msgGarcom = resolveTemplate('chamado-garcom', '🛎️ CHAMADO', '{mesa} está chamando!');
        } else if (event === 'pedido-pronto') {
          msgGarcom = resolveTemplate('pedido-pronto', '🍳 PRONTO', '{mesa}');
        } else if (event === 'solicitacao-fechamento-cliente') {
          msgGarcom = resolveTemplate('solicitacao-fechamento-cliente', '💰 FECHAMENTO', '{mesa} solicitou a conta');
        } else if (event === 'rascunho-recebido') {
          msgGarcom = resolveTemplate('rascunho-recebido', '📝 RASCUNHO', '{mesa}');
        } else if (event === 'status-caixa-atualizado') {
          const statusText = data.status === 'fechado' ? 'fechado' : 'aberto';
          const defT = '💰 CAIXA';
          const defB = data.status === 'fechado' ? '🔴 O caixa foi FECHADO. Atendimento encerrado.' : '🟢 O caixa foi ABERTO. Bom trabalho!';
          msgGarcom = resolveTemplate('status-caixa-atualizado', defT, defB);
          msgCozinha = resolveTemplate('status-caixa-atualizado', defT, defB);
          msgMotoboy = resolveTemplate('status-caixa-atualizado', defT, defB);
        } else if (event === 'estoque-baixo') {
          const defT = '⚠️ ESTOQUE BAIXO';
          const defB = 'Alerta de estoque baixo para {item}: restam apenas {qtd} un.!';
          msgGarcom = resolveTemplate('estoque-baixo', defT, defB);
          msgCozinha = resolveTemplate('estoque-baixo', defT, defB);
          msgMotoboy = resolveTemplate('estoque-baixo', defT, defB);
        } else if (event === 'status-atualizado') {
          if (data.status === 'cancelado') {
            return true; // Deixa que o evento 'pedido-cancelado' envie a notificação, evita duplicidade.
          } else if (data.status === 'entregue') {
            if (isDelivery) {
              msgMotoboy = resolveTemplate('pedido-entregue', '✅ PEDIDO ENTREGUE', `✅ PEDIDO ENTREGUE E FINALIZADO: ${mesaFormatada}`);
            } else {
              return true; // Ignora para mesas de salão (evita duplicidade de "Entregue")
            }
          } else if (data.status === 'servido') {
            if (isDelivery) {
              msgMotoboy = resolveTemplate('saiu-entrega', '🛵 SAIU PARA ENTREGA', `🛵 SAIU PARA ENTREGA: ${mesaFormatada}`);
            } else {
              // Para salão: pedido servido/entregue na mesa!
              msgGarcom = resolveTemplate('pedido-servido', '✅ PEDIDO ENTREGUE', `✅ PEDIDO DA ${mesaFormatada} ENTREGUE`);
            }
          } else if (data.status === 'saiu_entrega') {
            msgMotoboy = resolveTemplate('saiu-entrega', '🛵 SAIU PARA ENTREGA', `🛵 SAIU PARA ENTREGA: ${mesaFormatada}`);
          } else if (data.status === 'liberada') {
            msgGarcom = resolveTemplate('mesa-liberada', '🔓 MESA LIBERADA', `🔓 MESA LIBERADA: ${mesaFormatada}`);
          } else {
            return true; // Ignora outros status
          }
        }
 
        // Mapeia os alvos que devem receber a notificação
        const targets = [];
 
        // Fechamento/abertura de caixa vai para TODOS os apps simultaneamente
        if (event === 'status-caixa-atualizado') {
          targets.push({ app: 'garcom',  title: msgGarcom.title, msg: msgGarcom.body });
          targets.push({ app: 'cozinha', title: msgCozinha.title, msg: msgCozinha.body });
          targets.push({ app: 'motoboy', title: msgMotoboy.title, msg: msgMotoboy.body });
        } else if (event === 'estoque-baixo') {
          targets.push({ app: 'garcom',  title: msgGarcom.title, msg: msgGarcom.body });
        } else if (isDelivery) {
          if (event === 'pedido-cancelado' && enviaCozinha) {
             // Se for cancelamento de delivery E tem item de cozinha, NÃO envia push pro motoboy.
             // A notificação de cancelamento vai apenas para a cozinha (configurado abaixo).
          } else {
            let bodyMotoboy = msgMotoboy.body;
            if (!bodyMotoboy) {
              if (event === 'novo-pedido') {
                bodyMotoboy = data.is_addition ? `➕ ITEM ADICIONADO: ${mesaFormatada}` : `🚀 NOVO PEDIDO: ${mesaFormatada}`;
              } else if (event === 'pedido-cancelado') {
                bodyMotoboy = `❌ PEDIDO CANCELADO: ${mesaFormatada}`;
              } else {
                bodyMotoboy = `${mesaFormatada}`;
              }
            }
            targets.push({ app: 'motoboy', title: msgMotoboy.title || 'Delivery Express', msg: bodyMotoboy });
          }
        } else {
          // Se for pedido do Balcão (garcom_id === 'ADMIN'), NÃO envia push para o garçom!
          const isBalcao = data.garcom_id === 'ADMIN' || (data.pedido && data.pedido.garcom_id === 'ADMIN');
          if (!isBalcao && msgGarcom.body) {
            targets.push({ app: 'garcom', title: msgGarcom.title, msg: msgGarcom.body });
          }
        }

        // Adiciona a cozinha como alvo se houver itens para cozinha ou se o pedido foi cancelado
        if (event === 'novo-pedido' || event === 'pedido-cancelado') {
          if (enviaCozinha && msgCozinha.body) {
            targets.push({ app: 'cozinha', title: msgCozinha.title, msg: msgCozinha.body });
          }
        }

        const pId = String(data.pedido_id || data.id || (data.pedido ? (data.pedido.id || data.pedido.pedido_id) : '') || '');
        const statusVal = String(data.status || '');

        // 1. Identifica o garçom de destino associado ao evento (pode ser o ID ou o Username)
        let garcomIdentificado = data.garcom_id || (data.pedido && data.pedido.garcom_id) || null;
        
        // 2. Se não veio direto no evento, mas temos o mesa_id, buscamos no banco qual garçom está associado à mesa
        if (!garcomIdentificado) {
          const mesaId = data.mesa_id || (data.pedido && data.pedido.mesa_id) || null;
          if (mesaId) {
            try {
              const mesaRes = await query("SELECT garcom_id FROM mesas WHERE id = ?", [mesaId]);
              if (mesaRes.rows && mesaRes.rows[0] && mesaRes.rows[0].garcom_id) {
                garcomIdentificado = mesaRes.rows[0].garcom_id;
              }
            } catch (err) {
              console.error("Erro ao buscar garçom responsável pela mesa para push:", err.message);
            }
          }
        }

        // 3. Resolve o Garçom para obter tanto o ID quanto o USUÁRIO para comparação correta (Int vs String)
        let garcomDestinoId = null;
        let garcomDestinoUsuario = null;
        if (garcomIdentificado) {
          try {
            const garcomRes = await query("SELECT id, usuario FROM garcons WHERE id = ? OR usuario = ?", [
              isNaN(Number(garcomIdentificado)) ? -1 : Number(garcomIdentificado),
              String(garcomIdentificado)
            ]);
            if (garcomRes.rows && garcomRes.rows[0]) {
              garcomDestinoId = String(garcomRes.rows[0].id).trim();
              garcomDestinoUsuario = String(garcomRes.rows[0].usuario).trim().toLowerCase();
            } else {
              garcomDestinoUsuario = String(garcomIdentificado).trim().toLowerCase();
            }
          } catch (err) {
            console.error("Erro ao resolver garcom no banco:", err.message);
            garcomDestinoUsuario = String(garcomIdentificado).trim().toLowerCase();
          }
        }

        const pushPromises = [];
        for (const target of targets) {
          const targetApp = target.app;
          const pushTitle = target.title;
          const currentPushMsg = target.msg;

          const sentEndpoints = new Set();
          for (const sub of subs) {
            // FILTRO 1: Só envia se o app_type da inscrição coincidir com o alvo do evento
            if (sub.app_type !== targetApp) continue;

            // FILTRO 2: Direciona notificações de garçom somente para o garçom responsável da mesa/pedido
            if (targetApp === 'garcom' && garcomIdentificado) {
              const subGarcomIdStr = String(sub.garcom_id).trim();
              const matchesId = garcomDestinoId && subGarcomIdStr === garcomDestinoId;
              const matchesUser = garcomDestinoUsuario && subGarcomIdStr.toLowerCase() === garcomDestinoUsuario;
              
              if (!matchesId && !matchesUser) {
                console.log(`⏭️ Pulando FCM para garçom ${sub.garcom_id} (responsável é ID:${garcomDestinoId}/User:${garcomDestinoUsuario})`);
                continue;
              }
            }

            // Evita envio duplicado para o mesmo token/endpoint na mesma execução
            if (sentEndpoints.has(sub.endpoint)) {
              console.log(`⚠️ Ignorando token duplicado no loop de envio: ${sub.endpoint}`);
              continue;
            }
            sentEndpoints.add(sub.endpoint);

            // Roteamento híbrido: is_native=1 OU token que não é URL https:// (FCM nativo)
            const isNativeSub = sub.is_native === 1 || sub.is_native === true ||
              (!sub.endpoint.startsWith('https://') && !sub.endpoint.includes('fcm.googleapis.com'));
            if (!isNativeSub) {
               // Web Push (navegador / PWA)
               const payload = JSON.stringify({ title: pushTitle, body: currentPushMsg, event });
               const pushSubscription = {
                 endpoint: sub.endpoint,
                 keys: {
                   p256dh: sub.p256dh || '',
                   auth: sub.auth || ''
                 }
               };
               pushPromises.push(
                 webpush.sendNotification(pushSubscription, payload).catch(e => { if (e.statusCode === 410 || e.statusCode === 404 || e.message.includes('unexpected response code') || e.message.includes('unsubscribed')) { console.log('Removendo endpoint inativo (WebPush)'); query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]).catch(err => console.error(err.message)); } })
               );
            } else {
               // Tratamento para Token Nativo (Capacitor/Firebase SDK)
               if (admin.apps.length > 0) {
                 let activeSound = 'notificacao';
                  let channelName = 'pedidos';
                  if (targetApp === 'garcom') {
                    activeSound = configMap['config_som_garcom'] || 'campainha_classica';
                    channelName = 'garcom_canal_' + activeSound + '_v2';
                  } else if (targetApp === 'cozinha') {
                    activeSound = configMap['config_som_cozinha'] || 'sino_moderno';
                    channelName = 'cozinha_canal_' + activeSound + '_v2';
                  } else if (targetApp === 'motoboy') {
                    activeSound = configMap['config_som_motoboy'] || 'campainha_classica';
                    channelName = 'motoboy_canal_' + activeSound + '_v2';
                  }


                  let fcmSoundFile = activeSound;
                  if (fcmSoundFile === 'original') fcmSoundFile = 'notificacao';

                  let androidNotification = { 
                    channelId: channelName, 
                    defaultSound: activeSound === 'original',
                    notificationPriority: 'PRIORITY_MAX'
                  };
                  if (activeSound !== 'mudo') {
                    androidNotification.sound = fcmSoundFile;
                  }
                  
                  const message = {
                    notification: {
                      title: pushTitle,
                      body: currentPushMsg
                    },
                    data: {
                       event: event,
                       sound: activeSound !== 'mudo' ? fcmSoundFile : '',
                       pedido_id: pId,
                       status: statusVal
                     },
                    android: {
                       priority: 'high',
                       notification: androidNotification
                     },
                    apns: {
                      payload: {
                        aps: {
                          sound: activeSound !== 'mudo' ? (activeSound === 'original' ? 'notificacao.caf' : activeSound + '.caf') : '',
                          badge: 1
                        }
                      }
                    },
                    token: sub.endpoint
                  };
                 
                  // Seleciona a instância correta do Firebase Admin
                  let firebaseAppToUse = null;
                  if (targetApp === 'motoboy') {
                    if (admin.apps.find(a => a.name === 'motoboy')) {
                      firebaseAppToUse = admin.app('motoboy');
                    } else {
                      console.warn('⚠️ Firebase Admin (Motoboy) não está inicializado. Ignorando envio para evitar remoção de token.');
                    }
                  } else if (targetApp === 'cozinha') {
                    if (admin.apps.find(a => a.name === 'cozinha')) {
                      firebaseAppToUse = admin.app('cozinha');
                    } else {
                      console.warn('⚠️ Firebase Admin (Cozinha) não está inicializado. Ignorando envio para evitar remoção de token.');
                    }
                  } else {
                    if (admin.apps.length > 0) {
                      firebaseAppToUse = admin;
                    } else {
                      console.warn('⚠️ Firebase Admin (Garçom/Padrão) não está inicializado.');
                    }
                  }

                  if (firebaseAppToUse) {
                    pushPromises.push(
                      firebaseAppToUse.messaging().send(message)
                        .then((response) => {
                          console.log(`✅ FCM Nativo (${targetApp}) enviado:`, response);
                        })
                        .catch(async (error) => {
                          console.error(`❌ Erro enviando FCM Nativo (${targetApp}):`, error);
                          // Remove tokens inválidos
                          if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
                             console.log('🗑️ Removendo token FCM inativo:', sub.endpoint);
                             await query("DELETE FROM push_subscriptions WHERE id = ?", [sub.id]);
                          }
                        })
                    );
                  }
               }
            }
          }
        }
        await Promise.all(pushPromises);
      } catch (err) {
        console.error('Erro ao buscar subscriptions:', err.message);
      }
    }
    
    return true;
  } catch (e) {
    console.error(`❌ [Pusher] Falha (${event}):`, e.message);
    return false;
  }
}

// --- ROTAS WEB PUSH ---
app.get('/api/vapid-publicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', isAuthenticated, async (req, res) => {
  const subscription = req.body;
  const garcomId = req.user.id || req.user.usuario; // Depende de como está no token
  const appType = req.body.app_type || 'garcom';
  try {
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Endpoint/token é obrigatório.' });
    }
    // Garante unicidade absoluta: remove qualquer registro anterior com o mesmo token (endpoint)
    await query("DELETE FROM push_subscriptions WHERE endpoint = ?", [subscription.endpoint]);
    
    // Evita duplicidade do mesmo garçom para o mesmo tipo de app
    await query("DELETE FROM push_subscriptions WHERE garcom_id = ? AND app_type = ?", [garcomId, appType]);

    // Insere o novo registro atualizado
    const p256dh = subscription.keys?.p256dh || '';
    const auth = subscription.keys?.auth || '';
    const isNative = subscription.isNative ? 1 : 0; // Salva se é token FCM nativo ou Web Push
    await query("INSERT INTO push_subscriptions (garcom_id, endpoint, p256dh, auth, app_type, is_native) VALUES (?, ?, ?, ?, ?, ?)", 
      [garcomId, subscription.endpoint, p256dh, auth, appType, isNative]);

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar inscrição push:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint específico para o app Motoboy
app.post('/api/subscribe-motoboy', isAuthenticated, async (req, res) => {
  const { endpoint } = req.body;
  const garcomId = req.user.id || req.user.usuario;
  try {
    if (!endpoint) return res.status(400).json({ error: 'Endpoint/token é obrigatório.' });

    // Garante unicidade absoluta: remove qualquer registro anterior com o mesmo token (endpoint)
    await query("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
// Evita duplicidade do mesmo motoboy na base
    await query("DELETE FROM push_subscriptions WHERE garcom_id = ? AND app_type = 'motoboy'", [garcomId]);
    
    // Insere o novo registro atualizado
    await query("INSERT INTO push_subscriptions (garcom_id, endpoint, app_type) VALUES (?, ?, 'motoboy')", [garcomId, endpoint]);

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar inscrição motoboy:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint específico para o app Cozinha
app.post('/api/subscribe-cozinha', isAuthenticated, async (req, res) => {
  const { endpoint } = req.body;
  const garcomId = req.user.id || req.user.usuario;
  try {
    if (!endpoint) return res.status(400).json({ error: 'Endpoint/token é obrigatório.' });
    await query("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
    await query("DELETE FROM push_subscriptions WHERE garcom_id = ? AND app_type = 'cozinha'", [garcomId]);
    await query("INSERT INTO push_subscriptions (garcom_id, endpoint, app_type) VALUES (?, ?, 'cozinha')", [garcomId, endpoint]);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar inscrição cozinha:", error);
    res.status(500).json({ error: error.message });
  }
});


let lastDelayedCheck = 0;

async function checkAndNotifyDelayedOrders() {
  const nowTime = Date.now();
  if (nowTime - lastDelayedCheck < 30000) return; // Checa no máximo 1 vez a cada 30 segundos
  lastDelayedCheck = nowTime;
  
  try {
    // 1. Busca pedidos ativos não notificados ainda
    const activeOrdersRes = await query(`
      SELECT p.id, p.garcom_id, CAST(p.created_at AS TEXT) as created_str, m.numero as mesa_numero
      FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho', 'servido', 'aguardando_fechamento')
        AND (p.notificado_atraso = 0 OR p.notificado_atraso IS NULL)
    `);

    const now = new Date();
    const delayedOrders = activeOrdersRes.rows.filter(p => {
      let dateStr = p.created_str || '';
      if (!dateStr.endsWith('Z')) dateStr = dateStr.replace(' ', 'T') + 'Z';
      const createdAt = new Date(dateStr);
      const diffMinutes = (now - createdAt) / 60000;
      return diffMinutes >= 10;
    });

    const configData = (await query("SELECT chave, valor FROM sistema_config WHERE chave LIKE 'fcm_title_%' OR chave LIKE 'fcm_body_%' OR chave IN ('config_som_garcom', 'config_som_cozinha', 'config_som_motoboy')")).rows;
    const configMap = {};
    for (const r of configData) configMap[r.chave] = r.valor;

    const resolveAtrasoTemplate = (evt, defaultT, defaultB, mesaFormatada, pId) => {
      let t = configMap[`fcm_title_${evt}`] || defaultT;
      let b = configMap[`fcm_body_${evt}`] || defaultB;
      const mapVars = (str) => {
        if (!str) return '';
        return str
          .replace(/{mesa}/g, mesaFormatada)
          .replace(/{pedido_id}/g, String(pId));
      };
      return { title: mapVars(t), body: mapVars(b) };
    };

    // 2. Busca inscrições push de dispositivos
    const subsRes = await query("SELECT * FROM push_subscriptions");
    const subs = subsRes.rows;

    // === NOVAS NOTIFICACOES: FECHAMENTO ATRASADO ===
    const delayedClosureRes = await query("SELECT p.id, p.garcom_id, g.id as garcom_pk, CAST(p.fechamento_solicitado_em AS TEXT) as fechamento_str, m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON (p.garcom_id = g.usuario OR p.garcom_id = CAST(g.id AS TEXT)) WHERE (p.status = 'aguardando_fechamento' OR p.solicitou_fechamento = TRUE OR p.solicitou_fechamento = 'true') AND p.fechamento_solicitado_em IS NOT NULL AND (p.notificado_atraso_fechamento = 0 OR p.notificado_atraso_fechamento IS NULL)");
    const delayedClosures = delayedClosureRes.rows.filter(p => {
      // Força a string a ser tratada como UTC adicionando o Z, assim previne o driver pg de usar o fuso local da máquina na Vercel
      let dateStr = p.fechamento_str || '';
      if (!dateStr.endsWith('Z')) dateStr = dateStr.replace(' ', 'T') + 'Z';
      const requestedAt = new Date(dateStr);
      return ((now - requestedAt) / 60000) >= 5;
    });

    for (const p of delayedClosures) {
      const mesaName = p.mesa_numero ? (String(p.mesa_numero).toUpperCase().includes('MESA') ? p.mesa_numero : 'Mesa ' + p.mesa_numero) : 'BALCAO';
      const updateRes = await query("UPDATE pedidos SET notificado_atraso_fechamento = 1 WHERE id = ? AND (notificado_atraso_fechamento = 0 OR notificado_atraso_fechamento IS NULL)", [p.id]);
      if (updateRes.changes === 0) continue;

      // Dispara o WhatsApp diretamente do servidor
      const wppText = `⚠️ ATRASO: ${mesaName.toUpperCase()} #${p.id}\n\nSOLICITOU CONTA há mais de 5 minutos!`;
      const wppSent = await sendWhatsAppMessage(wppText, null, p.id).catch(err => {
        console.error("Erro ao enviar WhatsApp de atraso de fechamento do servidor:", err.message);
        return false;
      });

      if (!wppSent) {
        console.warn(`🔄 Revertendo flag notificado_atraso_fechamento para o pedido #${p.id} devido a falha no WhatsApp.`);
        await query("UPDATE pedidos SET notificado_atraso_fechamento = 0 WHERE id = ?", [p.id]);
      }

      const pushObj = resolveAtrasoTemplate(
        'fechamento-atrasado',
        '⚠️ CAIXA: FECHAMENTO ATRASADO!',
        'O fechamento da {mesa} foi solicitado há mais de 5 minutos e ainda não foi concluído!',
        mesaName,
        p.id
      );
      const pushTitle = pushObj.title;
      const pushMsg = pushObj.body;
      
      // Toast pusher para o admin
      if (typeof safePusherTrigger !== 'undefined') {
          await safePusherTrigger('garconnexpress', 'fechamento-atrasado', { pedido_id: p.id, mesa_numero: p.mesa_numero, mensagem: pushMsg });
      }

      // Notificacoes FCM/WebPush para Admin
      const sentEndpoints = new Set();
      const pushPromises = [];
      for (const sub of subs) {
        if (sub.app_type !== 'garcom' || (sub.garcom_id !== p.garcom_id && sub.garcom_id !== String(p.garcom_pk))) continue;
        if (sentEndpoints.has(sub.endpoint)) continue;
        sentEndpoints.add(sub.endpoint);
        const isNativeSubAtraso = sub.is_native === 1 || sub.is_native === true || (!sub.endpoint.startsWith('https://') && !sub.endpoint.includes('fcm.googleapis.com'));
        if (!isNativeSubAtraso) {
          const payload = JSON.stringify({ title: pushTitle, body: pushMsg, event: 'fechamento-atrasado' });
          const pushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh || '', auth: sub.auth || '' } };
          pushPromises.push(
            webpush.sendNotification(pushSubscription, payload).catch(e => {
              if (e.statusCode === 410 || e.statusCode === 404 || e.message.includes('unsubscribed')) {
                  query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]).catch(err => console.error(err.message));
              }
            })
          );
        } else {
          if (admin.apps.length > 0) {
            const activeSound = configMap['config_som_garcom'] || 'campainha_classica';
            const channelName = 'garcom_canal_' + activeSound + '_v2';
            let fcmSoundFile = activeSound;
            if (fcmSoundFile === 'original') fcmSoundFile = 'notificacao';

            const androidNotification = {
              channelId: channelName,
              defaultSound: activeSound === 'original',
              notificationPriority: 'PRIORITY_MAX'
            };
            if (activeSound !== 'original' && activeSound !== 'mudo') {
              androidNotification.sound = fcmSoundFile;
            }

            const message = {
              notification: { title: pushTitle, body: pushMsg },
              data: { event: 'fechamento-atrasado', sound: fcmSoundFile, pedido_id: String(p.id) },
              android: { priority: 'high', notification: androidNotification },
              token: sub.endpoint
            };
            pushPromises.push(
              admin.messaging().send(message).catch(e => {
                console.error('Erro FCM Fechamento Atrasado:', e.message);
                if (e.code === 'messaging/invalid-registration-token' || e.code === 'messaging/registration-token-not-registered') {
                   query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]).catch(err => console.error(err.message));
                }
              })
            );
          }
        }
      }
      await Promise.all(pushPromises);
    }

    if (delayedOrders.length === 0) return;

    for (const p of delayedOrders) {
      const isDelivery = p.garcom_id === 'DELIVERY';
      const mesaName = p.mesa_numero ? (String(p.mesa_numero).toUpperCase().includes('MESA') ? p.mesa_numero : `Mesa ${p.mesa_numero}`) : 'BALCÃO';
      
      const targets = [];
      
      if (isDelivery) {
        const pushObj = resolveAtrasoTemplate(
          'pedido-atrasado-motoboy',
          '🔥 MOTOBOY: ENTREGA ATRASADA!',
          'O pedido de entrega #{pedido_id} está parado há mais de 10 minutos!',
          mesaName,
          p.id
        );
        targets.push({ app: 'motoboy', title: pushObj.title, msg: pushObj.body });
      } else {
        if (p.garcom_id !== 'ADMIN') {
          const pushObj = resolveAtrasoTemplate(
            'pedido-atrasado-garcom',
            '🔥 GARÇOM: PEDIDO ATRASADO!',
            'O pedido da {mesa} (#{pedido_id}) está parado há mais de 10 minutos!',
            mesaName,
            p.id
          );
          targets.push({ app: 'garcom', title: pushObj.title, msg: pushObj.body });
        }
      }
      
      // Verifica se o pedido atrasado tem itens para a cozinha
      let enviaCozinha = false;
      try {
        const itens = (await query("SELECT menu_id FROM pedido_itens WHERE pedido_id = ?", [p.id])).rows;
        if (itens && itens.length > 0) {
          const itensIds = itens.map(i => i.menu_id);
          enviaCozinha = await checkTemItemCozinha(itensIds);
        }
      } catch (e) {
        console.error("Erro ao checar itens da cozinha no atraso:", e);
      }

      if (enviaCozinha) {
        const pushObj = resolveAtrasoTemplate(
          'pedido-atrasado-cozinha',
          '🔥 COZINHA: PEDIDO ATRASADO!',
          'O pedido #{pedido_id} ({mesa}) está aguardando há mais de 10 minutos!',
          mesaName,
          p.id
        );
        targets.push({ app: 'cozinha', title: pushObj.title, msg: pushObj.body });
      }

      // Atualiza de forma atômica para evitar envios duplicados por concorrência
      const updateRes = await query("UPDATE pedidos SET notificado_atraso = 1 WHERE id = ? AND (notificado_atraso = 0 OR notificado_atraso IS NULL)", [p.id]);
      if (updateRes.changes === 0) continue; // Já foi notificado por outro processo/requisição

      // Dispara o WhatsApp diretamente do servidor
      let dateStr = p.created_str || '';
      if (!dateStr.endsWith('Z')) dateStr = dateStr.replace(' ', 'T') + 'Z';
      const createdAt = new Date(dateStr);
      const diffMinutes = Math.round((now - createdAt) / 60000);
      const wppText = `⚠️ ATRASO: ${mesaName.toUpperCase()} #${p.id}\n\nPEDIDO PENDENTE há ${diffMinutes} minutos!`;
      
      const wppSent = await sendWhatsAppMessage(wppText, null, p.id).catch(err => {
        console.error("Erro ao enviar WhatsApp de atraso do servidor:", err.message);
        return false;
      });

      if (!wppSent) {
        console.warn(`🔄 Revertendo flag notificado_atraso para o pedido #${p.id} devido a falha no WhatsApp.`);
        await query("UPDATE pedidos SET notificado_atraso = 0 WHERE id = ?", [p.id]);
      }

      // Envia notificações para todos os dispositivos correspondentes
      for (const target of targets) {
        const targetApp = target.app;
        const pushTitle = target.title;
        const pushMsg = target.msg;
        
        if (typeof safePusherTrigger !== 'undefined') {
          await safePusherTrigger('garconnexpress', `pedido-atrasado-${targetApp}`, {
            pedido_id: p.id,
            mesa_numero: p.mesa_numero,
            mensagem: pushMsg
          });
        }
        
        const sentEndpoints = new Set();
        for (const sub of subs) {
          if (sub.app_type !== targetApp) continue;
          if (sentEndpoints.has(sub.endpoint)) continue;
          sentEndpoints.add(sub.endpoint);

          const isNativeSubAtraso = sub.is_native === 1 || sub.is_native === true ||
            (!sub.endpoint.startsWith('https://') && !sub.endpoint.includes('fcm.googleapis.com'));
          if (!isNativeSubAtraso) {
            // Web Push (navegador / PWA)
            const payload = JSON.stringify({ title: pushTitle, body: pushMsg, event: 'pedido-atrasado' });
            const pushSubscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh || '', auth: sub.auth || '' }
            };
            await webpush.sendNotification(pushSubscription, payload).catch(e => { if (e.statusCode === 410 || e.statusCode === 404 || e.message.includes('unexpected response code') || e.message.includes('unsubscribed')) { console.log('Removendo endpoint inativo (Atraso)'); query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]).catch(err => console.error(err.message)); } });
          } else {
            if (admin.apps.length > 0) {
              let activeSound = 'notificacao';
              let channelName = 'pedidos';
              if (targetApp === 'garcom') {
                activeSound = configMap['config_som_garcom'] || 'campainha_classica';
                channelName = 'garcom_canal_' + activeSound + '_v2';
              } else if (targetApp === 'cozinha') {
                activeSound = configMap['config_som_cozinha'] || 'sino_moderno';
                channelName = 'cozinha_canal_' + activeSound + '_v2';
              } else if (targetApp === 'motoboy') {
                activeSound = configMap['config_som_motoboy'] || 'campainha_classica';
                channelName = 'motoboy_canal_' + activeSound + '_v2';
              }

              let fcmSoundFile = activeSound;
              if (fcmSoundFile === 'original') fcmSoundFile = 'notificacao';

              const androidNotification = {
                channelId: channelName,
                defaultSound: activeSound === 'original',
                notificationPriority: 'PRIORITY_MAX'
              };
              if (activeSound !== 'original' && activeSound !== 'mudo') {
                androidNotification.sound = fcmSoundFile;
              }

              const message = {
                notification: { title: pushTitle, body: pushMsg },
                data: {
                  event: 'pedido-atrasado',
                  sound: fcmSoundFile,
                  pedido_id: String(p.id),
                  status: 'atrasado'
                },
                android: {
                  priority: 'high',
                  notification: androidNotification
                },
                token: sub.endpoint
              };
              let firebaseAppToUse = admin;
              if (targetApp === 'motoboy' && admin.apps.find(a => a.name === 'motoboy')) {
                firebaseAppToUse = admin.app('motoboy');
              } else if (targetApp === 'cozinha' && admin.apps.find(a => a.name === 'cozinha')) {
                firebaseAppToUse = admin.app('cozinha');
              }
              
              await firebaseAppToUse.messaging().send(message).catch(e => console.error('Erro FCM Atraso:', e.message));
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro ao verificar pedidos atrasados internamente:', error);
  }
}

async function checkAndSendScheduledFCM() {
  const nowMs = Date.now();
  let lockAcquired;
  try {
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0') ON CONFLICT DO NOTHING");
      lockAcquired = await query(
        "UPDATE sistema_config SET valor = ? WHERE chave = 'fcm_agenda_lock' AND (? - CAST(valor AS BIGINT) > 45000 OR valor = '0')",
        [String(nowMs), nowMs]
      );
    } else {
      await query("INSERT OR IGNORE INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0')");
      lockAcquired = await query(
        "UPDATE sistema_config SET valor = ? WHERE chave = 'fcm_agenda_lock' AND (? - CAST(valor AS INTEGER) > 45000 OR valor = '0')",
        [String(nowMs), nowMs]
      );
    }
    
    if (lockAcquired.changes === 0) {
      return; // Concorrência detectada: outra thread/processo já está processando os agendamentos.
    }
  } catch (err) {
    console.error('Erro ao verificar lock do agendador FCM:', err.message);
    return;
  }

  try {
    const configRes = await query("SELECT chave, valor FROM sistema_config");
    const configMap = {};
    configRes.rows.forEach(row => {
      configMap[row.chave] = row.valor;
    });

    const r = (await query("SELECT valor FROM sistema_config WHERE chave = 'fcm_custom_events'")).rows;
    if (!r || r.length === 0 || !r[0].valor) {
      // Libera o lock se não tiver nada para fazer
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0') ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor");
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0')");
      }
      return;
    }
    
    let lista = JSON.parse(r[0].valor);
    if (!Array.isArray(lista) || lista.length === 0) {
      // Libera o lock
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0') ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor");
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0')");
      }
      return;
    }
    
    const now = new Date();
    let mudou = false;
    
    for (const ev of lista) {
      // Se for recorrente, checa se já disparou hoje (para evitar loops caso o agendador rode mais de uma vez no mesmo minuto/dia)
      let jaDisparadoHoje = false;
      if (ev.recorrente && ev.ultimoDisparo) {
        const dUltimo = new Date(ev.ultimoDisparo);
        jaDisparadoHoje = dUltimo.toDateString() === now.toDateString();
      }

      if (ev.ativo && ev.agendadoPara && (!ev.enviado || (ev.recorrente && !jaDisparadoHoje))) {
        const dataAgenda = new Date(ev.agendadoPara);
        if (dataAgenda <= now) {
          console.log(`⏰ [Agendador FCM] Disparando evento agendado (Recorrente: ${!!ev.recorrente}): ${ev.nome}`);
          
          const targets = ev.destinatario === 'todos' ? ['garcom', 'cozinha', 'motoboy'] : [ev.destinatario];
          let totalEnviados = 0;
          
          const promises = [];
          for (const dest of targets) {
            const subs = (await query("SELECT * FROM push_subscriptions WHERE app_type = ?", [dest])).rows;
            for (const sub of subs) {
              const isNativeSub = sub.is_native === 1 || sub.is_native === true || (!sub.endpoint.startsWith('https://') && !sub.endpoint.includes('fcm.googleapis.com'));
              if (isNativeSub && admin.apps.length > 0) {
                let activeSound = 'notificacao';
                let channelName = 'pedidos';
                if (dest === 'garcom') {
                  activeSound = configMap['config_som_garcom'] || 'campainha_classica';
                  channelName = 'garcom_canal_' + activeSound + '_v2';
                } else if (dest === 'cozinha') {
                  activeSound = configMap['config_som_cozinha'] || 'sino_moderno';
                  channelName = 'cozinha_canal_' + activeSound + '_v2';
                } else if (dest === 'motoboy') {
                  activeSound = configMap['config_som_motoboy'] || 'campainha_classica';
                  channelName = 'motoboy_canal_' + activeSound + '_v2';
                }


                let fcmSoundFile = activeSound;
                if (fcmSoundFile === 'original') fcmSoundFile = 'notificacao';

                let androidNotification = { 
                  channelId: channelName, 
                  defaultSound: activeSound === 'original',
                  notificationPriority: 'PRIORITY_MAX'
                };
                if (activeSound !== 'mudo') {
                  androidNotification.sound = fcmSoundFile;
                }

                const message = {
                  notification: { title: ev.titulo, body: ev.corpo },
                  data: { 
                    event: 'custom-fcm-agendado', 
                    sound: activeSound !== 'mudo' ? fcmSoundFile : '', 
                    event_id: ev.id 
                  },
                  android: { 
                    priority: 'high', 
                    notification: androidNotification 
                  },
                  apns: {
                    payload: {
                      aps: {
                        sound: activeSound !== 'mudo' ? (activeSound === 'original' ? 'notificacao.caf' : activeSound + '.caf') : '',
                        badge: 1
                      }
                    }
                  },
                  token: sub.endpoint
                };
                let firebaseApp = admin;
                if (dest === 'motoboy' && admin.apps.find(a => a.name === 'motoboy')) firebaseApp = admin.app('motoboy');
                else if (dest === 'cozinha' && admin.apps.find(a => a.name === 'cozinha')) firebaseApp = admin.app('cozinha');
                
                promises.push(
                  firebaseApp.messaging().send(message)
                    .then(() => { totalEnviados++; })
                    .catch(err => console.error('Erro FCM Agendado:', err.message))
                );
              }
            }
          }
          await Promise.all(promises);
          
          ev.ultimoDisparo = now.toISOString();
          ev.disparadoEm = now.toISOString();
          ev.alcanceTotal = totalEnviados;

          if (ev.recorrente) {
            const proximaData = new Date(dataAgenda);
            if (ev.frequencia === 'diaria') {
              while (proximaData <= now) proximaData.setDate(proximaData.getDate() + 1);
            } else if (ev.frequencia === 'semanal') {
              while (proximaData <= now) proximaData.setDate(proximaData.getDate() + 7);
            } else if (ev.frequencia === 'customizada' && Array.isArray(ev.diasSemana) && ev.diasSemana.length > 0) {
              while (proximaData <= now || !ev.diasSemana.includes(proximaData.getDay())) {
                proximaData.setDate(proximaData.getDate() + 1);
              }
            } else {
              while (proximaData <= now) proximaData.setDate(proximaData.getDate() + 1);
            }
            ev.agendadoPara = proximaData.toISOString();
            ev.enviado = false;
          } else {
            ev.enviado = true;
          }
          mudou = true;
        }
      }
    }
    
    if (mudou) {
      const valor = JSON.stringify(lista);
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('fcm_custom_events', $1) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('fcm_custom_events', ?)", [valor]);
      }
      console.log(`⏰ [Agendador FCM] Lista de agendados atualizada no banco.`);
    }
  } catch (error) {
    console.error('Erro no agendador de FCM:', error.message);
  } finally {
    // Libera o lock após terminar o processamento
    try {
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0') ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor");
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('fcm_agenda_lock', '0')");
      }
    } catch (e) {
      console.error('Erro ao liberar lock do agendador FCM:', e.message);
    }
  }
}

// --- ROTA DEBUG TEMPORÁRIA: INSPECIONA TOKENS NO BANCO ---
app.get('/api/debug/push-subs', isAdmin, ensureDbInitialized, async (req, res) => {
  try {
    const subs = (await query("SELECT id, garcom_id, app_type, is_native, LENGTH(endpoint) as endpoint_len, LEFT(endpoint, 30) as endpoint_preview, created_at FROM push_subscriptions ORDER BY created_at DESC")).rows;
    res.json({ total: subs.length, subs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ROTA CRON MANUAL DE MONITORAMENTO DE PEDIDOS ATRASADOS (>10 MIN) ---
app.get('/api/cron/check-delayed-orders', ensureDbInitialized, async (req, res) => {
  // Proteção por CRON_SECRET: se definido, exige o header Authorization correto
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron request.' });
    }
  }
  await checkAndNotifyDelayedOrders();
  await checkAndSendScheduledFCM();
  res.json({ message: "Verificação de atrasos e agendamentos executada." });
});

// Helper para buscar taxa de serviço dinamicamente
async function getTaxaServicoMultiplicador() {
  try {
    const res = await query("SELECT valor FROM sistema_config WHERE chave = 'taxa_servico'");
    if (res.rows && res.rows.length > 0 && res.rows[0].valor) {
      const taxa = parseFloat(res.rows[0].valor);
      if (!isNaN(taxa)) return 1 + (taxa / 100);
    }
  } catch (e) {
    console.error("Erro ao buscar taxa de serviço:", e);
  }
  return 1.10; // default 10%
}

async function verificarEstoqueBaixo(menuId) {
  try {
    const item = (await query("SELECT id, nome, estoque FROM menu WHERE id = ?", [menuId])).rows[0];
    if (item && item.estoque !== -1 && item.estoque <= 5) {
      console.log(`⚠️ [Estoque] Baixo: ${item.nome} (${item.estoque})`);
      await safePusherTrigger('garconnexpress', 'estoque-baixo', {
        id: item.id,
        nome: item.nome,
        estoque: item.estoque,
        mensagem: `⚠️ ESTOQUE BAIXO: ${item.nome} restam apenas ${item.estoque} un.`
      });
    }
  } catch (e) {
    console.error("Erro ao verificar estoque baixo:", e);
  }
}

// ─── HELPER: Abate Estoque com Ficha Técnica ────────────────────────────────
// Se o item possui ficha técnica (doses/drinks), desconta cada ingrediente.
// Caso contrário, desconta o próprio item (comportamento original).
async function abaterEstoquePorFichaTecnica(menuId, quantidadeVendida) {
  try {
    const ficha = (await query(
      'SELECT ingrediente_id, quantidade FROM ficha_tecnica WHERE menu_id = ?',
      [menuId]
    )).rows;

    if (ficha && ficha.length > 0) {
      // Produto com ficha técnica → desconta cada ingrediente
      for (const linha of ficha) {
        const qtdDesconto = linha.quantidade * quantidadeVendida;
        await query(
          'UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?',
          [qtdDesconto, linha.ingrediente_id]
        );
        await verificarEstoqueBaixo(linha.ingrediente_id);
      }
    } else {
      // Produto simples → desconta diretamente (comportamento original)
      await query(
        'UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?',
        [quantidadeVendida, menuId]
      );
    }
  } catch (e) {
    console.error('Erro ao abater estoque por ficha técnica:', e.message);
    // Fallback seguro: tenta desconto direto para não bloquear venda
    await query(
      'UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?',
      [quantidadeVendida, menuId]
    ).catch(() => {});
  }
}

// ─── HELPER: Devolve Estoque com Ficha Técnica ──────────────────────────────
// Se o item possui ficha técnica (doses/drinks), devolve cada ingrediente.
// Caso contrário, devolve o próprio item (comportamento original).
async function retornarEstoquePorFichaTecnica(menuId, quantidadeRetornada) {
  try {
    const ficha = (await query(
      'SELECT ingrediente_id, quantidade FROM ficha_tecnica WHERE menu_id = ?',
      [menuId]
    )).rows;

    if (ficha && ficha.length > 0) {
      for (const linha of ficha) {
        const qtdRetorno = linha.quantidade * quantidadeRetornada;
        await query(
          'UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?',
          [qtdRetorno, linha.ingrediente_id]
        );
      }
    } else {
      await query(
        'UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?',
        [quantidadeRetornada, menuId]
      );
    }
  } catch (e) {
    console.error('Erro ao retornar estoque por ficha técnica:', e.message);
    await query(
      'UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?',
      [quantidadeRetornada, menuId]
    ).catch(() => {});
  }
}

// ─── HELPER: Valida se há Estoque Disponível (Incluindo Ficha Técnica) ───────
async function verificarEstoqueDisponivel(menuId, quantidadeDesejada) {
  try {
    const ficha = (await query(
      'SELECT ft.ingrediente_id, ft.quantidade, m.nome, m.estoque, m.unidade FROM ficha_tecnica ft JOIN menu m ON ft.ingrediente_id = m.id WHERE ft.menu_id = ?',
      [menuId]
    )).rows;

    if (ficha && ficha.length > 0) {
      for (const linha of ficha) {
        if (linha.estoque !== null && linha.estoque !== undefined && linha.estoque !== -1) {
          const totalNecessario = linha.quantidade * quantidadeDesejada;
          if (linha.estoque < totalNecessario) {
            return {
              disponivel: false,
              erro: `⚠️ O ingrediente "${linha.nome}" está com estoque insuficiente.\n\nNecessário para este pedido: ${totalNecessario} ${linha.unidade || 'un'}\nDisponível no estoque: ${linha.estoque} ${linha.unidade || 'un'}`
            };
          }
        }
      }
    } else {
      const p = (await query('SELECT nome, estoque, unidade FROM menu WHERE id = ?', [menuId])).rows[0];
      if (p && p.estoque !== null && p.estoque !== undefined && p.estoque !== -1 && p.estoque < quantidadeDesejada) {
        return {
          disponivel: false,
          erro: `⚠️ O produto "${p.nome}" não possui estoque suficiente para esta venda.\n\nDisponível atual: ${p.estoque} ${p.unidade || 'un'}`
        };
      }
    }
    return { disponivel: true };
  } catch (e) {
    console.error('Erro ao verificar estoque disponível:', e.message);
    return { disponivel: true }; // Em caso de erro, permite a venda por segurança
  }
}

async function notifyStatus(pedidoId, mesaDbId, status, mesaNumPredefined = null) {
  try {
    let mesaNum = mesaNumPredefined;
    let finalMesaId = mesaDbId;
    let garcomId = null;

    // Prioridade: Se temos o ID do pedido, buscamos os dados reais para evitar rotular Delivery como Balcão
    if (pedidoId) {
      const res = await query("SELECT m.id as mesa_id, m.numero as mesa_numero, p.garcom_id FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [pedidoId]);
      if (res.rows[0]) {
        garcomId = res.rows[0].garcom_id;
        finalMesaId = finalMesaId || res.rows[0].mesa_id;
        
        if (garcomId === 'DELIVERY') {
          mesaNum = `DELIVERY #${pedidoId}`;
        } else if (!mesaNum) {
          mesaNum = res.rows[0].mesa_numero ? `Mesa ${res.rows[0].mesa_numero}` : 'BALCÃO';
        }
      }
    }

    // Caso não tenha pedidoId ou a busca falhou, tenta buscar pela mesaDbId
    if (!mesaNum && finalMesaId) {
      const res = await query("SELECT numero FROM mesas WHERE id = ?", [finalMesaId]);
      mesaNum = res.rows[0] ? `Mesa ${res.rows[0].numero}` : 'BALCÃO';
    }

    // Fallback final
    if (!mesaNum) mesaNum = 'BALCÃO';
    
    const payload = { pedido_id: pedidoId, mesa_id: finalMesaId, mesa_numero: mesaNum, status: status, garcom_id: garcomId };
    console.log(`🔔 [Notificação] ${status.toUpperCase()}: ${mesaNum} (ID Pedido: ${pedidoId || 'N/A'})`);

    // Dispara Pusher IMEDIATAMENTE (Prioridade)
    await safePusherTrigger('garconnexpress', 'status-atualizado', payload);

    const statusMessages = {
      recebido: '✅ *PEDIDO RECEBIDO!*\n\nOlá! Seu pedido *#{pedidoId}* foi recebido com sucesso!',
      preparando: '🍳 *PREPARANDO SEU PEDIDO*\n\nSeu pedido *#{pedidoId}* já está sendo preparado pela nossa cozinha!',
      aguardando_fechamento: '🛎️ *FECHAMENTO SOLICITADO*\n\nOlá! Seu pedido *#{pedidoId}* foi finalizado e está aguardando pagamento.',
      pronto: '✅ *PEDIDO PRONTO!*\n\nOlá! Seu pedido *#{pedidoId}* já está pronto!',
      servido: '📝 *PEDIDO SERVIDO!*\n\nOlá! Seu pedido *#{pedidoId}* foi marcado como servido.',
      saiu_entrega: '🛵 *SAIU PARA ENTREGA!*\n\nBoa notícia! Seu pedido *#{pedidoId}* saiu para entrega agora mesmo!',
      entregue: '✅ *PEDIDO CONCLUÍDO!*\n\nOlá! Seu pedido *#{pedidoId}* foi finalizado com sucesso. Obrigado pela preferência!',
      balcao_imediato: '🏪 *VENDA DE BALCÃO CONCLUÍDA!*\n\nOlá! Sua compra de balcão *#{pedidoId}* foi finalizada com sucesso. Agradecemos a preferência e volte sempre! 🛍️✨',
      cancelado: '❌ *PEDIDO CANCELADO*\n\nOlá! Seu pedido *#{pedidoId}* foi cancelado pelo estabelecimento.'
    };

    // NOTIFICAÇÃO PROATIVA VIA WHATSAPP PARA QUALQUER PEDIDO COM TELEFONE CADASTRADO
    if (pedidoId) {
       try {
         const pData = (await query("SELECT cliente_telefone, garcom_id, balcao_imediato FROM pedidos WHERE id = ?", [pedidoId])).rows[0];
         const clienteTelefone = (pData && pData.cliente_telefone) ? pData.cliente_telefone.trim() : null;
         
         if (clienteTelefone) {
            let statusBot = status;
            if (status === 'entregue' && pData.balcao_imediato === 1) {
              statusBot = 'balcao_imediato';
            } else if (status === 'aguardando_fechamento' && pData.garcom_id === 'DELIVERY') {
              statusBot = 'entregue';
            }
           // Mapeia 'servido' para 'saiu_entrega' se for DELIVERY
           if (status === 'servido' && pData.garcom_id === 'DELIVERY') {
             statusBot = 'saiu_entrega';
           }

           const mensagem = (statusMessages[statusBot] || `📊 Status do pedido *#{pedidoId}*: ${statusBot}`).replace('#{pedidoId}', pedidoId);
           console.log(`📡 [Notificação Proativa] Enviando status '${statusBot}' para ${clienteTelefone}`);
           notifyDeliveryStatusToBot(clienteTelefone, statusBot, pedidoId, null, mensagem).catch(console.error);
         }
       } catch (e) { console.error('Erro notificação cliente:', e.message); }
    }

    // Notificação WhatsApp em paralelo/background para o ADMIN para qualquer mudança de status
    let adminMsg = null;
    if (status === 'recebido') {
      // Ignora o envio genérico do status "recebido" no WhatsApp porque o fluxo de criação do pedido
      // já envia a notificação detalhada com a lista completa de itens e o valor total.
      adminMsg = null;
    } else if (status === 'preparando') {
      adminMsg = `🍳 *PEDIDO EM PREPARO*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n👨‍🍳 A cozinha iniciou o preparo.`;
    } else if (status === 'pronto') {
      adminMsg = `✅ *PEDIDO PRONTO*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n🔔 O pedido está pronto para ser servido/entregue.`;
    } else if (status === 'servido') {
      if (mesaNum && mesaNum.toString().toUpperCase().startsWith('DELIVERY')) {
        adminMsg = `🛵 *SAIU PARA ENTREGA*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n📦 O motoboy saiu para a entrega.`;
      } else {
        adminMsg = `🍽️ *PEDIDO SERVIDO*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n✓ O pedido foi entregue à mesa.`;
      }
    } else if (status === 'saiu_entrega') {
      adminMsg = `🛵 *SAIU PARA ENTREGA*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n📦 O motoboy saiu para a entrega.`;
    } else if (status === 'aguardando_fechamento') {
      if (mesaNum && mesaNum.toString().toUpperCase().startsWith('DELIVERY')) {
        adminMsg = `📦 *PEDIDO ENTREGUE*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n✓ O delivery foi entregue ao cliente.`;
      } else {
        const pDb = pedidoId ? (await query("SELECT balcao_imediato FROM pedidos WHERE id = ?", [pedidoId])).rows[0] : null;
        if (pDb && pDb.balcao_imediato === 1) {
          adminMsg = null; // Ignora a mensagem de solicitação de conta para vendas rápidas de balcão
        } else {
          adminMsg = `🛎️ *SOLICITAÇÃO DE FECHAMENTO*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n💰 O cliente solicitou a conta.`;
        }
      }
    } else if (status === 'cancelado') {
      adminMsg = `❌ *PEDIDO CANCELADO*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n🗑️ O pedido foi cancelado no sistema.`;
    } else if (status === 'entregue') {
      if (mesaNum && mesaNum.toString().toUpperCase().startsWith('DELIVERY')) {
        adminMsg = `✅ *DELIVERY CONCLUÍDO (PAGO)*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n💰 O pagamento foi registrado e o delivery finalizado.`;
      } else {
        const pDb = (await query("SELECT balcao_imediato, desconto, acrescimo, cobrar_taxa FROM pedidos WHERE id = ?", [pedidoId])).rows[0];
        if (pDb && pDb.balcao_imediato === 1) {
          const itens = (await query("SELECT pi.quantidade, m.nome, COALESCE(pi.preco, m.preco) as preco FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ?", [pedidoId])).rows;
          let itensStr = '';
          let subtotal = 0;
          for (const item of itens) {
            const itemTotal = item.quantidade * item.preco;
            subtotal += itemTotal;
            itensStr += `• ${item.quantidade}x ${item.nome} (R$ ${item.preco.toFixed(2)}) = R$ ${itemTotal.toFixed(2)}\n`;
          }
          
          let calcTotal = subtotal;
          if (pDb.cobrar_taxa) {
            calcTotal = calcTotal * 1.10;
          }
          calcTotal = calcTotal + (pDb.acrescimo || 0) - (pDb.desconto || 0);
          
          adminMsg = `🏪 *VENDA DE BALCÃO FINALIZADA (PAGO)*\n` +
                     `🆔 Pedido: #${pedidoId}\n` +
                     `📍 Local: BALCÃO (Venda Rápida)\n\n` +
                     `🛒 *ITENS COMPRADOS:*\n${itensStr}\n` +
                     `💵 *RESUMO FINANCEIRO:*\n` +
                     `- Subtotal: R$ ${subtotal.toFixed(2)}\n` +
                     (pDb.cobrar_taxa ? `- Taxa (10%): R$ ${(subtotal * 0.1).toFixed(2)}\n` : '') +
                     (pDb.acrescimo ? `- Acréscimo: R$ ${pDb.acrescimo.toFixed(2)}\n` : '') +
                     (pDb.desconto ? `- Desconto: R$ ${pDb.desconto.toFixed(2)}\n` : '') +
                     `💰 *Total Geral:* R$ ${calcTotal.toFixed(2)}\n\n` +
                     `✓ O pagamento foi registrado e a venda concluída.`;
        } else {
          adminMsg = `✅ *PEDIDO FINALIZADO (PAGO)*\n📍 Local: ${mesaNum}\n🆔 Pedido: #${pedidoId}\n💰 O pagamento foi registrado e o pedido fechado.`;
        }
      }
    }

    if (adminMsg) {
      await sendWhatsAppMessage(adminMsg).catch(e => console.error('Erro Wpp Admin Notification:', e.message));
    }

  } catch (e) { console.error('Erro ao notificar status:', e.message); }
}

let dbInitError = null;

async function initDb() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS mesas (id SERIAL PRIMARY KEY, numero INTEGER NOT NULL, status TEXT DEFAULT 'livre', garcom_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS menu (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, preco_original REAL, descricao TEXT, imagem TEXT, estoque INTEGER DEFAULT -1, validade DATE, enviar_cozinha BOOLEAN DEFAULT TRUE, visivel BOOLEAN DEFAULT TRUE, em_promocao BOOLEAN DEFAULT FALSE)`,
    `CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, mesa_id INTEGER, garcom_id TEXT, status TEXT DEFAULT 'recebido', total REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, forma_pagamento TEXT, desconto REAL DEFAULT 0, acrescimo REAL DEFAULT 0, valor_recebido REAL DEFAULT 0, troco REAL DEFAULT 0, cobrar_taxa BOOLEAN DEFAULT TRUE, num_pessoas INTEGER DEFAULT 1, valor_por_pessoa REAL, observacao TEXT, pago_parcial REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY, pedido_id INTEGER, menu_id INTEGER, quantidade INTEGER, observacao TEXT, status TEXT DEFAULT 'pendente')`,
    `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS garcons (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123', telefone TEXT, comissao REAL DEFAULT 0, is_online BOOLEAN DEFAULT FALSE, last_assigned_at TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS usuarios_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sistema_config (chave TEXT PRIMARY KEY, valor TEXT)`,
    `CREATE TABLE IF NOT EXISTS fluxo_caixa (id SERIAL PRIMARY KEY, data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP, data_fechamento TIMESTAMP, valor_inicial REAL NOT NULL, valor_final REAL, status TEXT DEFAULT 'aberto', total_dinheiro REAL DEFAULT 0, total_pix REAL DEFAULT 0, total_cartao REAL DEFAULT 0, total_vendas REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS caixa_movimentacoes (id SERIAL PRIMARY KEY, caixa_id INTEGER NOT NULL, tipo TEXT NOT NULL, valor REAL NOT NULL, motivo TEXT, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS codigos_acesso (id SERIAL PRIMARY KEY, mesa_id INTEGER, codigo TEXT NOT NULL, status TEXT DEFAULT 'ativo', criado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, garcom_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, app_type TEXT DEFAULT 'garcom', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS ficha_tecnica (id SERIAL PRIMARY KEY, menu_id INTEGER NOT NULL, ingrediente_id INTEGER NOT NULL, quantidade REAL NOT NULL, unidade TEXT DEFAULT 'un')`,
    `CREATE TABLE IF NOT EXISTS estoque_movimentacoes (id SERIAL PRIMARY KEY, menu_id INTEGER NOT NULL, quantidade REAL NOT NULL, tipo TEXT NOT NULL, motivo TEXT, criado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_id ON pedido_itens(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_id ON pedidos(mesa_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)`
  ];
  
  // Executa queries sequencialmente para evitar sobrecarga de conexões
  try {
    for (let tableSql of tables) {
      if (isPostgres) await db.query(tableSql);
      else db.exec(tableSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
    }

    // GARANTE QUE SISTEMA_CONFIG EXISTA (Caso tenha sido adicionada depois)
    const sqlConfig = `CREATE TABLE IF NOT EXISTS sistema_config (chave TEXT PRIMARY KEY, valor TEXT)`;
    if (isPostgres) await db.query(sqlConfig);
    else db.exec(sqlConfig);

    await query("INSERT INTO sistema_config (chave, valor) SELECT 'whatsapp_enabled', 'true' WHERE NOT EXISTS (SELECT 1 FROM sistema_config WHERE chave = 'whatsapp_enabled')");
    await query("INSERT INTO sistema_config (chave, valor) SELECT 'delivery_aberto', 'true' WHERE NOT EXISTS (SELECT 1 FROM sistema_config WHERE chave = 'delivery_aberto')");
    
    // Migração da coluna notificado_atraso de forma segura
    try {
      if (isPostgres) {
        await query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS notificado_atraso INTEGER DEFAULT 0");
      } else {
        const columns = await query("PRAGMA table_info(pedidos)");
        if (!columns.rows.find(c => c.name === 'notificado_atraso')) {
          await query("ALTER TABLE pedidos ADD COLUMN notificado_atraso INTEGER DEFAULT 0");
        }
      }
    } catch (e) {}

    // LIMPEZA E REGISTRO DO NÃšMERO DE WHATSAPP (CONSOLIDADO)
    const notificationNumbers = '558293157048'; 
    try {
      // Remove a chave antiga (singular) se existir para evitar confusão
      await query("DELETE FROM sistema_config WHERE chave = 'whatsapp_notify_number'");
      
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [notificationNumbers]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?)", [notificationNumbers]);
      }
    } catch (errConfig) {
      console.error('Erro ao configurar WhatsApp no DB:', errConfig.message);
    }

  } catch (e) {
    console.error('Erro ao verificar/criar tabelas:', e);
  }
  
  try {
    const addCol = async (t, c, type) => { 
      try { 
        if (isPostgres) await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${c} ${type}`); 
        else {
          // Verifica se a coluna já existe no SQLite antes de adicionar
          const info = db.prepare(`PRAGMA table_info(${t})`).all();
          if (!info.some(col => col.name === c)) {
            db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`).run();
          }
        }
      } catch (e) {
        console.warn(`Aviso ao adicionar coluna ${c} em ${t}:`, e.message);
      } 
    };
    
    // Migrações garantidas para todos os bancos
    await addCol('pedido_itens', 'preco', 'REAL');
    await addCol('push_subscriptions', 'app_type', "TEXT DEFAULT 'garcom'");
    await addCol('push_subscriptions', 'is_native', 'INTEGER DEFAULT 0'); // 1 = token FCM nativo (Capacitor), 0 = Web Push
    await addCol('mesas', 'garcom_id', 'TEXT');
    await addCol('pedidos', 'forma_pagamento', 'TEXT');
    await addCol('pedidos', 'notificado_atraso_fechamento', 'INTEGER DEFAULT 0');
    await addCol('pedidos', 'desconto', 'REAL DEFAULT 0');
    await addCol('pedidos', 'acrescimo', 'REAL DEFAULT 0');
    await addCol('pedidos', 'valor_recebido', 'REAL DEFAULT 0');
    await addCol('pedidos', 'troco', 'REAL DEFAULT 0');
    await addCol('pedidos', 'cobrar_taxa', 'BOOLEAN DEFAULT TRUE');
    await addCol('pedidos', 'num_pessoas', 'INTEGER DEFAULT 1');
    await addCol('pedidos', 'valor_por_pessoa', 'REAL');
    await addCol('pedidos', 'solicitou_fechamento', 'BOOLEAN DEFAULT FALSE');
    await addCol('pedidos', 'fechamento_solicitado_em', 'TIMESTAMP');
    await addCol('pedidos', 'fechamento_liberado', 'BOOLEAN DEFAULT FALSE');
    await addCol('menu', 'estoque', 'INTEGER DEFAULT -1');
    await addCol('menu', 'validade', 'DATE');
    await addCol('menu', 'enviar_cozinha', 'BOOLEAN DEFAULT NULL');
    await addCol('menu', 'visivel', 'BOOLEAN DEFAULT TRUE');
    await addCol('menu', 'em_promocao', 'BOOLEAN DEFAULT FALSE');
    await addCol('menu', 'preco_original', 'REAL');
    await addCol('menu', 'descricao', 'TEXT');
    await addCol('garcons', 'telefone', 'TEXT');
    await addCol('pedidos', 'observacao', 'TEXT');
    await addCol('pedidos', 'pago_parcial', 'REAL DEFAULT 0');
    await addCol('garcons', 'comissao', 'REAL DEFAULT 0');
    await addCol('garcons', 'is_online', 'BOOLEAN DEFAULT FALSE');
    await addCol('garcons', 'last_assigned_at', 'TIMESTAMP');
    await addCol('pedidos', 'cliente_telefone', 'TEXT');
    await addCol('pedidos', 'pagamentos_detalhados', 'TEXT');
    await addCol('pedidos', 'balcao_imediato', 'INTEGER DEFAULT 0');
    
    // Garante que a tabela pagamentos tenha as colunas necessárias
    await addCol('pagamentos', 'recebido', 'REAL DEFAULT 0');
    await addCol('pagamentos', 'troco', 'REAL DEFAULT 0');
    // Ficha técnica
    await addCol('menu', 'unidade', "TEXT DEFAULT 'un'");
    await addCol('menu', 'preco_custo', 'REAL DEFAULT 0');
  } catch (e) { 
    console.error('Erro na migração:', e);
    dbInitError = e;
  }

  try {
    const hashedPass = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD || 'Admin#2026', saltRounds);
    // Otimização: Só tenta inserir admin se não detectou existência da tabela no passo anterior (ou seja, criação nova)
    // OU se a verificação inicial falhou.
    // Para segurança, tenta SELECT rápido
    const adminExists = await query('SELECT id FROM usuarios_admin WHERE usuario = ?', ['admin']);
    if (adminExists.rows.length === 0) await query('INSERT INTO usuarios_admin (usuario, senha) VALUES (?, ?)', ['admin', hashedPass]);
  } catch (e) {
    console.error('Erro ao criar admin:', e);
  }
}

// Função de retry com delay exponencial
async function retryWithDelay(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.warn(`Tentativa ${i + 1} falhou:`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
}

let dbInitialized = false;
let dbInitializationPromise = null;

// Função para inicializar banco de forma lazy
async function lazyInitDb() {
  if (dbInitialized) return true;
  if (dbInitializationPromise) return dbInitializationPromise;

  dbInitializationPromise = (async () => {
    try {
      console.log('🔄 Inicializando banco de dados (lazy)...');
      await retryWithDelay(async () => {
        if (isPostgres) await db.query('SELECT 1');
      }, 5, 2000);

      await retryWithDelay(async () => {
        await initDb();
      }, 3, 1000);

      dbInitialized = true;
      console.log('✅ Banco de dados inicializado com sucesso (lazy)');
      return true;
    } catch (e) {
      console.error('❌ Erro ao inicializar banco (lazy):', e.message);
      dbInitError = e;
      dbInitializationPromise = null; // Permite tentar novamente em próxima requisição
      return false;
    }
  })();

  return dbInitializationPromise;
}
// Middleware para garantir que o banco está inicializado
async function ensureDbInitialized(req, res, next) {
  if (!isPostgres) {
    next();
    return;
  }
  
  const initialized = await lazyInitDb();
  if (initialized) {
    next();
  } else {
    res.status(503).json({ error: 'Banco de dados não disponível. Tente novamente em alguns segundos.' });
  }
}

// Inicialização segura do banco de dados (evita timeout no cold start)
if (!isPostgres) {
  initDb().catch(console.error);
} else {
  // Adia a inicialização para evitar timeout no startup
  console.log('â ³ Inicialização do banco adiada (lazy loading)');
}

app.get('/*.apk', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  
  // 1. Tenta servir da pasta local (build assets originais)
  let filePath = path.join(__dirname, req.path);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  
  // 2. Se for na Vercel (read-only), tenta servir do diretório temporário /tmp
  filePath = path.join('/tmp', req.path);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  
  res.status(404).send('APK não encontrado.');
});

app.use(express.static(path.join(__dirname, 'frontend'), {

  setHeaders: (res, path) => {
    if (path.endsWith('.html') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const noCacheHeaders = {
  setHeaders: (res, path) => {
    if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
};
app.use('/app-motoboy', express.static(path.join(__dirname, 'motoboy-app-nativo', 'www'), noCacheHeaders));
app.use('/app-cozinha', express.static(path.join(__dirname, 'cozinha-app-nativo', 'www'), noCacheHeaders));
app.use('/app-garcom', express.static(path.join(__dirname, 'garcom-app-nativo', 'www'), noCacheHeaders));
app.get('/', (req, res) => res.redirect('/garcom'));
app.get('/garcom', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'garcom', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin', 'index.html')));
app.get('/cozinha', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'cozinha', 'index.html')));
app.get('/motoboy', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'motoboy', 'index.html')));
app.get('/delivery', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'delivery', 'index.html')));
app.get('/cardapio', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'cardapio', 'index.html')));

// Middlewares de Autenticação JWT
function isAuthenticated(req, res, next) {
  // Prioriza o Header Authorization, depois tenta o Cookie específico
  const token = req.headers.authorization?.split(' ')[1] || req.cookies.garcom_token || req.cookies.admin_token || req.cookies.token;

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error(`❌ Erro no token [${req.url}]:`, err.message);
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
}

function isAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies.admin_token || req.cookies.token;

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'admin') {
      req.user = decoded;
      next();
    } else {
      console.warn(`⚠️ Acesso admin negado para usuário: ${decoded.usuario} (Role: ${decoded.role})`);
      res.status(403).json({ error: 'Acesso negado. Apenas admin.' });
    }
  } catch (err) {
    console.error(`❌ Erro no token admin [${req.url}]:`, err.message);
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
}
app.post('/api/logout', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies.garcom_token || req.cookies.admin_token || req.cookies.token;
  if (token && token !== 'null') {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role === 'garcom') {
        await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isPostgres ? false : 0, decoded.id]);
        console.log(`👋 Garçom ${decoded.usuario} offline.`);
      }
    } catch (e) {
      console.error('Erro ao desativar online no logout:', e.message);
    }
  }
  
  const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none' };
  res.clearCookie('token', cookieOptions);
  res.clearCookie('admin_token', cookieOptions);
  res.clearCookie('garcom_token', cookieOptions);
  res.json({ success: true });
});

// Pausar/Retomar atendimento (Rodízio)
app.post('/api/garcom/pausar', isAuthenticated, async (req, res) => {
  const { pausado } = req.body;
  if (req.user.role !== 'garcom') return res.status(403).json({ error: 'Apenas garçons podem pausar atendimento.' });

  try {
    const isOnline = pausado ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
    await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isOnline, req.user.id]);
    
    console.log(`👤 Garçom ${req.user.usuario} agora está ${pausado ? 'PAUSADO' : 'DISPONÍVEL'}.`);
    
    // Notifica o Admin em tempo real
    await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
      garcom_id: req.user.id,
      pausado: pausado
    });

    res.json({ success: true, is_online: !pausado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin força pausa/disponibilidade do garçom
app.post('/api/admin/garcons/:id/toggle-status', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const garcom = (await query("SELECT id, is_online FROM garcons WHERE id = ?", [id])).rows[0];
    if (!garcom) return res.status(404).json({ error: 'Garçom não encontrado' });

    const novoStatus = garcom.is_online ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
    await query("UPDATE garcons SET is_online = ? WHERE id = ?", [novoStatus, id]);

    const pausado = novoStatus ? false : true;
    
    // Notifica via Pusher
    await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
      garcom_id: id,
      pausado: pausado
    });

    res.json({ success: true, is_online: !!novoStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper para verificar se uma lista de IDs de menu contém itens para a cozinha (JS)
async function checkTemItemCozinha(itensIds) {
  const configK = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
  const catsCozinha = configK.rows[0]?.valor ? JSON.parse(configK.rows[0].valor).map(c => c.trim().toUpperCase()) : [];
  
  for (const menuId of itensIds) {
    const m = (await query("SELECT enviar_cozinha, categoria FROM menu WHERE id = ?", [menuId])).rows[0];
    if (m) {
      const envCozinha = m.enviar_cozinha;
      const categoria = (m.categoria || '').trim().toUpperCase();
      
      // Lógica consistente com getFilterCozinha (Prioridade):
      // 1. Override manual (0 ou 1) ganha sempre.
      // 2. Se nulo ou não definido, segue a categoria.
      let vaiCozinha = false;
      if (envCozinha === 0 || envCozinha === false || envCozinha === '0' || envCozinha === 'false') {
        vaiCozinha = false;
      } else if (envCozinha === 1 || envCozinha === true || envCozinha === '1' || envCozinha === 'true') {
        vaiCozinha = true;
      } else if (catsCozinha.length > 0) {
        vaiCozinha = catsCozinha.includes(categoria);
      } else {
        vaiCozinha = true; // Default
      }
      if (vaiCozinha) return true;
    }
  }
  return false;
}

async function notifyDeliveryStatusToBot(number, status, pedidoId, tempo = null, mensagem = null) {
  if (!botUrlFinal) return;
  try {
    const botUrl = botUrlFinal.endsWith('/') ? botUrlFinal : `${botUrlFinal}/`;
    const botSecret = process.env.BOT_SECRET || process.env.JWT_SECRET || 'seusegredomuitolouco123';
    await fetch(`${botUrl}api/notify-delivery`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${botSecret}`
      },
      body: JSON.stringify({ number, status, pedidoId, tempo, mensagem })
    });
    console.log(`✅ [Notificação Bot] Status '${status}' enviado para ${number}`);
  } catch (e) {
    console.error(`❌ Erro ao notificar bot sobre status delivery:`, e.message);
  }
}

app.put('/api/pedidos/:id/cozinha-pronto', statusLimiter, isAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    // Marca todos os itens pendentes como 'pronto'
    await query("UPDATE pedido_itens SET status = 'pronto' WHERE pedido_id = ? AND status = 'pendente'", [id]);
    
    // Verifica se todos os itens estão pelo menos como 'pronto' ou 'entregue'
    const itens = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    const todosProntos = itens.every(i => i.status === 'pronto' || i.status === 'entregue');
    
    if (todosProntos) {
      await query("UPDATE pedidos SET status = 'pronto' WHERE id = ?", [id]);
    }

    // Notifica admin e garçom
    const pedido = (await query("SELECT p.garcom_id, p.cliente_telefone, m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    let mesaExibicao = 'BALCÃO';
    if (pedido) {
      if (pedido.garcom_id === 'DELIVERY') mesaExibicao = `DELIVERY #${id}`;
      else mesaExibicao = pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : 'BALCÃO';
    }
    
    await safePusherTrigger('garconnexpress', 'pedido-pronto', { 
      pedido_id: id, 
      mesa_numero: mesaExibicao,
      garcom_id: pedido ? pedido.garcom_id : null,
      mensagem: `🍳 Pedido ${mesaExibicao} está pronto!` 
    });

    await notifyStatus(id, null, 'pronto');
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Helper para gerar a cláusula WHERE de itens da cozinha de forma consistente
async function getFilterCozinha() {
  const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
  const categoriasCozinha = config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : [];
  
  const sqlTrue = isPostgres ? 'TRUE' : '1';
  const sqlFalse = isPostgres ? 'FALSE' : '0';

  // Lógica de Prioridade (Três Estados):
  // 1. Override manual (0 ou 1) ganha sempre.
  // 2. Se nulo (NULL), segue a categoria.
  
  if (categoriasCozinha.length > 0) {
    const catList = categoriasCozinha.map(c => `'${c.trim().toUpperCase().replace(/'/g, "''")}'`).join(',');
    return `(
      CASE 
        WHEN m.enviar_cozinha = ${sqlFalse} THEN 0
        WHEN m.enviar_cozinha = ${sqlTrue} THEN 1
        WHEN UPPER(TRIM(m.categoria)) IN (${catList}) THEN 1
        ELSE 0 
      END = 1
    )`;
  } else {
    // Se NENHUMA categoria estiver selecionada, apenas o que for explicitamente 1 vai para a cozinha.
    // O que for NULL não vai (pois não tem categoria habilitada).
    return `m.enviar_cozinha = ${sqlTrue}`;
  }
}

const marcarEntregueLocks = new Set();
app.put('/api/pedidos/:id/marcar-entregue', statusLimiter, isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { apenasProntos } = req.body;
  if (marcarEntregueLocks.has(id)) return res.status(429).json({ error: 'Processando requisição anterior, aguarde...' });
  marcarEntregueLocks.add(id);
  try {
    const filterCozinha = await getFilterCozinha();

    if (apenasProntos) {
      // Marca como entregue apenas os itens que já estão PRONTOS ou que NÃO vão para a cozinha (bebidas etc)
      // Note que invertemos a lógica do filtro para pegar o que NÃO é cozinha
      await query(`
        UPDATE pedido_itens 
        SET status = 'entregue' 
        WHERE pedido_id = ? 
        AND (status = 'pronto' OR (status = 'pendente' AND menu_id IN (SELECT id FROM menu m WHERE NOT (${filterCozinha}))))
      `, [id]);
    } else {
      // BLOQUEIO SERVER-SIDE: Verifica se há itens SENDO FEITOS na cozinha
      const prep = await query(`
        SELECT pi.id 
        FROM pedido_itens pi 
        JOIN menu m ON pi.menu_id = m.id 
        WHERE pi.pedido_id = ? 
        AND pi.status = 'pendente' 
        AND (${filterCozinha})
      `, [id]);

      if (prep.rows.length > 0) {
        return res.status(400).json({ 
          error: 'COZINHA_ATIVA', 
          mensagem: `Não é possível entregar tudo! Existem ${prep.rows.length} itens ainda em preparo na cozinha.` 
        });
      }

      await query("UPDATE pedido_itens SET status = 'entregue' WHERE pedido_id = ?", [id]);
    }
    
    // Consolidação de itens duplicados (mesmo menu_id e observação)
    const itensEntregues = (await query("SELECT id, menu_id, quantidade, observacao FROM pedido_itens WHERE pedido_id = ? AND status = 'entregue'", [id])).rows;
    const vistos = {};
    for (const item of itensEntregues) {
      const chave = `${item.menu_id}_${item.observacao || ''}`;
      if (vistos[chave]) {
        // Soma quantidade ao primeiro visto e remove o atual
        await query("UPDATE pedido_itens SET quantidade = quantidade + ? WHERE id = ?", [item.quantidade, vistos[chave].id]);
        await query("DELETE FROM pedido_itens WHERE id = ?", [item.id]);
      } else {
        vistos[chave] = item;
      }
    }

    // Só muda status do pedido para 'servido' se TODOS os itens foram entregues
    const pendentesCount = (await query("SELECT COUNT(*) as total FROM pedido_itens WHERE pedido_id = ? AND status IN ('pendente', 'pronto')", [id])).rows[0].total;
    
    // Busca status anterior para evitar notificações redundantes
    const prevStatusRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const prevStatus = prevStatusRes.rows[0] ? prevStatusRes.rows[0].status : null;

    if (parseInt(pendentesCount) === 0) {
      if (prevStatus !== 'servido') {
        await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [id]);
        await notifyStatus(id, null, 'servido');
      }
    } else {
      await notifyStatus(id, null, 'itens_atualizados');
    }
    
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true, entregueTudo: parseInt(pendentesCount) === 0 });
  } catch (error) { 
    console.error('Erro ao marcar entregue:', error);
    res.status(500).json({ error: error.message }); 
  } finally {
    marcarEntregueLocks.delete(id);
  }
});

app.put('/api/itens/:id/pronto', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    const item = (await query("SELECT pedido_id, menu_id, quantidade, observacao FROM pedido_itens WHERE id = ?", [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });

    // Tenta encontrar um item idêntico que já foi entregue para mesclar
    const itemExistente = (await query(
      "SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND status = 'entregue' AND (observacao = ? OR (observacao IS NULL AND ? IS NULL)) AND id != ?", 
      [item.pedido_id, item.menu_id, item.observacao, item.observacao, id]
    )).rows[0];

    if (itemExistente) {
      // Mescla com o item existente e remove o atual
      await query("UPDATE pedido_itens SET quantidade = quantidade + ? WHERE id = ?", [item.quantidade, itemExistente.id]);
      await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
    } else {
      // Apenas marca como entregue (OU PRONTO? A função chama /pronto mas o código original marca como entregue?)
      // Na verdade, cozinha marca como pronto, garçom marca como entregue.
      // Vou manter a lógica de marcar como entregue se for essa a intenção da rota original
      await query("UPDATE pedido_itens SET status = 'entregue' WHERE id = ?", [id]);
    }

    // Verifica se ainda existem itens pendentes no pedido
    const pendentes = (await query("SELECT id FROM pedido_itens WHERE pedido_id = ? AND status IN ('pendente', 'pronto')", [item.pedido_id])).rows;
    
    // Busca status anterior para evitar notificações redundantes
    const prevStatusRes = await query("SELECT status FROM pedidos WHERE id = ?", [item.pedido_id]);
    const prevStatus = prevStatusRes.rows[0] ? prevStatusRes.rows[0].status : null;

    if (pendentes.length === 0) {
      if (prevStatus !== 'servido') {
        await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [item.pedido_id]);
        await notifyStatus(item.pedido_id, null, 'servido');
      }
    } else {
      await notifyStatus(item.pedido_id, null, 'itens_atualizados');
    }
    
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { 
    console.error('Erro ao marcar item pronto/entregue:', error);
    res.status(500).json({ error: error.message }); 
  }
});

app.put('/api/pedidos/:id/taxa', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { cobrar_taxa } = req.body;
  try {
    const todosItens = (await query("SELECT i.quantidade, COALESCE(i.preco, m.preco) as preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
    const subtotal = todosItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    const taxaMultiplicador = await getTaxaServicoMultiplicador();
    const total = cobrar_taxa ? Math.round(subtotal * taxaMultiplicador * 100) / 100 : subtotal;

    const taxaBanco = isPostgres ? cobrar_taxa : (cobrar_taxa ? 1 : 0);
    await query("UPDATE pedidos SET total = ?, cobrar_taxa = ? WHERE id = ?", [total, taxaBanco, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/caixa/status', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query("SELECT * FROM fluxo_caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1");
    const caixa = result.rows[0];
    if (!caixa) {
      return res.json(null);
    }
    
    // Verifica se a requisição tem um token válido de admin
    let isUserAdmin = false;
    const token = req.headers.authorization?.split(' ')[1] || req.cookies.admin_token || req.cookies.token;
    if (token && token !== 'null' && token !== 'undefined') {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role === 'admin') {
          isUserAdmin = true;
        }
      } catch (err) {
        // Ignora erro, assume que não é admin
      }
    }

    if (isUserAdmin) {
      res.json(caixa);
    } else {
      // Retorna apenas se o caixa está aberto para clientes e colaboradores comuns, ocultando faturamento
      res.json({ id: caixa.id, status: caixa.status, aberto: true });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/caixa/abrir', isAdmin, async (req, res) => {
  const { valor_inicial } = req.body;
  const valInicialNum = parseFloat(valor_inicial) || 0;
  if (valInicialNum < 0) {
    return res.status(400).json({ error: 'O valor inicial não pode ser negativo.' });
  }
  try {
    const aberto = await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'");
    if (aberto.rows.length > 0) return res.status(400).json({ error: 'Já existe um caixa aberto' });
    const spDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dataLocal = spDate.getFullYear() + '-' + String(spDate.getMonth() + 1).padStart(2, '0') + '-' + String(spDate.getDate()).padStart(2, '0') + ' ' + String(spDate.getHours()).padStart(2, '0') + ':' + String(spDate.getMinutes()).padStart(2, '0') + ':' + String(spDate.getSeconds()).padStart(2, '0');
    await query("INSERT INTO fluxo_caixa (valor_inicial, status, data_abertura) VALUES (?, 'aberto', ?)", [valInicialNum, dataLocal]);
    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'aberto' });
    
    // Notificação WhatsApp com AWAIT obrigatório para Serverless
    await sendWhatsAppMessage(`💰 *CAIXA ABERTO*\n🕒 Horário: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n💵 Valor Inicial: R$ ${Number(valInicialNum).toFixed(2)}`).catch(e => console.error('Erro Wpp:', e.message));

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao abrir caixa' }); }
});

app.post('/api/caixa/fechar', isAdmin, async (req, res) => {
  const { valor_final, id } = req.body;
  try {
    const pedidosAtivos = await query("SELECT id FROM pedidos WHERE status NOT IN ('entregue', 'cancelado', 'rascunho')");
    if (pedidosAtivos.rows.length > 0) return res.status(400).json({ error: 'Existem pedidos pendentes.' });
    
    // Busca dados do caixa antes de fechar para o relatório do WhatsApp
    const dadosCaixa = (await query("SELECT * FROM fluxo_caixa WHERE id = ?", [id])).rows[0];

    const spDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dataLocal = spDate.getFullYear() + '-' + String(spDate.getMonth() + 1).padStart(2, '0') + '-' + String(spDate.getDate()).padStart(2, '0') + ' ' + String(spDate.getHours()).padStart(2, '0') + ':' + String(spDate.getMinutes()).padStart(2, '0') + ':' + String(spDate.getSeconds()).padStart(2, '0');
    await query("UPDATE fluxo_caixa SET valor_final = ?, status = 'fechado', data_fechamento = ? WHERE id = ?", [valor_final, dataLocal, id]);

    // Expira todos os códigos de acesso ativos ao fechar o caixa
    await query("UPDATE codigos_acesso SET status = 'expirado' WHERE status = 'ativo'");
    
    // Força a desconexão de todos os garçons
    await safePusherTrigger('garconnexpress', 'caixa-encerrado', {});

    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'fechado' });

    // Notificação WhatsApp detalhada com AWAIT obrigatório para Serverless
    if (dadosCaixa) {
      const msgWpp = `🔴 *CAIXA FECHADO*\n🕒 Horário: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n` +
                     `📊 *RESUMO DO DIA:*\n` +
                     `💵 Dinheiro: R$ ${Number(dadosCaixa.total_dinheiro || 0).toFixed(2)}\n` +
                     `💳 Cartão: R$ ${Number(dadosCaixa.total_cartao || 0).toFixed(2)}\n` +
                     `📱 Pix: R$ ${Number(dadosCaixa.total_pix || 0).toFixed(2)}\n` +
                     `📈 Total Vendas: R$ ${Number(dadosCaixa.total_vendas || 0).toFixed(2)}\n` +
                     `🏁 Valor Final: R$ ${Number(valor_final || 0).toFixed(2)}`;
      await sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro Wpp:', e.message));
    }

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao fechar caixa' }); }
});

// --- MOVIMENTAÇÕES DE CAIXA (SANGRIA E SUPRIMENTO) ---
app.post('/api/caixa/movimentacao', isAdmin, async (req, res) => {
  const { caixa_id, tipo, valor, motivo } = req.body;
  const valNum = parseFloat(valor) || 0;
  
  if (valNum <= 0) {
    return res.status(400).json({ error: 'O valor da movimentação deve ser maior que zero.' });
  }
  if (tipo !== 'sangria' && tipo !== 'suprimento') {
    return res.status(400).json({ error: 'Tipo de movimentação inválido (deve ser sangria ou suprimento).' });
  }

  try {
    const cx = (await query("SELECT id, status, total_dinheiro FROM fluxo_caixa WHERE id = ?", [caixa_id])).rows[0];
    if (!cx) {
      return res.status(404).json({ error: 'Caixa não encontrado.' });
    }
    if (cx.status !== 'aberto') {
      return res.status(400).json({ error: 'Não é possível movimentar um caixa fechado.' });
    }

    // Se for sangria, verificar se há saldo suficiente em dinheiro
    if (tipo === 'sangria' && cx.total_dinheiro < valNum) {
      return res.status(400).json({ error: `Saldo em dinheiro insuficiente no caixa. Disponível: R$ ${cx.total_dinheiro.toFixed(2)}` });
    }

    // Inserir registro de movimentação
    await query("INSERT INTO caixa_movimentacoes (caixa_id, tipo, valor, motivo) VALUES (?, ?, ?, ?)", [caixa_id, tipo, valNum, motivo || '']);

    // Atualizar saldo em dinheiro do caixa
    const operador = tipo === 'sangria' ? '-' : '+';
    await query(`UPDATE fluxo_caixa SET total_dinheiro = total_dinheiro ${operador} ? WHERE id = ?`, [valNum, caixa_id]);

    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'aberto' });

    // Enviar notificação de WhatsApp
    const emoji = tipo === 'sangria' ? '📤' : '📥';
    const msgWpp = `${emoji} *MOVIMENTAÇÃO DE CAIXA*\n🕒 Horário: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n📝 Tipo: ${tipo.toUpperCase()}\n💵 Valor: R$ ${valNum.toFixed(2)}\n💬 Motivo: ${motivo || 'Sem observações'}`;
    await sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro Wpp:', e.message));

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/caixa/:id/movimentacoes', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query("SELECT * FROM caixa_movimentacoes WHERE caixa_id = ? ORDER BY data DESC", [id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- CONFIGURAÇÕES DE DELIVERY (CONTROLE INDEPENDENTE) ---
// --- LIMPANDO DELIVERY ---

app.get('/api/pedidos/ativos-detalhado', ensureDbInitialized, isAuthenticated, async (req, res) => {
  try {
    const pedidosRes = await query(`
      SELECT p.*, CAST(p.created_at AS TEXT) as created_str, CAST(p.fechamento_solicitado_em AS TEXT) as fechamento_str, m.numero as mesa_numero, g.nome as garcom_nome 
      FROM pedidos p 
      LEFT JOIN mesas m ON p.mesa_id = m.id
      LEFT JOIN garcons g ON p.garcom_id = g.usuario
      WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho')
      ORDER BY p.created_at DESC
      `);
    
    const pedidos = pedidosRes.rows.map(p => {
      if (p.created_str) {
        let dateStr = p.created_str;
        if (!dateStr.endsWith('Z')) dateStr = dateStr.replace(' ', 'T') + 'Z';
        p.created_at = dateStr;
      }
      if (p.fechamento_str) {
        let dateStr = p.fechamento_str;
        if (!dateStr.endsWith('Z')) dateStr = dateStr.replace(' ', 'T') + 'Z';
        p.fechamento_solicitado_em = dateStr;
      }
      return p;
    });
    if (pedidos.length === 0) return res.json([]);

    const pedidoIds = pedidos.map(p => p.id).join(',');
    const itensRes = await query(`
      SELECT pi.*, m.nome, COALESCE(pi.preco, m.preco) as preco, m.categoria, m.enviar_cozinha, m.imagem
      FROM pedido_itens pi
      JOIN menu m ON pi.menu_id = m.id
      WHERE pi.pedido_id IN (${pedidoIds})
    `);

    const itensMap = {};
    itensRes.rows.forEach(item => {
      if (!itensMap[item.pedido_id]) itensMap[item.pedido_id] = [];
      itensMap[item.pedido_id].push(item);
    });

    const resultado = pedidos.map(p => ({
      ...p,
      itens: itensMap[p.id] || []
    }));

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos', ensureDbInitialized, isAuthenticated, async (req, res) => {
  checkAndNotifyDelayedOrders();
  try {
    const result = await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status NOT IN ('entregue', 'cancelado') ORDER BY p.created_at DESC`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/cozinha', ensureDbInitialized, isAuthenticated, async (req, res) => {
  checkAndNotifyDelayedOrders();
  res.setHeader('X-Debug-Version', '1.0.3');
  try {
    const filterCozinha = await getFilterCozinha();
    
    // Lógica super restrita: SÃ“ mostra o que for recebido ou aguardando fechamento
    // Isso exclui automaticamente cancelados, entregues, prontos, etc.
    let whereClause = `LOWER(pi.status) = 'pendente' AND LOWER(p.status) IN ('recebido', 'aguardando_fechamento', 'pronto')`;

    console.log(`🔎 [Cozinha] Filtro SQL: ${filterCozinha}`);

    const result = await query(`
      SELECT 
        pi.id as item_id, 
        pi.quantidade, 
        pi.observacao, 
        pi.status as item_status,
        m.nome as item_nome, 
        m.categoria, 
        p.id as pedido_id, 
        p.status as pedido_status,
        p.created_at,
        p.observacao as pedido_observacao,
        p.garcom_id,
        mes.numero as mesa_numero
        FROM pedido_itens pi
      JOIN menu m ON pi.menu_id = m.id 
      JOIN pedidos p ON pi.pedido_id = p.id 
      LEFT JOIN mesas mes ON p.mesa_id = mes.id 
      WHERE (${whereClause}) AND ${filterCozinha}
      ORDER BY p.created_at ASC
    `);
    
    if (result.rows.length > 0) {
      console.log(`👨‍🍳 [Cozinha] Enviando ${result.rows.length} itens. IDs de pedidos:`, [...new Set(result.rows.map(r => r.pedido_id))]);
    }
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id/pagamentos', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    // Se a tabela não existir, retorna array vazio em vez de erro 500
    try {
      const pagamentos = (await query("SELECT * FROM pagamentos WHERE pedido_id = ? ORDER BY data ASC", [id])).rows;
      res.json(pagamentos || []);
    } catch (e) {
      console.warn("⚠️ Tabela 'pagamentos' pode não existir ainda:", e.message);
      res.json([]);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/pedidos/historico-detalhado', ensureDbInitialized, isAuthenticated, async (req, res) => {
  try {
    const pedidosRes = await query(`
      SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome 
      FROM pedidos p 
      LEFT JOIN mesas m ON p.mesa_id = m.id 
      LEFT JOIN garcons g ON p.garcom_id = g.usuario 
      WHERE p.status IN ('entregue', 'cancelado') 
      ORDER BY p.created_at DESC 
      LIMIT 50
    `);
    
    const pedidos = pedidosRes.rows;
    if (pedidos.length === 0) return res.json([]);

    const ids = pedidos.map(p => p.id);
    const idList = ids.join(',');

    // Busca itens e pagamentos de todos os pedidos de uma vez
    const [itensRes, pagamentosRes] = await Promise.all([
      query(`SELECT pi.*, m.nome, COALESCE(pi.preco, m.preco) as preco, m.imagem FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id IN (${idList})`),
      query(`SELECT * FROM pagamentos WHERE pedido_id IN (${idList}) ORDER BY data ASC`)
    ]);

    const itensMap = {};
    itensRes.rows.forEach(it => {
      if (!itensMap[it.pedido_id]) itensMap[it.pedido_id] = [];
      itensMap[it.pedido_id].push(it);
    });

    const pagamentosMap = {};
    pagamentosRes.rows.forEach(pg => {
      if (!pagamentosMap[pg.pedido_id]) pagamentosMap[pg.pedido_id] = [];
      pagamentosMap[pg.pedido_id].push(pg);
    });

    const resultado = pedidos.map(p => ({
      ...p,
      itens: itensMap[p.id] || [],
      pagamentos: pagamentosMap[p.id] || []
    }));

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/historico', isAuthenticated, async (req, res) => {
  try {
    const result = await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status IN ('entregue', 'cancelado') ORDER BY p.created_at DESC LIMIT 50`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.delete('/api/pedidos/limpar', isAdmin, async (req, res) => {
  try {
    await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE status IN ('entregue', 'cancelado'))");
    await query("DELETE FROM pedidos WHERE status IN ('entregue', 'cancelado')");
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "Erro ao limpar: " + error.message }); }
});

app.get('/api/pedidos/ativo-telefone/:telefone', ensureDbInitialized, async (req, res) => {
  try {
    const { telefone } = req.params;
    const cleanPhone = telefone.replace(/\D/g, '');
    if (!cleanPhone) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }
    const queryStr = `
      SELECT * FROM pedidos 
      WHERE garcom_id = 'DELIVERY' 
        AND status NOT IN ('entregue', 'cancelado') 
        AND (cliente_telefone = ? OR cliente_telefone LIKE ?)
      ORDER BY id DESC LIMIT 1
    `;
    const result = await query(queryStr, [cleanPhone, `%${cleanPhone}`]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nenhum pedido ativo encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.id = ?`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const pedido = result.rows[0];
    if (pedido.garcom_id === 'DELIVERY') {
      return res.json(pedido);
    }
    return isAuthenticated(req, res, () => {
      res.json(pedido);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id/itens', ensureDbInitialized, async (req, res) => { 
  try {
    const pedidoRes = await query("SELECT garcom_id FROM pedidos WHERE id = ?", [req.params.id]);
    if (pedidoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const isDelivery = pedidoRes.rows[0].garcom_id === 'DELIVERY';
    
    const fetchItens = async () => {
      const result = await query(`SELECT pi.*, m.nome, COALESCE(pi.preco, m.preco) as preco, m.categoria, m.enviar_cozinha, m.imagem FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ? ORDER BY pi.status DESC, pi.id ASC`, [req.params.id]);
      res.json(result.rows);
    };

    if (isDelivery) {
      return await fetchItens();
    }
    return isAuthenticated(req, res, async () => {
      await fetchItens();
    });
  } catch (error) {
    console.error('Erro ao buscar itens do pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/pedidos/itens/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    const item = (await query("SELECT pedido_id, menu_id, quantidade FROM pedido_itens WHERE id = ?", [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
    await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
    const itensRestantes = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [item.pedido_id])).rows;
    if (itensRestantes.length === 0) {
      const pedido = (await query("SELECT mesa_id, m.numero, p.garcom_id FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [item.pedido_id])).rows[0];
      await query("DELETE FROM pedidos WHERE id = ?", [item.pedido_id]);
      if (pedido && pedido.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pedido.mesa_id]);
        
        // Notifica o cliente para encerrar o acesso
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${pedido.mesa_id}`, { 
          status: 'cancelado',
          mensagem: "Seu pedido foi cancelado e a mesa liberada. O acesso foi encerrado." 
        });
      }
      
      const mesaNum = pedido ? (pedido.garcom_id === 'DELIVERY' ? `DELIVERY #${item.pedido_id}` : (pedido.numero || 'BALCÃO')) : 'BALCÃO';
      const localStr = pedido && pedido.garcom_id === 'DELIVERY' ? `${mesaNum}` : `Mesa ${mesaNum}`;
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: item.pedido_id, 
        mesa_numero: mesaNum,
        garcom_id: pedido ? pedido.garcom_id : null,
        mensagem: `🚨 O Pedido #${item.pedido_id} (${localStr}) foi CANCELADO.` 
      });

      await notifyStatus(item.pedido_id, pedido ? pedido.mesa_id : null, 'cancelado');
    } else {
      const temPendente = itensRestantes.some(i => i.status === 'pendente');
      if (!temPendente) { await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [item.pedido_id]); await notifyStatus(item.pedido_id, null, 'servido'); }
      else await notifyStatus(item.pedido_id, null, 'itens_atualizados');
    }
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/pedidos/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const pedido = (await query("SELECT p.mesa_id, p.garcom_id, p.status, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const itens = (await query("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    
    if (pedido && pedido.status !== 'cancelado' && pedido.status !== 'entregue') {
      for (const item of itens) await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
    }
    
    await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [id]);
    await query("DELETE FROM pagamentos WHERE pedido_id = ?", [id]);
    await query("DELETE FROM pedidos WHERE id = ?", [id]);
    
    if (pedido) {
      if (pedido.status !== 'entregue' && pedido.status !== 'cancelado' && pedido.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pedido.mesa_id]);

        // Notifica o cliente para encerrar o acesso
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${pedido.mesa_id}`, { 
          status: 'cancelado',
          mensagem: "Este pedido foi removido pelo estabelecimento. Seu acesso foi encerrado." 
        });
      }
      const mesaNum = pedido.garcom_id === 'DELIVERY' ? `DELIVERY #${id}` : (pedido.numero || 'BALCÃO');
      const localStr = pedido.garcom_id === 'DELIVERY' ? `${mesaNum}` : `Mesa ${mesaNum}`;
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: id, 
        mesa_numero: mesaNum,
        garcom_id: pedido.garcom_id,
        mensagem: `🚨 O Pedido #${id} (${localStr}) foi REMOVIDO pelo Admin.` 
      });
    }

    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/pedidos', orderLimiter, async (req, res, next) => {
  if (req.body && req.body.garcom_id === 'DELIVERY') {
    if (req.body.mesa_id) {
      return res.status(403).json({ error: 'Operação não permitida. Pedidos de Delivery não podem especificar mesa_id.' });
    }
    try {
      const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'delivery_aberto'");
      const deliveryAberto = configRes.rows && configRes.rows[0] ? configRes.rows[0].valor === 'true' : false;
      if (!deliveryAberto) {
        return res.status(400).json({ error: 'DELIVERY_FECHADO', message: 'O canal de Delivery está temporariamente fechado.' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao validar status de abertura do delivery: ' + err.message });
    }
    return next();
  }
  return isAuthenticated(req, res, next);
}, async (req, res) => {
  let { mesa_id, garcom_id, itens, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, metodo_pagamento, valor_recebido, troco } = req.body;
  if (req.user && req.user.role === 'cliente') { mesa_id = req.user.mesa_id; garcom_id = null; }
  
  const isDelivery = garcom_id === 'DELIVERY';
  const maxObsLength = isDelivery ? 2000 : 500;
  if (observacao && observacao.length > maxObsLength) {
    return res.status(400).json({ error: `A observação é muito longa. Limite de ${maxObsLength} caracteres.` });
  }

  const deveCobrarTaxa = cobrar_taxa !== false;
  try {
    const caixaAberto = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixaAberto) return res.status(400).json({ error: 'O CAIXA ESTÁ FECHADO!' });

    // TRAVA DEFINITIVA: Verifica status da mesa no banco de mesas (MUITO MAIS SEGURO)
    if (mesa_id) {
      const mesaObj = (await query("SELECT status, garcom_id FROM mesas WHERE id = ?", [mesa_id])).rows[0];
      if (mesaObj && mesaObj.status !== 'livre') {
        return res.status(400).json({ 
          error: 'MESA_OCUPADA', 
          message: 'Esta mesa já está ocupada, fechando ou aguardando pagamento.' 
        });
      }

      // TRAVA DE FILA (RODÍZIO) - BACKEND LOCKOUT
      if (mesaObj && mesaObj.status === 'ocupada' && mesaObj.garcom_id && !isDelivery) {
        // Se a mesa tem um garçom atribuído e não é o garçom atual, bloqueia.
        const isAdmin = req.user && req.user.role === 'admin';
        const isClient = req.user && req.user.role === 'cliente';
        if (!isAdmin && !isClient && mesaObj.garcom_id !== garcom_id) {
            console.log(`🔒 [BLOQUEIO DE ACESSO] Garçom ${garcom_id} tentou acessar a mesa ${mesa_id} que está bloqueada para o garçom ${mesaObj.garcom_id}`);
            return res.status(403).json({
                error: 'MESA_ATENDIDA_POR_OUTRO',
                message: `MESA BLOQUEADA! O garçom selecionado na fila (${mesaObj.garcom_id}) deve atender esta mesa.`
            });
        }
      }

      // BLOQUEIO DE DUPLICIDADE (LOCKOUT): Se já existe um pedido ativo, não permite criar outro (POST)
      // O correto em mesas ocupadas é usar ADICIONAR (PUT)
      const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado', 'rascunho')", [mesa_id])).rows[0];
      if (pedidoAtivo) {
          console.log(`🚫 [BLOQUEIO] Tentativa de duplicar pedido na Mesa ${mesa_id}. Pedido ativo detectado: #${pedidoAtivo.id}`);
          return res.status(400).json({ 
              error: 'MESA_OCUPADA', 
              message: 'Já existe um pedido em andamento para esta mesa. Use a função de adicionar itens.',
              pedido_id: pedidoAtivo.id 
          });
      }

      // LIMPEZA ANTECIPADA DE RASCUNHOS: Evita duplicação ao garantir que rascunhos sumam ANTES do novo pedido entrar
      const mesaIdNum = Number(mesa_id);
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
      for (const r of rascunhos) {
          console.log(`[LIMPEZA-PRE] Removendo rascunho #${r.id} para evitar duplicidade`);
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }
    }
    let subtotalReal = 0;

    for (const item of itens) {
      // 1. Validação Antifraude: Bloqueia Quantidade Zero ou Negativa
      if (!item.quantidade || item.quantidade <= 0) {
        return res.status(400).json({ error: `Quantidade inválida (menor ou igual a zero) detectada.` });
      }

      // 2. Busca o preço oficial no Banco (Ignora o preço enviado pelo cliente)
      const p = (await query("SELECT nome, estoque, preco FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (!p) {
        return res.status(400).json({ error: `Produto não encontrado: ID ${item.menu_id}` });
      }
      
      const checagemEstoque = await verificarEstoqueDisponivel(item.menu_id, item.quantidade);
      if (!checagemEstoque.disponivel) {
        return res.status(400).json({ error: checagemEstoque.erro });
      }

      // 3. Cálculo Seguro do Subtotal
      const precoOficial = parseFloat(p.preco) || 0;
      item.preco_unitario = precoOficial;
      subtotalReal += (precoOficial * item.quantidade);
    }

    // 4. Cálculo do Total Seguro (Ignora req.body.total enviado pelo cliente)
    let total;
    if (garcom_id === 'DELIVERY') {
      total = subtotalReal + 3.00;
    } else {
      const taxaMultiplicador = await getTaxaServicoMultiplicador();
      total = deveCobrarTaxa ? Math.round(subtotalReal * taxaMultiplicador * 100) / 100 : subtotalReal;
    }

    let pedidoId;
    let resPedido;

    // Captura a forma de pagamento (tenta ambos os nomes para evitar erros de versão)
    const fPag = forma_pagamento || metodo_pagamento || null;
    const vRec = valor_recebido || 0;
    const vTrc = troco || 0;

    if (isPostgres) {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa, observacao || '', cliente_telefone || null, fPag, vRec, vTrc]);
      pedidoId = resPedido.rows[0].id;
    } else {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa ? 1 : 0, observacao || '', cliente_telefone || null, fPag, vRec, vTrc]);
      pedidoId = resPedido.lastInsertRowid;
    }

    // NOTIFICAÇÃO PARA DELIVERY (MANTÉM MODO AUTOMÁTICO DO ROBÔ)
    if (garcom_id === 'DELIVERY' && cliente_telefone) {
      const numClean = cliente_telefone.replace(/\D/g, '');
      if (numClean) {
        console.log(`📦 [Delivery] Notificando cliente ${numClean} sobre recebimento...`);
        
        if (whatsappSocket && whatsappSocket.connected) {
          // Apenas notifica o status, o Robô agora está configurado para manter o modo automático
          notifyDeliveryStatusToBot(numClean, 'recebido', pedidoId).catch(console.error);
        }
      }
    }
    if (mesa_id) {
      const mesaIdNum = Number(mesa_id);
      console.log(`[Pedido] Processando mesa ${mesaIdNum}. Garçom: ${garcom_id}`);
      
      // LIMPA RASCUNHOS: Quando o garçom lança o pedido oficial, removemos o rascunho de bloqueio
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
      for (const r of rascunhos) {
          console.log(`[LIMPEZA] Removendo rascunho #${r.id} da mesa ${mesaIdNum}`);
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }

      // Notifica o cliente que o rascunho foi processado e ele pode pedir mais
      safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesaIdNum}`, { success: true }).catch(console.error);

      await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesaIdNum]);

      // GERAÇÃO AUTOMÁTICA DE CÃ“DIGO DE ACESSO (Só se não houver um ativo)
      const acessoExistente = (await query("SELECT id, codigo FROM codigos_acesso WHERE mesa_id = ? AND status = 'ativo' LIMIT 1", [mesaIdNum])).rows[0];

      if (!acessoExistente) {
        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let novoCodigo = '';
        for (let i = 0; i < 4; i++) novoCodigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

        await query("INSERT INTO codigos_acesso (mesa_id, codigo, status) VALUES (?, ?, 'ativo')", [mesaIdNum, novoCodigo]);
        console.log(`🔑 Código automático gerado para Mesa ${mesaIdNum}: ${novoCodigo}`);
      } else {
        console.log(`ℹ️ Mesa ${mesaIdNum} já possui código de acesso ativo (ID: ${acessoExistente.id}, Código: ${acessoExistente.codigo}). Mantendo sessão.`);
      }
    }    if (itens.length > 0) {
      const placeholders = itens.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const values = [];
      for (const item of itens) {
        values.push(pedidoId, item.menu_id, item.quantidade, item.observacao || '', 'pendente', item.preco_unitario || 0);
      }
      await query(`INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status, preco) VALUES ${placeholders}`, values);

      for (const item of itens) {
        await abaterEstoquePorFichaTecnica(item.menu_id, item.quantidade);
        await verificarEstoqueBaixo(item.menu_id);
      }
    }
    let mesaNum = 'BALCÃO';
    if (mesa_id) { 
      const rm = await query("SELECT numero FROM mesas WHERE id = ?", [mesa_id]); 
      mesaNum = rm.rows[0] ? rm.rows[0].numero : 'BALCÃO'; 
    } else if (garcom_id === 'DELIVERY') {
      mesaNum = `DELIVERY #${pedidoId}`;
    }

    // NOTIFICAÇÃO WHATSAPP DETALHADA
    const itensNomes = [];
    for (const item of itens) {
      const p = (await query("SELECT nome FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      itensNomes.push(`${item.quantidade}x ${p ? p.nome : 'Item'}`);
    }
    const msgWpp = `🚀 *NOVO PEDIDO #${pedidoId}*\n📍 Mesa: ${mesaNum}\n📝 Itens:\n${itensNomes.join('\n')}\n💰 Total: R$ ${total.toFixed(2)}`;

    // Verifica se o pedido tem itens para a cozinha (respeitando as categorias configuradas)
    const configK = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    const catsCozinha = configK.rows[0]?.valor ? JSON.parse(configK.rows[0].valor).map(c => c.trim().toUpperCase()) : [];
    
    let temItemCozinha = false;
    for (const item of itens) {
      const m = (await query("SELECT enviar_cozinha, categoria FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (m) {
        const envCozinha = m.enviar_cozinha;
        const categoria = (m.categoria || '').trim().toUpperCase();
        
        // Lógica consistente com getFilterCozinha:
        let vaiCozinha = false;
        if (envCozinha === 0 || envCozinha === false || envCozinha === '0' || envCozinha === 'false') {
          vaiCozinha = false; // Manualmente fora
        } else if (catsCozinha.length > 0) {
          vaiCozinha = catsCozinha.includes(categoria); // Segue filtro de categorias
        } else {
          vaiCozinha = (envCozinha === 1 || envCozinha === true || envCozinha === '1' || envCozinha === 'true');
        }

        if (vaiCozinha) {
          temItemCozinha = true;
          break;
        }
      }
    }

    // Dispara notificações CRÍTICAS para a UI (Aguardar para garantir envio no Vercel)
    await Promise.all([
      notifyStatus(pedidoId, mesa_id, 'recebido', mesaNum),
      safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
      // Notifica o cliente especificamente que o botão pode ser liberado
      safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesa_id}`, {
        success: true,
        mensagem: "Seu rascunho foi processado pelo garçom!"
      }),
      safePusherTrigger('garconnexpress', 'novo-pedido', {
        para_cozinha: temItemCozinha,
        pedido: { id: pedidoId, mesa_id, mesa_numero: mesaNum, status: 'recebido', garcom_id: garcom_id }
      })
    ]);

    // WhatsApp
    await sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro WhatsApp:', e.message));

    res.json({ id: pedidoId, success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/atualizar-itens', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { itens, observacao } = req.body;
  try {
    const itensAtuais = (await query("SELECT id, menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    for (const item of itensAtuais) await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
    for (const item of itens) {
      if (!item.quantidade || item.quantidade <= 0) return res.status(400).json({ error: 'Quantidade inválida (negativa ou zero)' });
      const checagemEstoque = await verificarEstoqueDisponivel(item.menu_id, item.quantidade);
      if (!checagemEstoque.disponivel) {
        // Rollback dos abatimentos prévios antes de retornar o erro de estoque insuficiente
        for (const itemRoll of itensAtuais) await abaterEstoquePorFichaTecnica(itemRoll.menu_id, itemRoll.quantidade);
        return res.status(400).json({ error: checagemEstoque.erro });
      }
    }
    await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [id]);
    let novoSub = 0;
    if (itens.length > 0) {
      const placeholders = itens.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const values = [];
      for (const item of itens) {
        values.push(id, item.menu_id, item.quantidade, item.observacao || '', item.status || 'pendente');
      }
      await query(`INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES ${placeholders}`, values);

      for (const item of itens) {
        await abaterEstoquePorFichaTecnica(item.menu_id, item.quantidade);
        const pMenu = (await query("SELECT preco FROM menu WHERE id = ?", [item.menu_id])).rows[0];
        if (pMenu) novoSub += ((item.preco || pMenu.preco) * item.quantidade);
      }
    }
    const pedido = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
    const taxaMultiplicador = await getTaxaServicoMultiplicador();
    const total = (pedido && pedido.cobrar_taxa) ? Math.round(novoSub * taxaMultiplicador * 100) / 100 : novoSub;
    
    // Determina o status do pedido com base nos itens:
    const temPendente = itens.some(i => i.status === 'pendente' || i.status === 'pronto');
    const novoStatusPedido = temPendente ? 'recebido' : 'servido';
    const agora = new Date().toISOString();
    
    // Busca o status atual para saber se deve resetar o cronômetro
    const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

    // Se está voltando para 'recebido' vindo de um status diferente de 'recebido', reinicia o cronômetro
    // Se já estava em 'recebido', mantém o original.
    if (temPendente) {
      if (statusAnterior !== 'recebido') {
        await query("UPDATE pedidos SET total = ?, status = ?, created_at = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, agora, observacao || '', id]);
      } else {
        await query("UPDATE pedidos SET total = ?, status = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, observacao || '', id]);
      }
      
      const resMesa = await query("SELECT m.numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id]);
      const mesaNum = resMesa.rows[0] ? resMesa.rows[0].numero : 'BALCÃO';
      
      // Busca garcom_id para notificação
      const pMesa = (await query("SELECT garcom_id FROM pedidos WHERE id = ?", [id])).rows[0];

      // Verifica se há itens para a cozinha
      const temItemCozinha = await checkTemItemCozinha(itens.map(i => i.menu_id));
      
      // Notifica em paralelo
      await Promise.all([
        notifyStatus(id, null, 'itens_atualizados'),
        safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
        safePusherTrigger('garconnexpress', 'novo-pedido', { 
          para_cozinha: temItemCozinha,
          is_addition: true,
          pedido: { id: id, mesa_numero: mesaNum, status: 'recebido', garcom_id: pMesa ? pMesa.garcom_id : null } 
        })
      ]);
    } else {
      await query("UPDATE pedidos SET total = ?, status = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, observacao || '', id]);
      await Promise.all([
        notifyStatus(id, null, 'itens_atualizados'),
        safePusherTrigger('garconnexpress', 'menu-atualizado', {})
      ]);
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/adicionar', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { itens, cobrar_taxa, observacao } = req.body;
  try {
    const pOrig = (await query("SELECT mesa_id, garcom_id, cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
    const deveTaxa = cobrar_taxa !== undefined ? cobrar_taxa : (pOrig ? pOrig.cobrar_taxa : true);
    
    // TRAVA DE FILA (RODÍZIO) - BACKEND LOCKOUT
    if (pOrig && pOrig.garcom_id && pOrig.garcom_id !== 'DELIVERY') {
        const isAdmin = req.user && req.user.role === 'admin';
        const isClient = req.user && req.user.role === 'cliente';
        const garcom_id = req.user ? (req.user.usuario || req.user.nome) : null;
        if (!isAdmin && !isClient && pOrig.garcom_id !== garcom_id) {
            console.log(`🔒 [BLOQUEIO DE ACESSO] Garçom ${garcom_id} tentou adicionar itens ao pedido ${id} bloqueado para o garçom ${pOrig.garcom_id}`);
            return res.status(403).json({
                error: 'MESA_ATENDIDA_POR_OUTRO',
                message: `MESA BLOQUEADA! O garçom selecionado na fila (${pOrig.garcom_id}) deve atender esta mesa.`
            });
        }
    }

    for (const item of itens) {
      // 1. Validação Antifraude: Bloqueia Quantidade Zero ou Negativa
      if (!item.quantidade || item.quantidade <= 0) {
        return res.status(400).json({ error: `Quantidade inválida (menor ou igual a zero) detectada.` });
      }
      
      const checagemEstoque = await verificarEstoqueDisponivel(item.menu_id, item.quantidade);
      if (!checagemEstoque.disponivel) return res.status(400).json({ error: checagemEstoque.erro });

      const pMenu = (await query("SELECT preco FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      const precoOficial = pMenu ? (parseFloat(pMenu.preco) || 0) : 0;

      const exist = await query('SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND observacao = ? AND status = ?', [id, item.menu_id, item.observacao || '', 'pendente']);
      if (exist.rows.length > 0) await query('UPDATE pedido_itens SET quantidade = ? WHERE id = ?', [exist.rows[0].quantidade + item.quantidade, exist.rows[0].id]);
      else await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status, preco) VALUES (?, ?, ?, ?, ?, ?)', [id, item.menu_id, item.quantidade, item.observacao || '', 'pendente', precoOficial]);
      await abaterEstoquePorFichaTecnica(item.menu_id, item.quantidade);
    }
    const tItens = (await query("SELECT i.quantidade, COALESCE(i.preco, m.preco) as preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
    const sub = tItens.reduce((sum, i) => sum + ((parseFloat(i.preco) || 0) * i.quantidade), 0);
    const taxaMultiplicador = await getTaxaServicoMultiplicador();
    const tot = deveTaxa ? Math.round(sub * taxaMultiplicador * 100) / 100 : sub;
    const agora = new Date().toISOString();

    // Busca o status atual para saber se deve resetar o cronômetro
    const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

    // Se está voltando para 'recebido' vindo de um status diferente, reinicia o cronômetro (novo ciclo de preparo)
    // Se já estava em 'recebido', mantém o original.
    if (statusAnterior !== 'recebido') {
      await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', created_at = ?, observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), agora, observacao || '', id]);
    } else {
      await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), observacao || '', id]);
    }
    const pMesa = (await query("SELECT mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    if (pMesa && pMesa.mesa_id) {
      const mesaIdNum = pMesa.mesa_id;
      await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesaIdNum]);

      // LIMPA RASCUNHOS: Quando o garçom lança o pedido oficial (adição), removemos o rascunho de bloqueio
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
      for (const r of rascunhos) {
          console.log(`[LIMPEZA-ADD] Removendo rascunho #${r.id} da mesa ${mesaIdNum}`);
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }

      // Notifica o cliente que o rascunho foi processado e ele pode pedir mais
      safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesaIdNum}`, { success: true }).catch(console.error);
    }
    
    // Notifica a cozinha que há novos itens para preparar (com som)
    const mesaNum = pMesa ? pMesa.numero || 'BALCÃO' : 'BALCÃO';
    
    // Verifica se os NOVOS itens vão para a cozinha
    const temItemCozinha = await checkTemItemCozinha(itens.map(i => i.menu_id));

    // Notifica em paralelo
    await Promise.all([
      notifyStatus(id, null, 'itens_adicionados'),
      safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
      safePusherTrigger('garconnexpress', 'novo-pedido', { 
        para_cozinha: temItemCozinha,
        is_addition: true,
        pedido: { id: id, mesa_numero: mesaNum, status: 'recebido', garcom_id: pMesa ? pMesa.garcom_id : null } 
      })
    ]);

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Cliente solicita o fechamento da conta (avisar garçom)
app.post('/api/cliente/solicitar-conta', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'cliente') return res.status(403).json({ error: 'Acesso negado.' });

    const mesaId = decoded.mesa_id;
    
    // Busca o pedido ativo da mesa
    const pedido = (await query("SELECT id, mesa_id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [mesaId])).rows[0];

    if (!pedido) return res.status(404).json({ error: 'Nenhum pedido ativo encontrado para esta mesa.' });

    // TRAVA DE SEGURANÇA: Verifica se existem itens pendentes de entrega
    const itensPendentes = (await query(`
      SELECT id FROM pedido_itens 
      WHERE pedido_id = ? 
      AND status NOT IN ('entregue', 'servido', 'cancelado')
    `, [pedido.id])).rows;

    if (itensPendentes.length > 0) {
      return res.status(400).json({ 
        error: 'PENDENCIAS_ENTREGA', 
        mensagem: 'Você ainda tem itens em preparo ou entrega. Aguarde o recebimento de todos para pedir a conta.' 
      });
    }

    // 1. Atualiza o banco de dados
    // NÃO muda o status da mesa para 'fechando' ainda. 
    // Mantém 'ocupada' para o garçom processar primeiro, mas marca a flag de solicitação.
    await query("UPDATE pedidos SET solicitou_fechamento = TRUE, fechamento_solicitado_em = COALESCE(fechamento_solicitado_em, CURRENT_TIMESTAMP) WHERE id = ?", [pedido.id]);
    await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesaId]); 

    // 2. Busca número da mesa para a notificação
    const mesaRes = await query("SELECT numero FROM mesas WHERE id = ?", [mesaId]);
    const mesaNum = mesaRes.rows[0]?.numero || '??';

    // 3. Notifica Garçom e Admin via Pusher (Som + Modal + Visual Pulsante)
    await safePusherTrigger('garconnexpress', 'solicitacao-fechamento-cliente', {
      pedido_id: pedido.id,
      mesa_id: mesaId,
      mesa_numero: mesaNum,
      mensagem: `🙋‍♂️ MESA ${mesaNum} solicitou o fechamento da conta!`
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ ERRO EM /api/cliente/solicitar-conta:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pedidos/:id/solicitar-fechamento', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { mesa_id, forma_pagamento, desconto, acrescimo, valor_recebido, troco, total, num_pessoas, valor_por_pessoa, pagamentos_detalhados, cliente_telefone, balcao_imediato } = req.body;
  try {
    let totalFinal = total;
    
    // Se o total não for enviado (solicitação do garçom), calcula com base nos itens
    if (totalFinal === undefined || totalFinal === null || totalFinal === 0) {
      const pOrig = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
      const deveTaxa = pOrig ? pOrig.cobrar_taxa : true;
      const tItens = (await query("SELECT i.quantidade, COALESCE(i.preco, m.preco) as preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
      const sub = tItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const taxaMultiplicador = await getTaxaServicoMultiplicador();
      totalFinal = deveTaxa ? Math.round(sub * taxaMultiplicador * 100) / 100 : sub;
    }

    const pagamentosStr = pagamentos_detalhados ? JSON.stringify(pagamentos_detalhados) : null;
    const formaPagamentoFinal = (num_pessoas > 1 && pagamentos_detalhados) ? 'Múltiplas' : (forma_pagamento || 'Dinheiro');

    const pStatusAtual = (await query("SELECT status FROM pedidos WHERE id = ?", [id])).rows[0];
    const prevStatus = pStatusAtual ? pStatusAtual.status : null;

    // Ativa fechamento_liberado quando o garçom processa a solicitação
    await query(`UPDATE pedidos SET status = 'aguardando_fechamento', forma_pagamento = ?, desconto = ?, acrescimo = ?, valor_recebido = ?, troco = ?, total = ?, num_pessoas = ?, valor_por_pessoa = ?, cobrar_taxa = ?, fechamento_liberado = TRUE, fechamento_solicitado_em = COALESCE(fechamento_solicitado_em, CURRENT_TIMESTAMP), pagamentos_detalhados = ?, cliente_telefone = COALESCE(?, cliente_telefone), balcao_imediato = COALESCE(?, balcao_imediato) WHERE id = ?`, 
      [formaPagamentoFinal, desconto || 0, acrescimo || 0, valor_recebido || 0, troco || 0, totalFinal, num_pessoas || 1, valor_por_pessoa || totalFinal, (req.body.cobrar_taxa !== undefined ? (req.body.cobrar_taxa ? 1 : 0) : 1), pagamentosStr, cliente_telefone || null, balcao_imediato ? 1 : 0, id]);
    
    if (mesa_id) await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
    
    if (prevStatus !== 'aguardando_fechamento') {
      await notifyStatus(id, mesa_id, 'aguardando_fechamento');
    }

    // Notifica o cliente que o cupom de conferência foi liberado
    await safePusherTrigger('garconnexpress', `fechamento-liberado-mesa-${mesa_id}`, {
        pedido_id: id,
        mensagem: "Seu cupom de conferência está disponível!"
    });

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/pessoas', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { num_pessoas } = req.body;
  try {
    const p = (await query("SELECT total FROM pedidos WHERE id = ?", [id])).rows[0];
    const valor_por_pessoa = p ? p.total / (num_pessoas || 1) : 0;
    await query("UPDATE pedidos SET num_pessoas = ?, valor_por_pessoa = ? WHERE id = ?", [num_pessoas || 1, valor_por_pessoa, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// HELPER: Whitelist de colunas válidas para forma de pagamento (previne SQL Injection)
function getColPagamento(forma) {
  const formasValidas = {
    'Cartão': 'total_cartao',
    'Pix': 'total_pix',
    'Dinheiro': 'total_dinheiro',
    'Credito': 'total_cartao',
    'Debito': 'total_cartao',
    'Crédito': 'total_cartao',
    'Débito': 'total_cartao',
  };
  return formasValidas[forma] || 'total_dinheiro';
}

app.post('/api/pedidos/:id/pagamento-fracao', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { mesa_id, valor_pago, forma_pagamento, num_pessoas_restantes, recebido, troco } = req.body;
  
  try {
    if (valor_pago <= 0) return res.status(400).json({ error: 'Valor de pagamento não pode ser negativo ou zero' });
    const cx = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!cx) return res.status(400).json({ error: 'CAIXA FECHADO' });

    // Salva o pagamento com os valores REAIS de recebido e troco
    const rec = (recebido !== undefined) ? recebido : valor_pago;
    const trc = (troco !== undefined) ? troco : 0;

    // 1. Busca o pedido original para saber o total atual e a mesa
    const pOrig = (await query("SELECT * FROM pedidos WHERE id = ?", [id])).rows[0];
    if (!pOrig) return res.status(404).json({ error: 'PEDIDO NÃO ENCONTRADO' });

    // 2. Registra o valor no fluxo de caixa
    const col = getColPagamento(forma_pagamento);
    await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valor_pago, valor_pago, cx.id]);

    // 3. Garante que a tabela existe e registra o pagamento
    const sqlCreate = isPostgres 
      ? `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
          : `CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
    
    await query(sqlCreate);
    await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valor_pago, forma_pagamento, rec, trc]);

    // 4. Atualiza o pedido original: incrementa o pago_parcial e ajusta o número de pessoas
    const novoPagoParcial = (pOrig.pago_parcial || 0) + valor_pago;
    // O total do pedido pOrig.total já deve estar atualizado com o valor total bruto (subtotal+taxa+acres-desc)
    const novoTotalMesa = Math.max(0, pOrig.total - valor_pago);
    const novoValorPessoa = num_pessoas_restantes > 0 ? novoTotalMesa / num_pessoas_restantes : 0;

    await query("UPDATE pedidos SET total = ?, pago_parcial = ?, num_pessoas = ?, valor_por_pessoa = ? WHERE id = ?", 
      [novoTotalMesa, novoPagoParcial, num_pessoas_restantes, novoValorPessoa, id]);

    await notifyStatus(id, mesa_id, 'itens_atualizados');
    
    res.json({ 
      success: true, 
      saldo_restante: novoTotalMesa 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pedidos/:id/pagamento-parcial', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { mesa_id, itens, forma_pagamento, total, num_pessoas, valor_por_pessoa } = req.body;
  try {
    const cx = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!cx) return res.status(400).json({ error: 'CAIXA FECHADO' });

    // 1. Registra o pagamento na tabela de pagamentos vinculada ao pedido principal
    const sqlCreate = isPostgres 
      ? `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
          : `CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
    await query(sqlCreate);
    await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, total, forma_pagamento, total, 0]);

    // 2. Remove os itens do pedido original (já que foram pagos separadamente)
    for (const i of itens) {
      await query('DELETE FROM pedido_itens WHERE id = ?', [i.id]);
    }

    // 3. Registra o valor no fluxo de caixa
    const col = getColPagamento(forma_pagamento);
    await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [total, total, cx.id]);

    // 4. Verifica se restam itens no pedido original
    const rest = (await query("SELECT id FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    if (rest.length === 0) { 
      await query("UPDATE pedidos SET status = 'entregue', pago_parcial = pago_parcial + ?, total = 0 WHERE id = ?", [total, id]); 
      await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);
      
      // Notifica o cliente para encerrar o acesso
      await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
        mensagem: "Sua conta foi finalizada. Obrigado pela preferência!" 
      });

      await notifyStatus(null, mesa_id, 'liberada'); 
    } else { 
      // Atualiza o total do pedido original subtraindo o que foi pago
      const pData = (await query("SELECT total, pago_parcial FROM pedidos WHERE id = ?", [id])).rows[0];
      const novoTotal = pData ? Math.max(0, (pData.total || 0) - total) : 0;
      const novoPagoParcial = pData ? ((pData.pago_parcial || 0) + total) : total;
      await query("UPDATE pedidos SET total = ?, pago_parcial = ? WHERE id = ?", [novoTotal, novoPagoParcial, id]);
      await notifyStatus(id, mesa_id, 'itens_atualizados'); 
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/transferir', isAuthenticated, async (req, res) => {
  if (req.user && req.user.role === 'cliente') return res.status(403).json({ error: 'Acesso negado.' });
  const { id } = req.params;
  const { garcom_id } = req.body;
  try {
    const isGarcomReal = garcom_id && garcom_id !== 'ADMIN' && garcom_id !== 'DELIVERY';
    
    if (isGarcomReal) {
      // Ativa a taxa de 10% automaticamente e recalcula o total
      const todosItens = (await query("SELECT i.quantidade, COALESCE(i.preco, m.preco) as preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
      const subtotal = todosItens.reduce((sum, i) => sum + ((parseFloat(i.preco) || 0) * i.quantidade), 0);
      const taxaMultiplicador = await getTaxaServicoMultiplicador();
      const total = Math.round(subtotal * taxaMultiplicador * 100) / 100;
      const taxaBanco = isPostgres ? true : 1;
      
      await query("UPDATE pedidos SET garcom_id = ?, total = ?, cobrar_taxa = ? WHERE id = ?", [garcom_id, total, taxaBanco, id]);
    } else {
      await query("UPDATE pedidos SET garcom_id = ? WHERE id = ?", [garcom_id, id]);
    }

    const p = (await query("SELECT mesa_id FROM pedidos WHERE id = ?", [id])).rows[0];
    if (p && p.mesa_id) {
      await query("UPDATE mesas SET garcom_id = ? WHERE id = ?", [garcom_id, p.mesa_id]);
      await notifyStatus(id, p.mesa_id, 'transferido');
    } else {
      await notifyStatus(id, null, 'transferido');
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pedidos/:id/status', statusLimiter, isAuthenticated, async (req, res) => {
  if (req.user && req.user.role === 'cliente') return res.status(403).json({ error: 'Clientes não podem alterar status de pedidos.' });
  const { id } = req.params;
  const { status, pagamentos_detalhados } = req.body;
  try {
    if (status === 'entregue') {
      const cx = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
      if (!cx) return res.status(400).json({ error: 'CAIXA FECHADO' });

      const p = (await query("SELECT total, forma_pagamento, pago_parcial FROM pedidos WHERE id = ?", [id])).rows[0];
      if (p) {
        // Registra o pagamento final na tabela de pagamentos
        const sqlCreate = isPostgres
          ? `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
          : `CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;

        if (Array.isArray(pagamentos_detalhados) && pagamentos_detalhados.length > 0) {
          // Cenário Multi-Pagamento (Suporta formato novo de objeto ou antigo de string)
          for (const pag of pagamentos_detalhados) {
            let forma = (pag && typeof pag === 'object') ? pag.forma_pagamento : pag;
            let valorParte = (pag && typeof pag === 'object') ? pag.valor : (p.total / pagamentos_detalhados.length);
            let recebido = (pag && typeof pag === 'object') ? (pag.recebido || valorParte) : valorParte;
            let troco = (pag && typeof pag === 'object') ? (pag.troco || 0) : 0;
            
            if (!forma) forma = 'Dinheiro';
            if (!valorParte || isNaN(valorParte)) valorParte = 0;
            if (valorParte < 0) return res.status(400).json({ error: 'Valor fracionado negativo detectado' });

            const col = getColPagamento(forma);
            await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorParte, valorParte, cx.id]);
            await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorParte, forma, recebido, troco]);
          }
        } else {
          // Cenário Normal (Um único pagamento para o saldo restante)
          const col = getColPagamento(p.forma_pagamento);
          const valorFinal = p.total;
          
          // Busca dados de recebido/troco do pedido original (salvos no solicitar-fechamento)
          const pDatalhes = (await query("SELECT valor_recebido, troco FROM pedidos WHERE id = ?", [id])).rows[0];
          const rec = pDatalhes ? pDatalhes.valor_recebido : valorFinal;
          const trc = pDatalhes ? pDatalhes.troco : 0;

          await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorFinal, valorFinal, cx.id]);
          await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorFinal, p.forma_pagamento, rec, trc]);
        }

        // Atualiza o pedido: limpa o saldo e soma ao pago_parcial para consolidar o histórico
        await query("UPDATE pedidos SET pago_parcial = pago_parcial + total, total = 0 WHERE id = ?", [id]);
      }
    }
    // Busca status anterior para controle de estoque e prevenção de redundâncias
    const prevStatusRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const prevStatus = prevStatusRes.rows[0] ? prevStatusRes.rows[0].status : null;

    if (prevStatus === status) {
      console.log(`⚠️ Status do pedido ${id} já é '${status}'. Pulando atualização e notificações redundantes.`);
      return res.json({ success: true });
    }

    await query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    
    if (status === 'cancelado' && prevStatus !== 'cancelado' && prevStatus !== 'rascunho') {
      const itens = (await query("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
      for (const item of itens) {
        await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
      }
      await query("UPDATE pedido_itens SET status = 'cancelado' WHERE pedido_id = ?", [id]);
    }
    const pm = (await query("SELECT p.mesa_id, p.garcom_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const mesaNum = pm ? (pm.garcom_id === 'DELIVERY' ? `DELIVERY #${id}` : (pm.numero || 'BALCÃO')) : 'BALCÃO';
    const localStr = pm && pm.garcom_id === 'DELIVERY' ? `${mesaNum}` : `Mesa ${mesaNum}`;

    // Se o status for cancelado ou entregue, libera a mesa e o código
    if ((status === 'cancelado' || status === 'entregue') && pm && pm.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pm.mesa_id]);
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pm.mesa_id]);

        // Notifica o cliente logado para encerrar o acesso
        const msgLogout = status === 'entregue' ? "Sua conta foi finalizada. Obrigado pela preferência!" : "Este pedido foi cancelado pelo estabelecimento. Seu acesso foi encerrado.";
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${pm.mesa_id}`, { 
          mensagem: msgLogout,
          status: status, // envia 'cancelado' ou 'entregue'
          mesa_id: pm.mesa_id 
        });
    }

    if (status === 'cancelado') {
      console.log(`❌ Pedido ${id} cancelado pelo Admin. Notificando globalmente...`);
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        id: id,
        pedido_id: id, 
        mesa_numero: mesaNum,
        garcom_id: pm ? pm.garcom_id : null,
        mensagem: `🚨 O Pedido #${id} (${localStr}) foi CANCELADO pelo Admin.` 
      });
    }
    
    // Sempre notifica a alteração de status (inclusive cancelado, para o painel admin atualizar a tela)
    await notifyStatus(id, null, status);
    
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/menu', ensureDbInitialized, async (req, res) => {
  try {
    const { admin, garcom } = req.query;
    let querySql = 'SELECT * FROM menu';
    
    if (admin !== 'true') {
      const visivelValue = isPostgres ? 'TRUE' : '1';
      if (garcom === 'true') {
        // Garçom vê tudo que é visível (incluindo estoque 0)
        querySql += ` WHERE visivel = ${visivelValue}`;
      } else {
        // Cliente (Cardápio via QRCode) não vê estoque 0
        querySql += ` WHERE visivel = ${visivelValue} AND (estoque = -1 OR (estoque IS NOT NULL AND estoque > 0))`;
      }
    }
    
    querySql += ' ORDER BY categoria ASC, nome ASC';
    
    const menuRes = await query(querySql);
    let menu = menuRes.rows;

    // Camada 2: JavaScript - Filtro de segurança extra para clientes
    if (admin !== 'true' && garcom !== 'true') {
      menu = menu.filter(item => {
        const est = parseInt(item.estoque);
        return item.visivel && (est === -1 || est > 0);
      });
    }

    const ordemRes = await query("SELECT valor FROM sistema_config WHERE chave = 'ordem_categorias'");
    if (ordemRes.rows.length > 0 && ordemRes.rows[0].valor) {
      const ordem = JSON.parse(ordemRes.rows[0].valor).map(c => c.trim().toUpperCase());
      
      menu.sort((a, b) => {
        const catA = a.categoria.trim().toUpperCase();
        const catB = b.categoria.trim().toUpperCase();
        const indexA = ordem.indexOf(catA);
        const indexB = ordem.indexOf(catB);
        
        // Se ambos estão na lista de ordem, segue a ordem
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        // Se apenas um está, ele vem primeiro
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        // Se nenhum está, mantém ordem alfabética original ou id
        return catA.localeCompare(catB);
      });
    } else {
      // Padrão: Ordenar por validade como estava ou alfabético
      menu.sort((a, b) => (a.validade || '').localeCompare(b.validade || ''));
    }

    res.json(menu);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/ordem-categorias', isAdmin, async (req, res) => {
  const { ordem } = req.body;
  try {
    const valor = JSON.stringify(ordem);
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('ordem_categorias', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('ordem_categorias', ?)", [valor]);
    }
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── Relatórios e Auditoria de Estoque ─────────────────────────────────────
app.get('/api/relatorios/estoque', isAdmin, async (req, res) => {
  const { inicio, fim } = req.query;
  const dateInicio = inicio ? `${inicio} 00:00:00` : '1970-01-01 00:00:00';
  const dateFim = fim ? `${fim} 23:59:59` : '2999-12-31 23:59:59';

  try {
    // 1. Valor do Estoque Detalhado e Total
    const valorEstoqueDetalhadoRes = await query(`
      SELECT id, nome, categoria, estoque, unidade, preco_custo, preco, (estoque * preco_custo) as custo_total 
      FROM menu 
      WHERE estoque > 0 
      ORDER BY custo_total DESC
    `);
    const valorEstoque = valorEstoqueDetalhadoRes.rows.reduce((acc, item) => acc + (parseFloat(item.custo_total) || 0), 0);

    // 2. Produtos Mais Vendidos e Lucro Realizado
    const maisVendidosRes = await query(
      `SELECT m.id, m.nome, m.categoria, m.unidade, COALESCE(pi.preco, m.preco) as preco, m.preco_custo,
              SUM(pi.quantidade) as total_vendido,
              SUM(pi.quantidade * (COALESCE(pi.preco, m.preco) - m.preco_custo)) as lucro_total
       FROM pedido_itens pi
       JOIN menu m ON pi.menu_id = m.id
       JOIN pedidos p ON pi.pedido_id = p.id
       WHERE p.status NOT IN ('cancelado', 'rascunho')
         AND p.created_at >= ?
         AND p.created_at <= ?
       GROUP BY m.id, m.nome, m.categoria, m.unidade, COALESCE(pi.preco, m.preco), m.preco_custo
       ORDER BY total_vendido DESC`,
      [dateInicio, dateFim]
    );

    // 3. Produtos Parados (Sem saídas no período selecionado)
    const produtosParadosRes = await query(
      `SELECT id, nome, categoria, estoque, unidade, preco_custo
       FROM menu
       WHERE estoque > 0
         AND id NOT IN (
           SELECT DISTINCT pi.menu_id
           FROM pedido_itens pi
           JOIN pedidos p ON pi.pedido_id = p.id
           WHERE p.status NOT IN ('cancelado', 'rascunho')
             AND p.created_at >= ?
             AND p.created_at <= ?
         )
       ORDER BY categoria ASC, nome ASC`,
      [dateInicio, dateFim]
    );

    // 4. Histórico de Movimentações (Entradas, Saídas, Perdas)
    const movimentacoesRes = await query(
      `SELECT em.id, em.menu_id, em.quantidade, em.tipo, em.motivo, em.criado_at,
              m.nome as produto_nome, m.unidade as produto_unidade
       FROM estoque_movimentacoes em
       JOIN menu m ON em.menu_id = m.id
       WHERE em.criado_at >= ?
         AND em.criado_at <= ?
       ORDER BY em.criado_at DESC LIMIT 200`,
      [dateInicio, dateFim]
    );

    // 5. Consolidados de Perdas e Entradas
    const totaisRes = await query(
      `SELECT em.tipo, SUM(em.quantidade) as total_qtd,
              SUM(em.quantidade * m.preco_custo) as total_valor
       FROM estoque_movimentacoes em
       JOIN menu m ON em.menu_id = m.id
       WHERE em.criado_at >= ?
         AND em.criado_at <= ?
       GROUP BY em.tipo`,
      [dateInicio, dateFim]
    );

    res.json({
      valorEstoque,
      valorEstoqueDetalhado: valorEstoqueDetalhadoRes.rows,
      maisVendidos: maisVendidosRes.rows,
      produtosParados: produtosParadosRes.rows,
      movimentacoes: movimentacoesRes.rows,
      totais: totaisRes.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/estoque/movimentacao', isAdmin, async (req, res) => {
  const { menu_id, quantidade, tipo, motivo } = req.body;
  const menuId = parseInt(menu_id);
  const qtd = parseFloat(quantidade);

  if (!menuId || isNaN(qtd) || qtd <= 0 || !['entrada', 'perda', 'saida'].includes(tipo)) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }

  try {
    const p = (await query('SELECT estoque, nome FROM menu WHERE id = ?', [menuId])).rows[0];
    if (!p) return res.status(404).json({ error: 'Produto não encontrado' });

    // Atualiza estoque se não for ilimitado (-1)
    if (p.estoque !== -1) {
      const fator = tipo === 'entrada' ? 1 : -1;
      const novoEstoque = Math.max(0, p.estoque + (qtd * fator));
      await query('UPDATE menu SET estoque = ? WHERE id = ?', [novoEstoque, menuId]);
    }

    // Registra a movimentação
    await query(
      'INSERT INTO estoque_movimentacoes (menu_id, quantidade, tipo, motivo) VALUES (?, ?, ?, ?)',
      [menuId, qtd, tipo, motivo || (tipo === 'entrada' ? 'Entrada manual' : 'Perda manual')]
    );

    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/estoque/resetar-movimentacoes', isAdmin, async (req, res) => {
  try {
    await query("DELETE FROM estoque_movimentacoes");
    await query("DELETE FROM pagamentos");
    await query("DELETE FROM pedido_itens");
    await query("DELETE FROM pedidos");
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    await safePusherTrigger('garconnexpress', 'pedido-atualizado', {});
    res.json({ success: true, message: 'Todo o histórico de estoque, vendas e pagamentos foi resetado com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.put('/api/menu/:id', isAdmin, async (req, res) => {
  const { nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao, unidade, preco_custo } = req.body;
  
  const valPreco = parseFloat(preco) || 0;
  const valPrecoOriginal = parseFloat(preco_original) || 0;
  const custo = parseFloat(preco_custo) || 0;
  
  if (valPreco < 0 || valPrecoOriginal < 0 || custo < 0) {
    return res.status(400).json({ error: 'Preço, preço original ou custo não podem ser negativos.' });
  }

  const dataValidade = validade && validade.trim() !== "" ? validade : null;
  const envCozinha = enviar_cozinha !== undefined ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : null;
  const isVisivel = visivel !== undefined ? (isPostgres ? visivel : (visivel ? 1 : 0)) : (isPostgres ? true : 1);
  const emPromocao = em_promocao !== undefined ? (isPostgres ? em_promocao : (em_promocao ? 1 : 0)) : (isPostgres ? false : 0);
  const und = unidade || 'un';
  try {
    await query('UPDATE menu SET nome = ?, categoria = ?, preco = ?, preco_original = ?, descricao = ?, imagem = ?, estoque = ?, validade = ?, enviar_cozinha = ?, visivel = ?, em_promocao = ?, unidade = ?, preco_custo = ? WHERE id = ?', [nome, categoria, valPreco, valPrecoOriginal, descricao, imagem, estoque, dataValidade, envCozinha, isVisivel, emPromocao, und, custo, req.params.id]);
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu', isAdmin, async (req, res) => {
  const { nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao, unidade, preco_custo } = req.body;
  
  const valPreco = parseFloat(preco) || 0;
  const valPrecoOriginal = parseFloat(preco_original) || 0;
  const custo = parseFloat(preco_custo) || 0;
  
  if (valPreco < 0 || valPrecoOriginal < 0 || custo < 0) {
    return res.status(400).json({ error: 'Preço, preço original ou custo não podem ser negativos.' });
  }

  const envCozinha = enviar_cozinha !== undefined ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : null;
  const isVisivel = visivel !== undefined ? (isPostgres ? visivel : (visivel ? 1 : 0)) : (isPostgres ? true : 1);
  const emPromocao = em_promocao !== undefined ? (isPostgres ? em_promocao : (em_promocao ? 1 : 0)) : (isPostgres ? false : 0);
  const und = unidade || 'un';
  try {
    let newId = null;
    if (isPostgres) {
      const result = await query('INSERT INTO menu (nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao, unidade, preco_custo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [nome, categoria, valPreco, valPrecoOriginal, descricao, imagem, estoque || -1, validade || null, envCozinha, isVisivel, emPromocao, und, custo]);
      newId = result.rows && result.rows[0] ? result.rows[0].id : null;
    } else {
      const result = await query('INSERT INTO menu (nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao, unidade, preco_custo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [nome, categoria, valPreco, valPrecoOriginal, descricao, imagem, estoque || -1, validade || null, envCozinha, isVisivel, emPromocao, und, custo]);
      newId = result.lastInsertRowid || result.lastID || null;
    }
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true, id: newId });
  }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete('/api/menu/:id', isAdmin, async (req, res) => { try { await query('DELETE FROM menu WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (error) { res.status(500).json({ error: error.message }); } });

// ─── Ficha Técnica (Doses / Drinks) ─────────────────────────────────────────
app.get('/api/menu/:id/ficha-tecnica', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ficha = (await query(
      `SELECT ft.id, ft.ingrediente_id, ft.quantidade, ft.unidade,
              m.nome AS ingrediente_nome, m.estoque AS ingrediente_estoque, m.unidade AS ingrediente_unidade
       FROM ficha_tecnica ft
       JOIN menu m ON ft.ingrediente_id = m.id
       WHERE ft.menu_id = ?`,
      [id]
    )).rows;
    res.json(ficha);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/menu/:id/ficha-tecnica', isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { itens } = req.body; // Array de { ingrediente_id, quantidade, unidade }

    // Apaga a ficha atual e reinsere
    await query('DELETE FROM ficha_tecnica WHERE menu_id = ?', [id]);

    if (Array.isArray(itens) && itens.length > 0) {
      for (const item of itens) {
        const ingredienteId = parseInt(item.ingrediente_id);
        const quantidade = parseFloat(item.quantidade);
        const unidade = item.unidade || 'un';

        if (!ingredienteId || isNaN(quantidade) || quantidade <= 0) continue;
        await query(
          'INSERT INTO ficha_tecnica (menu_id, ingrediente_id, quantidade, unidade) VALUES (?, ?, ?, ?)',
          [id, ingredienteId, quantidade, unidade]
        );
      }
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.delete('/api/menu/categoria/:categoria', isAdmin, async (req, res) => {
  const { categoria } = req.params;
  try {
    // Usamos UPPER para garantir que pegue variações de caixa se houver (ex: Bebidas vs bebidas)
    await query('DELETE FROM menu WHERE UPPER(categoria) = UPPER(?)', [categoria]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/categoria/:categoria', isAdmin, async (req, res) => {
  const { categoria } = req.params;
  const { novoNome } = req.body;
  if (!novoNome) return res.status(400).json({ error: 'Novo nome é obrigatório' });
  const nomeLimpo = novoNome.trim();
  
  try {
    // 1. Atualiza todos os itens do cardápio que pertencem a esta categoria
    await query('UPDATE menu SET categoria = ? WHERE UPPER(categoria) = UPPER(?)', [nomeLimpo, categoria]);

    // 2. Sincroniza a configuração de categorias da cozinha (se existir)
    const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    if (configRes.rows.length > 0 && configRes.rows[0].valor) {
      let categoriasCozinha = JSON.parse(configRes.rows[0].valor);
      let alterouConfig = false;
      
      // Procura o nome antigo na lista (case-insensitive) e substitui pelo novo
      categoriasCozinha = categoriasCozinha.map(cat => {
        if (cat.toUpperCase() === categoria.toUpperCase()) {
          alterouConfig = true;
          return nomeLimpo;
        }
        return cat;
      });

      if (alterouConfig) {
        const novoValorConfig = JSON.stringify(categoriasCozinha);
        if (isPostgres) {
          await query("UPDATE sistema_config SET valor = ? WHERE chave = 'categorias_cozinha'", [novoValorConfig]);
        } else {
          await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?)", [novoValorConfig]);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao renomear categoria:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/garcons', ensureDbInitialized, isAuthenticated, async (req, res) => {
  try {
    const result = await query('SELECT id, nome, usuario, telefone, comissao, is_online FROM garcons ORDER BY nome');
    res.json(result.rows);
  } catch (error) { 
    console.error('❌ ERRO NA ROTA /api/garcons:', error);
    res.status(500).json({ error: error.message }); 
  }
});
app.post('/api/garcons', isAdmin, async (req, res) => { 
  try {
    const { nome, usuario, senha, telefone, comissao } = req.body; 
    const hashed = await bcrypt.hash(senha || '123', saltRounds); 
    await query('INSERT INTO garcons (nome, usuario, senha, telefone, comissao) VALUES (?, ?, ?, ?, ?)', [nome, usuario, hashed, telefone, comissao || 0]); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put('/api/garcons/:id', isAdmin, async (req, res) => {
  try {
    const { nome, usuario, senha, telefone, comissao } = req.body;
    if (senha) {
      const hashed = await bcrypt.hash(senha, saltRounds);
      await query('UPDATE garcons SET nome = ?, usuario = ?, senha = ?, telefone = ?, comissao = ? WHERE id = ?', [nome, usuario, hashed, telefone, comissao || 0, req.params.id]);
    } else {
      await query('UPDATE garcons SET nome = ?, usuario = ?, telefone = ?, comissao = ? WHERE id = ?', [nome, usuario, telefone, comissao || 0, req.params.id]);
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete('/api/garcons/:id', isAdmin, async (req, res) => { 
  try {
    const garcom = await query('SELECT usuario FROM garcons WHERE id = ?', [req.params.id]);
    if (garcom.rows && garcom.rows.length > 0) await query("UPDATE mesas SET status = 'livre', garcom_id = NULL WHERE garcom_id = ?", [garcom.rows[0].usuario]);
    await query('DELETE FROM garcons WHERE id = ?', [req.params.id]); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- ROTAS MODULARIZADAS (REFATORAÇÃO SOLID) ---
const mesasRouter = require('./routes/mesas')(query, ensureDbInitialized, safePusherTrigger, notifyStatus, checkAndNotifyDelayedOrders, isAdmin, isAuthenticated);
app.use('/api/mesas', mesasRouter);

app.get('/api/pedidos/mesa/:mesaId', async (req, res) => { 
  try {
    res.json((await query(`SELECT * FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY created_at DESC LIMIT 1`, [req.params.mesaId])).rows[0] || null); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// Cliente busca seus próprios pedidos ativos
app.post('/api/cliente/meus-pedidos', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });

  try {
    // 1. Valida o JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    if (decoded.role !== 'cliente') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const mesaId = decoded.mesa_id;
    const acessoId = decoded.acesso_id;
    const pedidoIdSessao = decoded.pedido_id; // ID do pedido vinculado no login

    // 2. Verifica se o código de acesso existe.
    // Buscamos o status e a data de criação para garantir isolamento entre sessões.
    const acesso = (await query("SELECT id, status, criado_at, mesa_id FROM codigos_acesso WHERE id = ?", [acessoId])).rows[0];
    if (!acesso) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

    // Busca status atual da mesa
    const mesaAtual = (await query("SELECT status FROM mesas WHERE id = ?", [mesaId])).rows[0];
    const mesaStatus = mesaAtual ? mesaAtual.status : 'livre';

    // 3. Busca todos os pedidos vinculados a esta mesa que ainda não foram finalizados (PAGOS)
    // Buscamos pedidos com status 'aberto' ou 'pendente', mas também incluímos pedidos 'entregues' 
    // que tenham sido criados após a geração do código de acesso para que o cliente veja seu histórico.
    const dateComparison = isPostgres 
      ? "created_at >= ?" 
      : "STRFTIME('%Y-%m-%d %H:%M:%S', created_at) >= STRFTIME('%Y-%m-%d %H:%M:%S', ?)";

    const pedidosSessao = (await query(`
      SELECT id, total, status, cobrar_taxa, desconto, acrescimo, solicitou_fechamento, fechamento_solicitado_em, fechamento_liberado 
      FROM pedidos 
      WHERE mesa_id = ? 
      AND (
        status NOT IN ('entregue', 'cancelado') -- Pedidos ativos na mesa (lançados pelo garçom ou cliente)
        OR 
        (status = 'entregue' AND ${dateComparison}) -- Pedidos já entregues nesta sessão
      )
      ORDER BY id ASC
    `, [mesaId, acesso.criado_at])).rows;

    if (pedidosSessao.length === 0) {
      return res.json({ success: true, pedido: null, itens: [] });
    }

    // 4. Busca todos os itens de todos os pedidos da sessão
    const pedidoIds = pedidosSessao.map(p => p.id);
    const placeholders = pedidoIds.map(() => '?').join(',');
    const itens = (await query(`
      SELECT pi.*, m.nome as menu_nome, m.imagem as menu_imagem, m.preco as menu_preco
      FROM pedido_itens pi
      JOIN menu m ON pi.menu_id = m.id
      WHERE pi.pedido_id IN (${placeholders})
      AND pi.status != 'cancelado'
      ORDER BY pi.id DESC
    `, pedidoIds)).rows;

    // 5. Consolida os dados e calcula o total real
    // Usamos o último pedido da lista para as flags de status (fechamento, etc)
    const ultimoPedido = pedidosSessao[pedidosSessao.length - 1];
    
    // 6. Verifica se há algum pedido ou item que ainda não foi confirmado pelo garçom
    // Um rascunho no banco (status 'rascunho') bloqueia novos envios do cliente.
    const temPendente = pedidosSessao.some(p => p.status === 'rascunho') || itens.some(i => i.status === 'rascunho');

    console.log(`[DEBUG] Mesa ${mesaId}: ${pedidosSessao.length} pedidos na sessão. temPendente=${temPendente}`);
    if (temPendente) {
      console.log(`[DEBUG] Pedidos rascunho:`, pedidosSessao.filter(p => p.status === 'rascunho').map(p => p.id));
    }

    let totalReal = 0;
    itens.forEach(i => {
      const preco = i.preco || i.menu_preco || 0;
      totalReal += (i.quantidade * preco);
    });

    // Aplica taxa de serviço (baseada na preferência do último pedido ou se algum deles cobrar)
    const cobrarTaxa = pedidosSessao.some(p => p.cobrar_taxa === 1 || p.cobrar_taxa === true);
    if (cobrarTaxa) {
      const taxaMultiplicador = await getTaxaServicoMultiplicador();
      totalReal = Math.round(totalReal * taxaMultiplicador * 100) / 100;
    }

    const pedidoConsolidado = {
      ...ultimoPedido,
      total: totalReal,
      cobrar_taxa: cobrarTaxa
    };

    res.json({
      success: true,
      pedido: pedidoConsolidado,
      itens,
      tem_pendente: temPendente,
      mesaStatus: mesaStatus
    });

  } catch (error) {
    console.error('❌ ERRO EM /api/cliente/meus-pedidos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const result = await query('SELECT id, usuario, senha FROM usuarios_admin WHERE usuario = ?', [usuario]);
    if (result.rows.length > 0 && await bcrypt.compare(senha, result.rows[0].senha)) { 
      const admin = result.rows[0];
      delete admin.senha;
      
      const token = jwt.sign({ id: admin.id, usuario: admin.usuario, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
      
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('admin_token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 2 // 2 horas
      });
      
      res.json({ success: true, admin, token }); 
    }
    else res.status(401).json({ error: 'Incorreto' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const result = await query('SELECT id, nome, usuario, senha FROM garcons WHERE usuario = ?', [usuario]);
    if (result.rows.length > 0 && await bcrypt.compare(senha, result.rows[0].senha)) { 
      const garcom = result.rows[0];
      delete garcom.senha;
      
      const token = jwt.sign({ id: garcom.id, nome: garcom.nome, usuario: garcom.usuario, role: 'garcom' }, JWT_SECRET, { expiresIn: '15d' });
      
      // Define garçom como ONLINE para o rodízio
      const agora = new Date().toISOString();
      await query("UPDATE garcons SET is_online = ?, last_assigned_at = ? WHERE id = ?", [isPostgres ? true : 1, agora, garcom.id]);
      
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('garcom_token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 16 // 16 horas
      });

      res.json({ success: true, garcom, token }); 
    }
    else res.status(401).json({ error: 'Incorreto' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/pusher-config', (req, res) => {
  res.json({
    key: (process.env.PUSHER_APP_KEY || "5b2b284e309dea9d90fb").trim(),
    cluster: (process.env.PUSHER_CLUSTER || "sa1").trim()
  });
});

app.post('/api/notify-admin', isAuthenticated, async (req, res) => {
  const { titulo, mensagem, message } = req.body;
  const msgContent = mensagem || message;
  if (!titulo || !msgContent) {
    return res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });
  }
  try {
    const formattedText = `🔔 *PAINEL ADM — ${titulo}*\n\n${msgContent}`;
    await sendWhatsAppMessage(formattedText);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- ROTAS DO CARDÁPIO DIGITAL (CLIENTE) ---

// Gera um novo código de acesso para uma mesa (Usado pelo Garçom/Admin)
app.post('/api/acesso/gerar', isAuthenticated, async (req, res) => {
  const { mesa_id } = req.body;
  console.log(`🔑 GERAR CÃ“DIGO: Mesa ID=${mesa_id}`);
  if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });
  
  try {
    // 1. Desativa códigos anteriores desta mesa
    const resDesativa = await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);
    console.log(`   - Desativados: ${resDesativa.changes}`);
    
    // 2. Gera código aleatório de 4 dígitos
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 4; i++) {
      codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    
    // 3. Insere o novo código
    const resInsert = await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
    console.log(`   - Novo código: ${codigo} (ID: ${resInsert.lastInsertRowid})`);
    
    // 4. Marca a mesa como ocupada e associa ao garçom que gerou o código
    const garcom_id = req.user ? (req.user.usuario || req.user.nome) : 'Sistema';
    
    const resUpdateMesa = await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
    console.log(`   - Status Mesa ${mesa_id} atualizado para 'ocupada' (Garçom: ${garcom_id}): ${resUpdateMesa.changes} linha(s) afetada(s)`);
    
    // Notifica via Pusher para atualizar as mesas de todos
    await safePusherTrigger('garconnexpress', 'status-atualizado', { 
      mesa_id, 
      status: 'ocupada',
      garcom_id: garcom_id,
      origem: 'codigo_gerado'
    });
    
    res.json({ success: true, codigo });
  } catch (error) {
    console.error(`❌ ERRO AO GERAR CÃ“DIGO:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Cancela o acesso de uma mesa (Cliente desistiu ou saiu antes de pedir)
app.post('/api/acesso/cancelar', isAuthenticated, async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });

  try {
    // 1. Invalida os códigos ativos da mesa
    await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);

    // 2. Libera a mesa no sistema
    await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);

    // 3. Notifica o cliente para deslogar (via Pusher)
    await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
      status: 'cancelado',
      mensagem: "Este acesso foi cancelado pelo garçom." 
    });

    // 4. Notifica todos os garçons/admin para atualizar o grid de mesas
    await safePusherTrigger('garconnexpress', 'status-atualizado', { 
      mesa_id, 
      status: 'liberada',
      origem: 'acesso_cancelado'
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acesso via QR Code (Abre a mesa automaticamente e atribui garçom por rodízio)
app.post('/api/acesso/qr', async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });

  try {
    const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardápio digital só funciona com o caixa aberto.' });

    const mesa = (await query("SELECT * FROM mesas WHERE id = ?", [mesa_id])).rows[0];
    if (!mesa) return res.status(404).json({ error: 'Mesa não encontrada' });

    // 2.5 BLOQUEIO: Se já existe um código ativo (gerado pelo garçom), impede o escaneamento direto
    const acessoExistente = (await query("SELECT id FROM codigos_acesso WHERE mesa_id = ? AND status = 'ativo'", [mesa_id])).rows[0];
    if (acessoExistente) {
        return res.status(400).json({ success: false, error: 'Esta mesa já possui um código ativo. Por favor, insira o código manualmente ou peça ao garçom.' });
    }

    let acesso;
    if (mesa.status === 'livre') {
      // LÃ“GICA DE RODÍZIO (Round-Robin): Pega o garçom online que está há mais tempo sem atender
      const proximoGarcom = (await query("SELECT id, usuario, nome FROM garcons WHERE is_online = ? ORDER BY last_assigned_at ASC LIMIT 1", [isPostgres ? true : 1])).rows[0];
      
      if (!proximoGarcom) {
        return res.status(503).json({ error: 'Nenhum garçom online no momento para te atender. Por favor, chame um atendente no balcão.' });
      }

      const garcom_id = proximoGarcom.usuario;
      const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let codigo = '';
      for (let i = 0; i < 4; i++) codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

      await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
      await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
      
      // Atualiza o timestamp para mover o garçom para o fim da fila
      await query("UPDATE garcons SET last_assigned_at = ? WHERE id = ?", [new Date().toISOString(), proximoGarcom.id]);

      acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON ca.mesa_id = m.id WHERE ca.mesa_id = ? AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1", [mesa_id])).rows[0];
      
      console.log(`🤖 [Rodízio] Mesa ${mesa.numero} atribuída a: ${proximoGarcom.nome}`);
      
      await safePusherTrigger('garconnexpress', 'status-atualizado', { 
        mesa_id, 
        status: 'ocupada',
        garcom_id: garcom_id,
        origem: 'qr_code'
      });
    } else {
      // TRAVA DE SEGURANÇA: Se a mesa não estiver livre, bloqueia o novo escaneamento
      return res.status(403).json({ 
        error: 'MESA OCUPADA: Esta mesa já possui um atendimento em andamento. Se você já estava nesta mesa, use o menu anterior ou peça ajuda ao garçom.' 
      });
    }

    const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [mesa_id])).rows[0];

    const token = jwt.sign({ 
      mesa_id: acesso.mesa_id, 
      mesa_numero: acesso.mesa_numero, 
      acesso_id: acesso.id,
      pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
      role: 'cliente' 
    }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ 
      success: true,
      mesa_id: acesso.mesa_id,
      mesa_numero: acesso.mesa_numero,
      token_acesso: token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Valida o acesso do cliente
app.post('/api/acesso/validar', async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: 'Código é obrigatório' });

  try {
    // 1. Verifica se o caixa está aberto
    const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardápio digital só funciona com o caixa aberto.' });

    // 2. Verifica se o código é válido e ativo
    const acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON ca.mesa_id = m.id WHERE UPPER(ca.codigo) = UPPER(?) AND ca.status = 'ativo'", [codigo])).rows[0];

    if (!acesso) return res.status(401).json({ error: 'Código inválido ou já expirado.' });

    // 3. Verificação de Segurança: A mesa está realmente ocupada?
    // Isso evita que códigos de sessões anteriores permitam acesso a mesas já liberadas.
    const mesaStatus = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
    
    if (!mesaStatus || mesaStatus.status === 'livre') {
      // Se a mesa está livre, o código deve ser invalidado por segurança (Ghost Session Prevention)
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [acesso.id]);
      return res.status(403).json({ error: 'ESTA MESA NÃO ESTÁ ATIVA: Peça ao garçom para abrir sua mesa novamente.' });
    }

    // 4. Busca pedido_id se existir (opcional nesta fase)
    const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [acesso.mesa_id])).rows[0];

    // 5. Gera o token de acesso (pedido_id pode ser null se for mesa recém aberta)
    const token = jwt.sign({ 
      mesa_id: acesso.mesa_id, 
      mesa_numero: acesso.mesa_numero, 
      acesso_id: acesso.id,
      pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
      role: 'cliente' 
    }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ 
      success: true,
      mesa_id: acesso.mesa_id,
      mesa_numero: acesso.mesa_numero,
      pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
      acesso_id: acesso.id,
      token_acesso: token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verifica se a sessão do cliente ainda é válida (código ainda ativo)
app.get('/api/acesso/check', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'cliente' || !decoded.acesso_id) {
        return res.status(403).json({ error: 'Token inválido para esta operação' });
    }

    const acesso = (await query("SELECT status, mesa_id FROM codigos_acesso WHERE id = ?", [decoded.acesso_id])).rows[0];
    if (!acesso || acesso.status !== 'ativo') {
        return res.json({ valid: false, error: 'Acesso expirado' });
    }

    // Verifica se a mesa ainda está ativa (ocupada ou em fechamento)
    const mesa = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
    if (!mesa || mesa.status === 'livre') {
        // Se a mesa foi liberada, invalida o acesso por segurança
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [decoded.acesso_id]);
        return res.json({ valid: false, error: 'Mesa liberada' });
    }

    res.json({ valid: true });
  } catch (err) {
    res.status(401).json({ error: 'Sessão expirada' });
  }
});
// Cliente solicita atendimento do garçom
app.post('/api/cliente/chamar-garcom', isAuthenticated, async (req, res) => {
  const mesa_id = req.user.role === 'cliente' ? req.user.mesa_id : req.body.mesa_id;
  const mesa_numero = req.user.role === 'cliente' ? req.user.mesa_numero : req.body.mesa_numero;
  try {
    await safePusherTrigger('garconnexpress', 'chamado-garcom', {
      mesa_id,
      mesa_numero,
      mensagem: `🛎️ MESA ${mesa_numero} solicitou atendimento!`
    });
    
    // Notifica via WhatsApp também se configurado
    await sendWhatsAppMessage(`🛎️ *CHAMADO DE MESA*\n📍 Mesa: ${mesa_numero}\n🙋‍♂️ O cliente solicitou atendimento imediato.`).catch(e => console.error('Erro Wpp Chamado:', e.message));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cliente envia rascunho do pedido (pré-seleção)
app.post('/api/cliente/enviar-rascunho', isAuthenticated, async (req, res) => {
  const { itens } = req.body;
  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: 'Carrinho vazio. Adicione pelo menos um item.' });
  }

  const mesa_id = req.user.role === 'cliente' ? req.user.mesa_id : req.body.mesa_id;
  const mesa_numero = req.user.role === 'cliente' ? req.user.mesa_numero : req.body.mesa_numero;
  try {
    // BLOQUEIO DEFINITIVO: Verifica status real da mesa
    if (mesa_id) {
      const mesaObj = (await query("SELECT status FROM mesas WHERE id = ?", [mesa_id])).rows[0];
      if (mesaObj && (mesaObj.status === 'fechando' || mesaObj.status === 'aguardando_fechamento')) {
        return res.status(403).json({ 
          error: 'CONTA_SOLICITADA',
          mensagem: 'Você já solicitou o fechamento da conta para esta mesa. Se deseja pedir novos itens, por favor, chame o garçom.' 
        });
      }
    }

    // TRAVA DE SEGURANÇA BACKEND: Verifica se já existe rascunho no Banco de Dados
    const pendentes = await query(`
      SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'
    `, [mesa_id]);

    if (pendentes.rows.length > 0) {
      return res.status(403).json({ 
        error: 'PENDENTE', 
        mensagem: 'Ops! Você já enviou um pedido que está aguardando a confirmação do garçom. Por favor, aguarde ele confirmar este primeiro pedido para poder enviar novos itens. Obrigado pela paciência!' 
      });
    }

    // Cria um registro de pedido temporário (rascunho) no banco para bloquear novos envios
    let pedidoRascunhoId;
    const agora = new Date().toISOString();
    if (isPostgres) {
      const resR = await query('INSERT INTO pedidos (mesa_id, total, status, created_at, observacao) VALUES (?, ?, ?, ?, ?) RETURNING id', 
        [mesa_id, 0, 'rascunho', agora, 'RASCUNHO CLIENTE']);
      pedidoRascunhoId = resR.rows[0].id;
    } else {
      const resR = await query('INSERT INTO pedidos (mesa_id, total, status, created_at, observacao) VALUES (?, ?, ?, ?, ?)', 
        [mesa_id, 0, 'rascunho', agora, 'RASCUNHO CLIENTE']);
      pedidoRascunhoId = resR.lastInsertRowid;
    }

    // Insere os itens do rascunho para que o cliente possa vê-los em "Meus Pedidos"
    if (itens.length > 0) {
      const placeholders = itens.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const values = [];
      for (const item of itens) {
        values.push(pedidoRascunhoId, item.menu_id, item.quantidade, '', 'rascunho');
      }
      await query(`INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES ${placeholders}`, values);
    }

    const itensFormatados = itens.map(i => `${i.quantidade}x ${i.nome}`).join('\n');
    const msg = `📝 RASCUNHO RECEBIDO - MESA ${mesa_numero}\n${itensFormatados}`;

    await safePusherTrigger('garconnexpress', 'rascunho-recebido', {
      mesa_id,
      mesa_numero,
      itens,
      pedido_id: pedidoRascunhoId,
      mensagem: msg
    });

    // Notifica via WhatsApp também
    await sendWhatsAppMessage(`📝 *RASCUNHO DE PEDIDO*\n📍 Mesa: ${mesa_numero}\n\n${itensFormatados}\n\n⚠️ _Aguardando confirmação do garçom._`).catch(e => console.error('Erro Wpp Rascunho:', e.message));

    res.json({ success: true, pedido_id: pedidoRascunhoId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/whatsapp-status', isAuthenticated, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
    const isEnabled = configRes.rows && configRes.rows.length > 0 ? configRes.rows[0].valor === 'true' : true;

    // Só mostra o número para admins
    let numbersDisplay = 'Configurado';
    if (req.user && req.user.role === 'admin') {
      const configNums = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_notify_numbers'");
      if (configNums.rows && configNums.rows.length > 0 && configNums.rows[0].valor) {
        numbersDisplay = configNums.rows[0].valor;
      } else if (process.env.WHATSAPP_NOTIFY_NUMBER) {
        numbersDisplay = process.env.WHATSAPP_NOTIFY_NUMBER;
      } else {
        numbersDisplay = 'Não configurado';
      }
    }

    let currentRealStatus = whatsappRealStatus;
    let isSocketConnected = whatsappSocket ? whatsappSocket.connected : false;
    
    // Tenta buscar o status síncrono diretamente da API do robô para evitar falso-desconectado em cold-starts do Vercel
    if (botUrlFinal) {
      try {
        const fetchStatusUrl = botUrlFinal.endsWith('/') ? `${botUrlFinal}status` : `${botUrlFinal}/status`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const syncRes = await fetch(fetchStatusUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (syncRes.ok) {
          const syncData = await syncRes.json();
          if (syncData && syncData.status) {
            currentRealStatus = syncData.status;
            isSocketConnected = true;
          }
        }
      } catch (err) {
        console.warn('⚠️ Falha ao buscar status síncrono do robô, usando fallback de memória:', err.message);
      }
    }

    const botSecret = process.env.BOT_SECRET || process.env.JWT_SECRET || 'seusegredomuitolouco123';
    res.json({
      configured: !!botUrlFinal,
      connected: isSocketConnected,
      realStatus: currentRealStatus,
      enabled: isEnabled,
      number: numbersDisplay,
      // botUrl só retorna para admins (com o token anexado)
      ...(req.user && req.user.role === 'admin' ? { 
        botUrl: botUrlFinal ? `${botUrlFinal}${botUrlFinal.includes('?') ? '&' : '?'}token=${botSecret}` : '' 
      } : {})
    });
  } catch (error) {
    console.error('❌ Erro ao buscar status do WhatsApp:', error.message);
    res.json({
      configured: !!botUrlFinal,
      connected: false,
      enabled: false,
      number: 'Erro ao carregar',
      error: error.message
    });
  }
});

app.post('/api/whatsapp-toggle', isAdmin, async (req, res) => {
  const { enabled } = req.body;
  try {
    await query("UPDATE sistema_config SET valor = ? WHERE chave = 'whatsapp_enabled'", [enabled ? 'true' : 'false']);
    res.json({ success: true, enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/whatsapp-number', isAdmin, async (req, res) => {
  const { number } = req.body;
  try {
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [number]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?)", [number]);
    }

    if (whatsappSocket && whatsappSocket.connected && number) {
      const numbersList = number.split(',').map(n => n.trim().replace(/\D/g, '') + '@s.whatsapp.net');
      numbersList.forEach(jid => {
        whatsappSocket.emit('rename_chat', { jid, name: 'Notificações Meu zap 🔔' });
      });
    }

    res.json({ success: true, number });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/categorias-cozinha', async (req, res) => {
  try {
    const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    res.json(config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : []);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/categorias-cozinha', isAdmin, async (req, res) => {
  const { categorias } = req.body;
  try {
    const valor = JSON.stringify(categorias);
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?)", [valor]);
    }
    
    // SINCRONIZAÇÃO COMPLETA: 
    // Define todos os itens como NULL para que passem a seguir a nova regra de categorias global.
    // Isso garante que o "Salvar" da configuração realmente aplique a mudança em todo o cardápio.
    // Marcações manuais anteriores serão resetadas para seguir a nova configuração global.
    await query(`UPDATE menu SET enviar_cozinha = NULL`);

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/config/versao-app', ensureDbInitialized, async (req, res) => {
  try {
    const configRows = (await query("SELECT chave, valor FROM sistema_config WHERE chave IN (" +
      "'config_web_version', " +
      "'config_garcom_apk_version', 'config_garcom_apk_url', " +
      "'config_cozinha_apk_version', 'config_cozinha_apk_url', " +
      "'config_motoboy_apk_version', 'config_motoboy_apk_url'" +
      ")")).rows;
    const configMap = {};
    for (const r of configRows) {
      configMap[r.chave] = r.valor;
    }
    res.json({
      success: true,
      web_version: configMap['config_web_version'] || '1.0.0',
      garcom_apk_version: configMap['config_garcom_apk_version'] || '2.0.0',
      garcom_apk_url: configMap['config_garcom_apk_url'] || '/garcom-v1.1.0-portrait.apk',
      cozinha_apk_version: configMap['config_cozinha_apk_version'] || '2.0.0',
      cozinha_apk_url: configMap['config_cozinha_apk_url'] || '/cozinha-v1.1.0-portrait.apk',
      motoboy_apk_version: configMap['config_motoboy_apk_version'] || '2.0.0',
      motoboy_apk_url: configMap['config_motoboy_apk_url'] || '/motoboy-v2.0.0-portrait.apk'
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/versao-app', ensureDbInitialized, isAdmin, async (req, res) => {
  const {
    web_version,
    garcom_apk_version, garcom_apk_url,
    cozinha_apk_version, cozinha_apk_url,
    motoboy_apk_version, motoboy_apk_url
  } = req.body;
  try {
    const configs = [
      { chave: 'config_web_version', valor: web_version || '1.0.0' },
      { chave: 'config_garcom_apk_version', valor: garcom_apk_version || '2.0.0' },
      { chave: 'config_garcom_apk_url', valor: garcom_apk_url || '/garcom-v1.1.0-portrait.apk' },
      { chave: 'config_cozinha_apk_version', valor: cozinha_apk_version || '2.0.0' },
      { chave: 'config_cozinha_apk_url', valor: cozinha_apk_url || '/cozinha-v1.1.0-portrait.apk' },
      { chave: 'config_motoboy_apk_version', valor: motoboy_apk_version || '2.0.0' },
      { chave: 'config_motoboy_apk_url', valor: motoboy_apk_url || '/motoboy-v2.0.0-portrait.apk' }
    ];
    for (const cfg of configs) {
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [cfg.chave, cfg.valor]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [cfg.chave, cfg.valor]);
      }
    }
    if (typeof safePusherTrigger !== 'undefined') {
      await safePusherTrigger('garconnexpress', 'versao-app-atualizada', {
        web_version: web_version || '1.0.0',
        garcom_apk_version: garcom_apk_version || '2.0.0',
        garcom_apk_url: garcom_apk_url || '/garcom-v1.1.0-portrait.apk',
        cozinha_apk_version: cozinha_apk_version || '2.0.0',
        cozinha_apk_url: cozinha_apk_url || '/cozinha-v1.1.0-portrait.apk',
        motoboy_apk_version: motoboy_apk_version || '2.0.0',
        motoboy_apk_url: motoboy_apk_url || '/motoboy-v2.0.0-portrait.apk'
      });
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/upload-apk', express.raw({ type: 'application/octet-stream', limit: '150mb' }), ensureDbInitialized, isAdmin, async (req, res) => {
  const filename = req.query.filename;
  if (!filename || !filename.endsWith('.apk')) {
    return res.status(400).json({ success: false, error: 'Arquivo inválido ou nome ausente.' });
  }
  try {
    const fs = require('fs');
    const path = require('path');
    let filePath = path.join(__dirname, filename);
    
    try {
      // 1. Tenta gravar localmente primeiro (VPS ou Dev)
      fs.writeFileSync(filePath, req.body);
      console.log(`✅ Novo APK gravado com sucesso no disco local: ${filePath}`);
    } catch (writeErr) {
      // 2. Fallback para /tmp (Vercel Serverless Read-Only filesystem)
      if (writeErr.code === 'EROFS' || writeErr.message.includes('read-only')) {
        filePath = path.join('/tmp', filename);
        fs.writeFileSync(filePath, req.body);
        console.log(`✅ Novo APK gravado com sucesso no diretório temporário /tmp: ${filePath}`);
      } else {
        throw writeErr;
      }
    }

    res.json({
      success: true,
      url: `/${filename}`
    });
  } catch (error) {
    console.error('❌ Erro no upload do APK:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



app.get('/api/config/som-global', ensureDbInitialized, async (req, res) => {
  try {
    const configRows = (await query("SELECT chave, valor FROM sistema_config WHERE chave IN ('config_som_garcom', 'config_som_cozinha', 'config_som_admin', 'config_som_motoboy')")).rows;
    const configMap = {};
    for (const r of configRows) {
      configMap[r.chave] = r.valor;
    }
    res.json({
      success: true,
      somGarcom: configMap['config_som_garcom'] || 'campainha_classica',
      somCozinha: configMap['config_som_cozinha'] || 'sino_moderno',
      somAdmin: configMap['config_som_admin'] || 'alerta_digital',
      somMotoboy: configMap['config_som_motoboy'] || 'campainha_classica'
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/som-global', ensureDbInitialized, isAdmin, async (req, res) => {
  const { somGarcom, somCozinha, somAdmin, somMotoboy } = req.body;
  try {
    const configs = [
      { chave: 'config_som_garcom', valor: somGarcom || 'campainha_classica' },
      { chave: 'config_som_cozinha', valor: somCozinha || 'sino_moderno' },
      { chave: 'config_som_admin', valor: somAdmin || 'alerta_digital' },
      { chave: 'config_som_motoboy', valor: somMotoboy || 'campainha_classica' }
    ];
    for (const cfg of configs) {
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [cfg.chave, cfg.valor]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [cfg.chave, cfg.valor]);
      }
    }
    if (typeof safePusherTrigger !== 'undefined') {
      await safePusherTrigger('garconnexpress', 'som-global-atualizado', {
        somGarcom: somGarcom || 'campainha_classica',
        somCozinha: somCozinha || 'sino_moderno',
        somAdmin: somAdmin || 'alerta_digital',
        somMotoboy: somMotoboy || 'campainha_classica'
      });
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── ROTAS FCM (BLINDADAS PARA VERCEL) ───────────────────────────────────────

const FCM_DEFAULTS = [
  { evento: 'novo-pedido', tituloPadrao: 'GarçomExpress', corpoPadrao: '🍕 Novo pedido #{pedido_id} recebido da {mesa}! 📋', destinatario: 'garcom', variaveis: ['mesa', 'itens', 'pedido_id'] },
  { evento: 'item-adicionado', tituloPadrao: 'GarçomExpress', corpoPadrao: '➕ Novos itens adicionados no pedido #{pedido_id} ({mesa})!', destinatario: 'garcom', variaveis: ['mesa', 'item', 'qtd', 'pedido_id'] },
  { evento: 'pedido-cancelado', tituloPadrao: 'CozinhaExpress', corpoPadrao: '❌ Atenção: O pedido #{pedido_id} ({mesa}) foi cancelado!', destinatario: 'cozinha', variaveis: ['mesa', 'item', 'pedido_id'] },
  { evento: 'chamado-garcom', tituloPadrao: 'GarçomExpress', corpoPadrao: '🛎️ Chamado de atendimento na {mesa}! Atenda o cliente.', destinatario: 'garcom', variaveis: ['mesa'] },
  { evento: 'pedido-pronto', tituloPadrao: 'GarçomExpress', corpoPadrao: '🍳 O pedido #{pedido_id} ({mesa}) está pronto para servir!', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'solicitacao-fechamento-cliente', tituloPadrao: 'GarçomExpress', corpoPadrao: '💰 A {mesa} solicitou o fechamento da conta do pedido #{pedido_id}.', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'status-caixa-atualizado', tituloPadrao: '💰 CAIXA', corpoPadrao: '{status}', destinatario: 'todos', variaveis: ['status'] },
  { evento: 'rascunho-recebido', tituloPadrao: 'GarçomExpress', corpoPadrao: '📝 Novo rascunho de pedido #{pedido_id} pendente na {mesa}.', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'mesa-liberada', tituloPadrao: 'GarçomExpress', corpoPadrao: '🔓 Mesa {mesa} foi liberada com sucesso!', destinatario: 'garcom', variaveis: ['mesa'] },
  { evento: 'saiu-entrega', tituloPadrao: 'Delivery Express', corpoPadrao: '🛵 O pedido #{pedido_id} ({mesa}) saiu para entrega!', destinatario: 'motoboy', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-entregue', tituloPadrao: 'Delivery Express', corpoPadrao: '✅ O pedido #{pedido_id} ({mesa}) foi entregue com sucesso!', destinatario: 'motoboy', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-servido', tituloPadrao: 'GarçomExpress', corpoPadrao: '🍽️ O pedido #{pedido_id} ({mesa}) foi servido/entregue!', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'fechamento-atrasado', tituloPadrao: '⚠️ CAIXA: FECHAMENTO ATRASADO!', corpoPadrao: 'O fechamento da {mesa} foi solicitado há mais de 5 minutos e ainda não foi concluído!', destinatario: 'garcom', variaveis: ['mesa'] },
  { evento: 'pedido-atrasado-motoboy', tituloPadrao: '🔥 MOTOBOY: ENTREGA ATRASADA!', corpoPadrao: 'O pedido de entrega #{pedido_id} está parado há mais de 10 minutos!', destinatario: 'motoboy', variaveis: ['pedido_id'] },
  { evento: 'pedido-atrasado-garcom', tituloPadrao: '🔥 GARÇOM: PEDIDO ATRASADO!', corpoPadrao: 'O pedido da {mesa} (#{pedido_id}) está parado há mais de 10 minutos!', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-atrasado-cozinha', tituloPadrao: '🔥 COZINHA: PEDIDO ATRASADO!', corpoPadrao: 'O pedido #{pedido_id} ({mesa}) está aguardando há mais de 10 minutos!', destinatario: 'cozinha', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'estoque-baixo', tituloPadrao: '⚠️ ESTOQUE BAIXO', corpoPadrao: 'Alerta de estoque baixo para {item}: restam apenas {qtd} un.!', destinatario: 'garcom', variaveis: ['item', 'qtd'] }
];

app.get('/api/debug-fcm', isAdmin, async (req, res) => {
  try {
    const initializedApps = admin.apps.map(a => ({
      name: a.name || 'default',
      options: a.options ? {
        projectId: a.options.projectId || 'N/A'
      } : null
    }));

    const getProjId = (envVar) => {
      try {
        if (!process.env[envVar]) return 'NOT SET';
        const parsed = JSON.parse(process.env[envVar]);
        return parsed.project_id || 'NO_PROJECT_ID_FIELD';
      } catch (e) {
        return 'PARSE_ERROR: ' + e.message;
      }
    };

    const envKeys = {
      FIREBASE_SERVICE_ACCOUNT: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      FIREBASE_SERVICE_ACCOUNT_MOTOBOY: !!process.env.FIREBASE_SERVICE_ACCOUNT_MOTOBOY,
      FIREBASE_SERVICE_ACCOUNT_COZINHA: !!process.env.FIREBASE_SERVICE_ACCOUNT_COZINHA
    };

    const parsedProjectIds = {
      garcom: getProjId('FIREBASE_SERVICE_ACCOUNT'),
      motoboy: getProjId('FIREBASE_SERVICE_ACCOUNT_MOTOBOY'),
      cozinha: getProjId('FIREBASE_SERVICE_ACCOUNT_COZINHA')
    };

    let localFiles = {
      garcom: false,
      motoboy: false,
      cozinha: false
    };

    const fs = require('fs');
    if (fs.existsSync('./firebase-adminsdk.json')) localFiles.garcom = true;
    if (fs.existsSync('./firebase-adminsdk-motoboy.json')) localFiles.motoboy = true;
    if (fs.existsSync('./firebase-adminsdk-cozinha.json')) localFiles.cozinha = true;

    // Busca configurações de som no banco
    const dbConfigs = {};
    try {
      const result = await query("SELECT chave, valor FROM sistema_config WHERE chave IN ('config_som_motoboy', 'config_som_garcom', 'config_som_cozinha')");
      for (const row of result.rows) {
        dbConfigs[row.chave] = row.valor;
      }
    } catch (e) {
      dbConfigs.error = e.message;
    }

    // Busca subscriptions de push
    const subscriptions = {};
    try {
      const result = await query("SELECT id, garcom_id, app_type, length(endpoint) as token_len FROM push_subscriptions");
      subscriptions.rows = result.rows;
      subscriptions.count = result.rows.length;
    } catch (e) {
      subscriptions.error = e.message;
    }

    res.json({
      success: true,
      initializedApps,
      envKeys,
      parsedProjectIds,
      dbConfigs,
      subscriptions,
      localFiles
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/fcm/teste-motoboy-som', async (req, res) => {
  try {
    const configRes = await query("SELECT chave, valor FROM sistema_config");
    const configMap = {};
    configRes.rows.forEach(row => {
      configMap[row.chave] = row.valor;
    });

    const activeSound = configMap['config_som_motoboy'] || 'campainha_classica';
    const channelName = 'motoboy_canal_' + activeSound + '_v2';

    let fcmSoundFile = activeSound;
    if (fcmSoundFile === 'original') fcmSoundFile = 'notificacao';

    const androidNotification = { 
      channelId: channelName, 
      defaultSound: activeSound === 'original',
      notificationPriority: 'PRIORITY_MAX'
    };
    if (activeSound !== 'mudo') {
      androidNotification.sound = fcmSoundFile;
    }

    const messagePayload = { 
      notification: { 
        title: "🚨 TESTE DE SOM MOTOBOY", 
        body: `Som configurado: ${activeSound} (Canal: ${channelName})` 
      }, 
      data: { 
        event: 'teste-fcm', 
        sound: activeSound !== 'mudo' ? fcmSoundFile : '' 
      }, 
      android: { 
        priority: 'high', 
        notification: androidNotification 
      },
      apns: {
        payload: {
          aps: {
            sound: activeSound !== 'mudo' ? (activeSound === 'original' ? 'notificacao.caf' : activeSound + '.caf') : '',
            badge: 1
          }
        }
      }
    };

    const subs = (await query("SELECT * FROM push_subscriptions WHERE app_type = 'motoboy'")).rows;
    const results = [];

    let firebaseApp = admin;
    if (admin.apps.find(a => a.name === 'motoboy')) {
      firebaseApp = admin.app('motoboy');
    }

    for (const sub of subs) {
      const message = {
        ...messagePayload,
        token: sub.endpoint
      };

      try {
        const response = await firebaseApp.messaging().send(message);
        results.push({ id: sub.id, success: true, response });
      } catch (err) {
        results.push({ id: sub.id, success: false, error: err.message, code: err.code });
      }
    }

    res.json({
      success: true,
      activeSound,
      channelName,
      messagePayload,
      results
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/fcm-config/listar', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const configData = (await query("SELECT chave, valor FROM sistema_config WHERE chave LIKE 'fcm_%'")).rows;
    const configMap = {};
    for (const r of configData) configMap[r.chave] = r.valor;

    const sistema = FCM_DEFAULTS.map(d => ({
      ...d,
      titulo: configMap[`fcm_title_${d.evento}`] || null,
      corpo: configMap[`fcm_body_${d.evento}`] || null,
      som: configMap[`fcm_sound_${d.evento}`] !== 'false'
    }));

    const customizados = configMap['fcm_custom_events'] ? JSON.parse(configMap['fcm_custom_events']) : [];
    res.json({ success: true, sistema, customizados });
  } catch (error) { 
    res.json({ success: false, error: 'Falha ao buscar dados no banco', detalhes: error.message }); 
  }
});

app.post('/api/fcm-config/salvar-sistema', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const { templates } = req.body;
    if (!templates || !Array.isArray(templates)) return res.json({ success: false, error: 'Templates inválidos' });
    
    for (const t of templates) {
      if (t.restaurar) {
        await query("DELETE FROM sistema_config WHERE chave = $1 OR chave = $2 OR chave = $3", [`fcm_title_${t.evento}`, `fcm_body_${t.evento}`, `fcm_sound_${t.evento}`]);
      } else {
        const soundVal = t.som !== false ? 'true' : 'false';
        if (isPostgres) {
          await query("INSERT INTO sistema_config (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [`fcm_title_${t.evento}`, t.titulo]);
          await query("INSERT INTO sistema_config (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [`fcm_body_${t.evento}`, t.corpo]);
          await query("INSERT INTO sistema_config (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [`fcm_sound_${t.evento}`, soundVal]);
        } else {
          await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [`fcm_title_${t.evento}`, t.titulo]);
          await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [`fcm_body_${t.evento}`, t.corpo]);
          await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [`fcm_sound_${t.evento}`, soundVal]);
        }
      }
    }
    res.json({ success: true });
  } catch (error) { 
    res.json({ success: false, error: 'Erro ao salvar configurações do sistema', detalhes: error.message }); 
  }
});

app.post('/api/fcm-config/salvar-custom', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const { id, nome, titulo, corpo, destinatario, ativo, deletar, agendadoPara, recorrente, frequencia, diasSemana } = req.body;
    const r = (await query("SELECT valor FROM sistema_config WHERE chave = 'fcm_custom_events'")).rows;
    let lista = r && r[0] && r[0].valor ? JSON.parse(r[0].valor) : [];
    
    if (deletar) {
      lista = lista.filter(e => e.id !== id);
    } else {
      if (!nome || !titulo || !corpo) return res.json({ success: false, error: 'Preencha nome, título e corpo' });
      const eventId = id || Date.now().toString(36);
      const idx = lista.findIndex(e => e.id === eventId);
      
      const evento = { 
        id: eventId, 
        nome, 
        titulo, 
        corpo, 
        destinatario: destinatario || 'garcom', 
        ativo: ativo !== false, 
        criadoEm: idx >= 0 ? lista[idx].criadoEm : new Date().toISOString(),
        agendadoPara: agendadoPara || null,
        recorrente: recorrente === true || recorrente === 'true',
        frequencia: frequencia || 'diaria',
        diasSemana: Array.isArray(diasSemana) ? diasSemana : [],
        ultimoDisparo: idx >= 0 ? (lista[idx].ultimoDisparo || null) : null
      };

      if (idx >= 0) {
        const anterior = lista[idx];
        if (anterior.agendadoPara !== agendadoPara || anterior.recorrente !== recorrente || JSON.stringify(anterior.diasSemana) !== JSON.stringify(diasSemana)) {
          evento.enviado = false;
          evento.disparadoEm = null;
          evento.alcanceTotal = null;
          evento.ultimoDisparo = null;
        } else {
          evento.enviado = anterior.enviado;
          evento.disparadoEm = anterior.disparadoEm;
          evento.alcanceTotal = anterior.alcanceTotal;
          evento.ultimoDisparo = anterior.ultimoDisparo || null;
        }
        lista[idx] = evento;
      } else {
        lista.push(evento);
      }
    }

    const valor = JSON.stringify(lista);
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('fcm_custom_events', $1) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('fcm_custom_events', ?)", [valor]);
    }
    res.json({ success: true });
  } catch (error) { 
    res.json({ success: false, error: 'Erro ao gerenciar evento customizado', detalhes: error.message }); 
  }
});

app.post('/api/fcm-config/testar', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const { titulo, corpo, destinatario } = req.body;
    if (!titulo || !corpo || !destinatario) return res.json({ success: false, error: 'Campos em branco para teste' });
    
    const configRes = await query("SELECT chave, valor FROM sistema_config");
    const configMap = {};
    configRes.rows.forEach(row => {
      configMap[row.chave] = row.valor;
    });

    const subs = (await query("SELECT * FROM push_subscriptions WHERE app_type = ?", [destinatario])).rows;
    let enviados = 0;
    const sentEndpoints = new Set();
    
    for (const sub of subs) {
      if (sentEndpoints.has(sub.endpoint)) {
        console.log(`⚠️ Ignorando token duplicado no envio de teste: ${sub.endpoint}`);
        continue;
      }
      sentEndpoints.add(sub.endpoint);

      const isNativeSub = sub.is_native === 1 || sub.is_native === true || (!sub.endpoint.startsWith('https://') && !sub.endpoint.includes('fcm.googleapis.com'));
      if (isNativeSub && admin.apps.length > 0) {
        let activeSound = 'notificacao';
        let channelName = 'pedidos';
        if (destinatario === 'garcom') {
          activeSound = configMap['config_som_garcom'] || 'campainha_classica';
          channelName = 'garcom_canal_' + activeSound + '_v2';
        } else if (destinatario === 'cozinha') {
          activeSound = configMap['config_som_cozinha'] || 'sino_moderno';
          channelName = 'cozinha_canal_' + activeSound + '_v2';
        } else if (destinatario === 'motoboy') {
          activeSound = configMap['config_som_motoboy'] || 'campainha_classica';
          channelName = 'motoboy_canal_' + activeSound + '_v2';
        }


        let fcmSoundFile = activeSound;
        if (fcmSoundFile === 'original') fcmSoundFile = 'notificacao';

        let androidNotification = { 
          channelId: channelName, 
          defaultSound: activeSound === 'original',
          notificationPriority: 'PRIORITY_MAX'
        };
        if (activeSound !== 'mudo') {
          androidNotification.sound = fcmSoundFile;
        }

        const message = { 
          notification: { title: titulo, body: corpo }, 
          data: { event: 'teste-fcm', sound: activeSound !== 'mudo' ? fcmSoundFile : '' }, 
          android: { 
            priority: 'high', 
            notification: androidNotification 
          },
          apns: {
            payload: {
              aps: {
                sound: activeSound !== 'mudo' ? (activeSound === 'original' ? 'notificacao.caf' : activeSound + '.caf') : '',
                badge: 1
              }
            }
          },
          token: sub.endpoint 
        };
        let firebaseApp = admin;
        if (destinatario === 'motoboy' && admin.apps.find(a => a.name === 'motoboy')) firebaseApp = admin.app('motoboy');
        else if (destinatario === 'cozinha' && admin.apps.find(a => a.name === 'cozinha')) firebaseApp = admin.app('cozinha');
        
        await firebaseApp.messaging().send(message)
          .then(() => { enviados++; })
          .catch(async (err) => {
            console.error('FCM Erro:', err.message);
            if (err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/registration-token-not-registered' || err.message.includes('Requested entity was not found')) {
              console.log('🗑️ Removendo token FCM inativo:', sub.endpoint);
              await query("DELETE FROM push_subscriptions WHERE id = ?", [sub.id]);
            }
          });
      }
    }
    res.json({ success: true, enviados, total: sentEndpoints.size });
  } catch (error) { 
    res.json({ success: false, error: 'Falha no disparo do teste', detalhes: error.message }); 
  }
});


// --- CONFIGURAÇÃO DE TOASTS/POPUPS DO APLICATIVO ---
const TOAST_DEFAULTS = [
  { evento: 'novo-pedido', textoPadrao: '🍕 Novo pedido #{pedido_id} recebido da {mesa}! 📋', label: 'Novo Pedido', tipo: 'info', variaveis: ['mesa', 'cliente', 'itens', 'pedido_id'] },
  { evento: 'chamado-garcom', textoPadrao: '🛎️ Chamado de atendimento na {mesa}! Atenda o cliente.', label: 'Chamado de Garçom', tipo: 'erro', variaveis: ['mesa'] },
  { evento: 'pedido-pronto', textoPadrao: '🍳 O pedido #{pedido_id} ({mesa}) está pronto para servir!', label: 'Pedido Pronto', tipo: 'sucesso', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-cancelado', textoPadrao: '❌ Atenção: O pedido #{pedido_id} ({mesa}) foi cancelado!', label: 'Pedido Cancelado', tipo: 'erro', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'solicitacao-fechamento-cliente', textoPadrao: '💰 A {mesa} solicitou o fechamento da conta do pedido #{pedido_id}.', label: 'Solicitação de Conta', tipo: 'sucesso', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'status-caixa-atualizado', textoPadrao: '💼 Status do caixa: {status}', label: 'Status do Caixa', tipo: 'info', variaveis: ['status'] },
  { evento: 'item-adicionado', textoPadrao: '➕ Novos itens adicionados no pedido #{pedido_id} ({mesa})!', label: 'Itens Adicionados', tipo: 'info', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'mesa-liberada', textoPadrao: '🔓 Mesa {mesa} foi liberada com sucesso!', label: 'Mesa Liberada', tipo: 'sucesso', variaveis: ['mesa'] },
  { evento: 'saiu-entrega', textoPadrao: '🛵 O pedido #{pedido_id} ({mesa}) saiu para entrega!', label: 'Saiu para Entrega', tipo: 'info', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-entregue', textoPadrao: '✅ O pedido #{pedido_id} ({mesa}) foi entregue com sucesso!', label: 'Pedido Concluído', tipo: 'sucesso', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'estoque-baixo', textoPadrao: '⚠️ Alerta de Estoque Baixo: {mensagem}', label: 'Estoque Baixo', tipo: 'erro', variaveis: ['mensagem'] },
  { evento: 'fechamento-atrasado', textoPadrao: '⚠️ CAIXA: FECHAMENTO ATRASADO! O fechamento da {mesa} foi solicitado há mais de 5 minutos.', label: 'Caixa: Fechamento Atrasado', tipo: 'erro', variaveis: ['mesa'] },
  { evento: 'pedido-atrasado-garcom', textoPadrao: '🔥 GARÇOM: PEDIDO ATRASADO! O pedido da {mesa} (#{pedido_id}) está parado há mais de 10 minutos!', label: 'Pedido Atrasado (Garçom)', tipo: 'erro', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-atrasado-cozinha', textoPadrao: '🔥 COZINHA: PEDIDO ATRASADO! O pedido #{pedido_id} ({mesa}) está aguardando há mais de 10 minutos!', label: 'Pedido Atrasado (Cozinha)', tipo: 'erro', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-atrasado-motoboy', textoPadrao: '🔥 MOTOBOY: ENTREGA ATRASADA! O pedido #{pedido_id} está parado há mais de 10 minutos!', label: 'Pedido Atrasado (Motoboy)', tipo: 'erro', variaveis: ['pedido_id'] },
  { evento: 'rascunho-recebido', textoPadrao: '📝 Novo rascunho de pedido #{pedido_id} pendente na {mesa}.', label: 'Novo Rascunho', tipo: 'info', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-servido', textoPadrao: '🍽️ O pedido #{pedido_id} ({mesa}) foi servido/entregue!', label: 'Pedido Servido (Salão)', tipo: 'sucesso', variaveis: ['mesa', 'pedido_id'] }
];

app.get('/api/toast-config/listar', ensureDbInitialized, async (req, res) => {
  try {
    const configRows = (await query("SELECT chave, valor FROM sistema_config WHERE chave LIKE 'toast_%'")).rows;
    const configMap = {};
    for (const r of configRows) {
      configMap[r.chave] = r.valor;
    }

    const templates = TOAST_DEFAULTS.map(d => {
      const customText = configMap[`toast_text_${d.evento}`];
      const customEnabled = configMap[`toast_enabled_${d.evento}`];
      const customSound = configMap[`toast_sound_${d.evento}`];
      return {
        ...d,
        texto: (customText !== undefined && customText !== null) ? customText : d.textoPadrao,
        ativo: (customEnabled !== undefined && customEnabled !== null) ? customEnabled === 'true' : true,
        som: (customSound !== undefined && customSound !== null) ? customSound === 'true' : true
      };
    });

    res.json({ success: true, templates });
  } catch (error) {
    res.json({ success: false, error: 'Falha ao buscar configurações de Toasts', detalhes: error.message });
  }
});

app.post('/api/toast-config/salvar', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const { templates } = req.body;
    if (!templates || !Array.isArray(templates)) return res.json({ success: false, error: 'Templates inválidos' });

    for (const t of templates) {
      const activeVal = t.ativo !== false ? 'true' : 'false';
      const soundVal = t.som !== false ? 'true' : 'false';
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [`toast_text_${t.evento}`, t.texto || '']);
        await query("INSERT INTO sistema_config (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [`toast_enabled_${t.evento}`, activeVal]);
        await query("INSERT INTO sistema_config (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [`toast_sound_${t.evento}`, soundVal]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [`toast_text_${t.evento}`, t.texto || '']);
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [`toast_enabled_${t.evento}`, activeVal]);
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES (?, ?)", [`toast_sound_${t.evento}`, soundVal]);
      }
    }
    if (typeof safePusherTrigger !== 'undefined') {
      await safePusherTrigger('garconnexpress', 'toast-config-atualizado', {});
    }
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: 'Erro ao salvar configurações de Toasts', detalhes: error.message });
  }
});

app.post('/api/toast-config/restaurar/:evento', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const { evento } = req.params;
    await query("DELETE FROM sistema_config WHERE chave = $1 OR chave = $2 OR chave = $3", [`toast_text_${evento}`, `toast_enabled_${evento}`, `toast_sound_${evento}`]);
    if (typeof safePusherTrigger !== 'undefined') {
      await safePusherTrigger('garconnexpress', 'toast-config-atualizado', {});
    }
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: 'Erro ao restaurar padrão de Toast', detalhes: error.message });
  }
});

app.post('/api/toast-config/testar', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const { evento, mensagem, tipo } = req.body;
    if (typeof safePusherTrigger !== 'undefined') {
      await safePusherTrigger('garconnexpress', 'teste-toast', { 
        evento, 
        mensagem, 
        tipo: tipo || 'info',
        titulo: 'TESTE DE ALERTA'
      });
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Pusher não configurado no servidor' });
    }
  } catch (error) {
    res.json({ success: false, error: 'Erro ao enviar teste de Toast', detalhes: error.message });
  }
});


app.post('/api/config/broadcast', ensureDbInitialized, isAdmin, async (req, res) => {
  try {
    const { mensagem, destinatario } = req.body;
    if (!mensagem) return res.json({ success: false, error: 'Mensagem vazia' });

    // 1. Dispara via Pusher
    if (typeof safePusherTrigger !== 'undefined') {
      await safePusherTrigger('garconnexpress', 'comunicado-geral', {
        mensagem,
        destinatario: destinatario || 'todos'
      });
    }

    // 2. Dispara via FCM para dispositivos em background/nativos
    const targets = (destinatario === 'todos' || !destinatario) ? ['garcom', 'cozinha', 'motoboy'] : [destinatario];
    const subs = (await query("SELECT * FROM push_subscriptions")).rows;
    let enviados = 0;
    const sentEndpoints = new Set();
    
    for (const sub of subs) {
      if (!targets.includes(sub.app_type)) continue;
      if (sentEndpoints.has(sub.endpoint)) {
        console.log(`⚠️ Ignorando token duplicado no envio de comunicado: ${sub.endpoint}`);
        continue;
      }
      sentEndpoints.add(sub.endpoint);
      
      const isNativeSub = sub.is_native === 1 || sub.is_native === true || 
                          (!sub.endpoint.startsWith('https://') && !sub.endpoint.includes('fcm.googleapis.com'));
      if (isNativeSub && admin.apps.length > 0) {
        const message = {
          notification: {
            title: '📢 AVISO GERAL',
            body: mensagem
          },
          data: {
            event: 'comunicado-geral',
            sound: 'notificacao.mp3',
            mensagem
          },
          android: {
            priority: 'high',
            notification: {
              sound: 'notificacao.mp3',
              channelId: sub.app_type === 'garcom' ? 'garcom_v1' : 'pedidos',
              defaultSound: false
            }
          },
          token: sub.endpoint
        };
        let firebaseApp = admin;
        if (sub.app_type === 'motoboy' && admin.apps.find(a => a.name === 'motoboy')) firebaseApp = admin.app('motoboy');
        else if (sub.app_type === 'cozinha' && admin.apps.find(a => a.name === 'cozinha')) firebaseApp = admin.app('cozinha');
        
        await firebaseApp.messaging().send(message)
          .then(() => { enviados++; })
          .catch(async (err) => {
            console.error('FCM Broadcast Erro:', err.message);
            if (err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/registration-token-not-registered' || err.message.includes('Requested entity was not found')) {
              console.log('🗑️ Removendo token FCM inativo:', sub.endpoint);
              await query("DELETE FROM push_subscriptions WHERE id = ?", [sub.id]);
            }
          });
      }
    }

    res.json({ success: true, enviados });
  } catch (error) {
    res.json({ success: false, error: 'Erro ao enviar comunicado', detalhes: error.message });
  }
});


app.get('/api/debug-fcm', ensureDbInitialized, async (req, res) => {
    try {
      const now = new Date();
      const delayedClosureRes = await query("SELECT p.id, p.garcom_id, CAST(p.fechamento_solicitado_em AS TEXT) as fechamento_str, m.numero as mesa_numero, p.notificado_atraso_fechamento FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE (p.status = 'aguardando_fechamento' OR p.solicitou_fechamento = TRUE OR p.solicitou_fechamento = 'true') AND p.fechamento_solicitado_em IS NOT NULL");
      
      const debugList = delayedClosureRes.rows.map(p => {
        let dateStr = p.fechamento_str || '';
        if (!dateStr.endsWith('Z')) dateStr = dateStr.replace(' ', 'T') + 'Z';
        const requestedAt = new Date(dateStr);
        const diffMinutes = (now - requestedAt) / 60000;
        return {
          id: p.id,
          garcom_id: p.garcom_id,
          notificado_atraso_fechamento: p.notificado_atraso_fechamento,
          raw_date: p.fechamento_str,
          parsed_date: requestedAt.toISOString(),
          now: now.toISOString(),
          diffMinutes: diffMinutes,
          isDelayed: diffMinutes >= 5
        };
      });

      const subsRes = await query("SELECT id, garcom_id, app_type, is_native FROM push_subscriptions");
      
      res.json({ debugList, subs: subsRes.rows });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
});

const SYSTEM_VERSION = '1.3.4';
app.get('/api/versao', (req, res) => {
  res.json({ versao: SYSTEM_VERSION });
});

app.get('/api/time', (req, res) => {
  res.json({ timestamp: new Date().toISOString() });
});

app.get('/api/diag', isAdmin, async (req, res) => {
  try {
    let dbStatus = 'disconnected';
    if (isPostgres) {
      await db.query('SELECT 1');
      dbStatus = 'connected';
    } else {
      db.prepare('SELECT 1').get();
      dbStatus = 'connected';
    }
    
    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      db: dbStatus,
      dbType: isPostgres ? 'postgres' : 'sqlite',
      initError: dbInitError ? dbInitError.message : null,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        HAS_POSTGRES_URL: !!process.env.POSTGRES_URL,
        HAS_DATABASE_URL: !!process.env.DATABASE_URL,
        PUSHER_CONFIGURED: !!(process.env.PUSHER_APP_ID && process.env.PUSHER_APP_KEY && process.env.PUSHER_APP_SECRET),
        PUSHER_CLUSTER: process.env.PUSHER_CLUSTER || 'não definido',
        JWT_SECRET_DEFINED: !!process.env.JWT_SECRET
      }
    });
  } catch (e) {
    res.status(500).json({
      status: 'error',
      db: 'disconnected',
      error: e.message,
      initError: dbInitError ? dbInitError.message : null
    });
  }
});

// Endpoint para forçar inicialização do DB (útil se as tabelas não existirem)
  app.post('/api/init-db-force', isAdmin, async (req, res) => {
    try {
      const tables = [
        `CREATE TABLE IF NOT EXISTS mesas (id SERIAL PRIMARY KEY, numero INTEGER NOT NULL, status TEXT DEFAULT 'livre', garcom_id TEXT)`,
        `CREATE TABLE IF NOT EXISTS menu (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, preco_original REAL, descricao TEXT, imagem TEXT, estoque INTEGER DEFAULT -1, validade DATE, enviar_cozinha BOOLEAN DEFAULT TRUE, visivel BOOLEAN DEFAULT TRUE, em_promocao BOOLEAN DEFAULT FALSE)`,
        `CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, mesa_id INTEGER, garcom_id TEXT, status TEXT DEFAULT 'recebido', total REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, forma_pagamento TEXT, desconto REAL DEFAULT 0, acrescimo REAL DEFAULT 0, valor_recebido REAL DEFAULT 0, troco REAL DEFAULT 0, cobrar_taxa BOOLEAN DEFAULT TRUE, num_pessoas INTEGER DEFAULT 1, valor_por_pessoa REAL, observacao TEXT, pago_parcial REAL DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY, pedido_id INTEGER, menu_id INTEGER, quantidade INTEGER, observacao TEXT, status TEXT DEFAULT 'pendente')`,
        `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS garcons (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123', telefone TEXT, comissao REAL DEFAULT 0, is_online BOOLEAN DEFAULT FALSE, last_assigned_at TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS usuarios_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS sistema_config (chave TEXT PRIMARY KEY, valor TEXT)`,
        `CREATE TABLE IF NOT EXISTS fluxo_caixa (id SERIAL PRIMARY KEY, data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP, data_fechamento TIMESTAMP, valor_inicial REAL NOT NULL, valor_final REAL, status TEXT DEFAULT 'aberto', total_dinheiro REAL DEFAULT 0, total_pix REAL DEFAULT 0, total_cartao REAL DEFAULT 0, total_vendas REAL DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS caixa_movimentacoes (id SERIAL PRIMARY KEY, caixa_id INTEGER NOT NULL, tipo TEXT NOT NULL, valor REAL NOT NULL, motivo TEXT, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS codigos_acesso (id SERIAL PRIMARY KEY, mesa_id INTEGER, codigo TEXT NOT NULL, status DEFAULT 'ativo', criado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, garcom_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, app_type TEXT DEFAULT 'garcom', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS ficha_tecnica (id SERIAL PRIMARY KEY, menu_id INTEGER NOT NULL, ingrediente_id INTEGER NOT NULL, quantidade REAL NOT NULL, unidade TEXT DEFAULT 'un')`,
        `CREATE TABLE IF NOT EXISTS estoque_movimentacoes (id SERIAL PRIMARY KEY, menu_id INTEGER NOT NULL, quantidade REAL NOT NULL, tipo TEXT NOT NULL, motivo TEXT, criado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_id ON pedido_itens(pedido_id)`,
        `CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_id ON pedidos(mesa_id)`,
        `CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)`
      ];
      for (let tableSql of tables) {
        if (isPostgres) await db.query(tableSql);
        else db.exec(tableSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
      }
      res.json({ success: true, message: 'Tabelas criadas/verificadas com sucesso.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const PORT = process.env.PORT || 3001;
// ==========================================
// TEXTOS DO ROBO (BOT RESPONSES)
// ==========================================
app.get('/api/bot-responses', async (req, res) => {
    try {
        const { rows } = await query("SELECT valor FROM sistema_config WHERE chave = 'bot_responses'");
        if (rows && rows.length > 0 && rows[0].valor) {
            res.json(JSON.parse(rows[0].valor));
        } else {
            res.json({});
        }
    } catch(err) {
        console.error('Erro GET /api/bot-responses', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bot-responses', isAdmin, async (req, res) => {
    try {
        const { responses } = req.body;
        const valor = JSON.stringify(responses);
        if (isPostgres) {
            await query("INSERT INTO sistema_config (chave, valor) VALUES ('bot_responses', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
        } else {
            await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('bot_responses', ?)", [valor]);
        }
        res.json({ success: true });
    } catch(err) {
        console.error('Erro POST /api/bot-responses', err);
        res.status(500).json({ error: err.message });
    }
});

// Middleware global de tratamento de erros para ocultar stack traces no Express
app.use((err, req, res, next) => {
  console.error('❌ Erro Não Tratado:', err.stack);
  res.status(500).json({ error: 'Erro interno no servidor' });
});

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));





// trigger build no vercel

// forced push 2026-06-22 12:01:52

// trigger redeploy after reconnect 2026-06-22 12:07:02



