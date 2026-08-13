const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    isAuthenticated,
    isAdmin,
    sendWhatsAppMessage,
    isPostgres,
    BOT_SECRET,
    getWhatsappState
  } = ctx;

  const router = express.Router();

  // POST /api/whatsapp/webhook
  router.post('/whatsapp/webhook', async (req, res) => {
    try {
      const { token, sender, text, fromMe } = req.body;
      if (!token || token !== BOT_SECRET) {
        return res.status(401).json({ error: 'Token inválido ou não autorizado.' });
      }
      if (fromMe) return res.json({ success: true });

      const from = sender ? sender.split('@')[0].replace(/\D/g, '') : '';
      const msg = text ? text.trim() : '';

      if (from && msg && ctx.clientesEmAtendimento) {
        if (msg.includes('🛍️ *NOVO PEDIDO - DELIVERY*') || msg.includes('🛵 DELIVERY')) {
          ctx.clientesEmAtendimento.set(from, Date.now() + (4 * 60 * 60 * 1000));
          console.log(`📦 [Webhook] Pedido detectado para ${from}. Mantendo modo automático no cache.`);
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Erro no webhook do WhatsApp:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/whatsapp-status
  router.get('/whatsapp-status', isAuthenticated, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
      const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
      const isEnabled = configRes.rows && configRes.rows.length > 0 ? configRes.rows[0].valor === 'true' : true;

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

      const state = getWhatsappState ? getWhatsappState() : {};
      let currentRealStatus = state.whatsappRealStatus || 'DESCONECTADO';
      let isSocketConnected = state.whatsappSocket ? state.whatsappSocket.connected : false;
      const botUrlFinal = state.botUrlFinal;
      
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

      res.json({
        configured: !!botUrlFinal,
        connected: isSocketConnected,
        realStatus: currentRealStatus,
        enabled: isEnabled,
        number: numbersDisplay,
        ...(req.user && req.user.role === 'admin' ? { 
          botUrl: botUrlFinal ? `${botUrlFinal}${botUrlFinal.includes('?') ? '&' : '?'}token=${BOT_SECRET}` : '' 
        } : {})
      });
    } catch (error) {
      console.error('❌ Erro ao buscar status do WhatsApp:', error.message);
      res.json({
        configured: false,
        connected: false,
        enabled: false,
        number: 'Erro ao carregar',
        error: error.message
      });
    }
  });

  // POST /api/whatsapp-toggle
  router.post('/whatsapp-toggle', isAdmin, async (req, res) => {
    const { enabled } = req.body;
    try {
      await query("UPDATE sistema_config SET valor = ? WHERE chave = 'whatsapp_enabled'", [enabled ? 'true' : 'false']);
      res.json({ success: true, enabled });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/whatsapp-number
  router.post('/whatsapp-number', isAdmin, async (req, res) => {
    const { number } = req.body;
    try {
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [number]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?)", [number]);
      }

      const state = getWhatsappState ? getWhatsappState() : {};
      if (state.whatsappSocket && state.whatsappSocket.connected && number) {
        const numbersList = number.split(',').map(n => n.trim().replace(/\D/g, '') + '@s.whatsapp.net');
        numbersList.forEach(jid => {
          state.whatsappSocket.emit('rename_chat', { jid, name: 'Notificações Meu zap 🔔' });
        });
      }

      res.json({ success: true, number });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/whatsapp/test-delay
  router.post('/whatsapp/test-delay', isAdmin, async (req, res) => {
    try {
      const texto = req.body?.texto || `🧪 TESTE DE ATRASO\n\n⚠️ Mesa TESTE #999\n\nPEDIDO PENDENTE há 10 minutos!\n\n_Mensagem de teste disparada manualmente._`;
      const sent = sendWhatsAppMessage ? await sendWhatsAppMessage(texto) : false;
      if (sent) {
        return res.json({ ok: true, message: 'Mensagem de teste enviada com sucesso via WhatsApp!' });
      } else {
        return res.status(503).json({ ok: false, message: 'Falha no envio: bot desconectado ou número não configurado.' });
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/bot-responses
  router.get('/bot-responses', async (req, res) => {
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

  // POST /api/bot-responses
  router.post('/bot-responses', isAdmin, async (req, res) => {
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

  return router;
};
