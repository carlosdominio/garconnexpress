const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = (ctx) => {
  const {
    query,
    ensureDbInitialized,
    isAdmin,
    safePusherTrigger,
    checkAndSendScheduledFCM,
    isPostgres,
    admin
  } = ctx;

  const router = express.Router();

  // Helper para verificar horário do cardápio
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

  // GET /api/versao (Público - Verificação de versão do frontend/app)
  router.get('/versao', (req, res) => {
    res.json({ versao: '1.3.1' });
  });

  // GET /api/time (Público)
  router.get('/time', (req, res) => {
    res.json({ timestamp: new Date().toISOString() });
  });

  // GET /api/configs/cardapio-status
  router.get('/configs/cardapio-status', ensureDbInitialized, async (req, res) => {
    try {
      const result = await query("SELECT valor FROM sistema_config WHERE chave = 'cardapio_aberto'");
      const status = result.rows && result.rows.length > 0 ? result.rows[0].valor === 'true' : true;
      res.json({ cardapio_aberto: status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/configs/cardapio-toggle
  router.post('/configs/cardapio-toggle', ensureDbInitialized, isAdmin, async (req, res) => {
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

  // GET /api/configs/cardapio-horarios
  router.get('/configs/cardapio-horarios', ensureDbInitialized, async (req, res) => {
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

  // POST /api/configs/cardapio-horarios
  router.post('/configs/cardapio-horarios', ensureDbInitialized, isAdmin, async (req, res) => {
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

  // GET /api/configs/delivery-status
  router.get('/configs/delivery-status', ensureDbInitialized, async (req, res) => {
    try {
      const result = await query("SELECT valor FROM sistema_config WHERE chave = 'delivery_aberto'");
      const status = result.rows && result.rows.length > 0 ? result.rows[0].valor === 'true' : true;
      res.json({ delivery_aberto: status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/configs/delivery-toggle
  router.post('/configs/delivery-toggle', ensureDbInitialized, isAdmin, async (req, res) => {
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

  // GET /api/config/categorias-cozinha
  router.get('/config/categorias-cozinha', async (req, res) => {
    try {
      const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
      res.json(config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : []);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/config/categorias-cozinha
  router.post('/config/categorias-cozinha', isAdmin, async (req, res) => {
    const { categorias } = req.body;
    try {
      const valor = JSON.stringify(categorias);
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?)", [valor]);
      }
      await query(`UPDATE menu SET enviar_cozinha = NULL`);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/config/categorias-churrasco
  router.get('/config/categorias-churrasco', async (req, res) => {
    try {
      const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_churrasco'");
      res.json(config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : []);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/config/categorias-churrasco
  router.post('/config/categorias-churrasco', isAdmin, async (req, res) => {
    const { categorias } = req.body;
    try {
      const valor = JSON.stringify(categorias);
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('categorias_churrasco', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_churrasco', ?)", [valor]);
      }
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/config/versao-app
  router.get('/config/versao-app', ensureDbInitialized, async (req, res) => {
    try {
      const configRows = (await query("SELECT chave, valor FROM sistema_config WHERE chave IN (" +
        "'config_web_version', " +
        "'config_garcom_apk_version', 'config_garcom_apk_url', " +
        "'config_cozinha_apk_version', 'config_cozinha_apk_url', " +
        "'config_motoboy_apk_version', 'config_motoboy_apk_url', " +
        "'config_churrasqueiro_apk_version', 'config_churrasqueiro_apk_url'" +
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
        motoboy_apk_url: configMap['config_motoboy_apk_url'] || '/motoboy-v2.0.0-portrait.apk',
        churrasqueiro_apk_version: configMap['config_churrasqueiro_apk_version'] || '1.0.0',
        churrasqueiro_apk_url: configMap['config_churrasqueiro_apk_url'] || '/churrasqueiro-v1.0.0-portrait.apk'
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/config/versao-app
  router.post('/config/versao-app', ensureDbInitialized, isAdmin, async (req, res) => {
    const {
      web_version,
      garcom_apk_version, garcom_apk_url,
      cozinha_apk_version, cozinha_apk_url,
      motoboy_apk_version, motoboy_apk_url,
      churrasqueiro_apk_version, churrasqueiro_apk_url
    } = req.body;
    try {
      // 1. Busca as URLs antigas no banco antes de atualizar
      const oldUrlsRows = (await query("SELECT chave, valor FROM sistema_config WHERE chave IN (" +
        "'config_garcom_apk_url', 'config_cozinha_apk_url', 'config_motoboy_apk_url', 'config_churrasqueiro_apk_url'" +
        ")")).rows || [];
      
      const oldUrls = {};
      for (const r of oldUrlsRows) {
        oldUrls[r.chave] = r.valor;
      }

      // 2. Compara e apaga os blobs antigos do Vercel Storage que foram substituídos
      const { del } = require('@vercel/blob');
      const urlMappings = [
        { chave: 'config_garcom_apk_url', nova: garcom_apk_url },
        { chave: 'config_cozinha_apk_url', nova: cozinha_apk_url },
        { chave: 'config_motoboy_apk_url', nova: motoboy_apk_url },
        { chave: 'config_churrasqueiro_apk_url', nova: churrasqueiro_apk_url }
      ];

      for (const mapping of urlMappings) {
        const antiga = oldUrls[mapping.chave];
        if (antiga && antiga !== mapping.nova && antiga.includes('vercel-storage.com')) {
          try {
            await del(antiga);
            console.log(`🗑️ Vercel Blob antigo deletado com sucesso: ${antiga}`);
          } catch (delErr) {
            console.error(`⚠️ Falha ao deletar Vercel Blob antigo (${antiga}):`, delErr);
          }
        }
      }

      const configs = [
        { chave: 'config_web_version', valor: web_version || '1.0.0' },
        { chave: 'config_garcom_apk_version', valor: garcom_apk_version || '2.0.0' },
        { chave: 'config_garcom_apk_url', valor: garcom_apk_url || '/garcom-v1.1.0-portrait.apk' },
        { chave: 'config_cozinha_apk_version', valor: cozinha_apk_version || '2.0.0' },
        { chave: 'config_cozinha_apk_url', valor: cozinha_apk_url || '/cozinha-v1.1.0-portrait.apk' },
        { chave: 'config_motoboy_apk_version', valor: motoboy_apk_version || '2.0.0' },
        { chave: 'config_motoboy_apk_url', valor: motoboy_apk_url || '/motoboy-v2.0.0-portrait.apk' },
        { chave: 'config_churrasqueiro_apk_version', valor: churrasqueiro_apk_version || '1.0.0' },
        { chave: 'config_churrasqueiro_apk_url', valor: churrasqueiro_apk_url || '/churrasqueiro-v1.0.0-portrait.apk' }
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

  // POST /api/config/upload-apk
  router.post('/config/upload-apk', express.raw({ type: 'application/octet-stream', limit: '150mb' }), ensureDbInitialized, isAdmin, async (req, res) => {
    const filename = path.basename(req.query.filename || '');
    if (!filename || !filename.endsWith('.apk')) {
      return res.status(400).json({ success: false, error: 'Arquivo inválido ou nome ausente.' });
    }
    try {
      let filePath = path.join(__dirname, '..', filename);
      try {
        fs.writeFileSync(filePath, req.body);
        console.log(`✅ Novo APK gravado com sucesso no disco local: ${filePath}`);
      } catch (writeErr) {
        if (writeErr.code === 'EROFS' || writeErr.message.includes('read-only')) {
          filePath = path.join('/tmp', filename);
          fs.writeFileSync(filePath, req.body);
          console.log(`✅ Novo APK gravado com sucesso no diretório temporário /tmp: ${filePath}`);
        } else {
          throw writeErr;
        }
      }
      res.json({ success: true, url: `/${filename}` });
    } catch (error) {
      console.error('❌ Erro no upload do APK:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/config/upload-apk-vercel
  router.post('/config/upload-apk-vercel', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const { handleUpload } = require('@vercel/blob/client');
      const jsonResponse = await handleUpload({
        body: req.body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          return {
            allowedContentTypes: ['application/vnd.android.package-archive', 'application/octet-stream'],
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({}),
          };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          console.log('✅ Upload concluído no Vercel Blob:', blob.url);
        },
      });
      return res.json(jsonResponse);
    } catch (error) {
      console.error('❌ Erro no handleUpload do Vercel Blob:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/config/som-global
  router.get('/config/som-global', ensureDbInitialized, async (req, res) => {
    try {
      const configRows = (await query("SELECT chave, valor FROM sistema_config WHERE chave IN ('config_som_garcom', 'config_som_cozinha', 'config_som_admin', 'config_som_motoboy', 'config_som_churrasco', 'config_som_whatsapp')")).rows;
      const configMap = {};
      for (const r of configRows) {
        configMap[r.chave] = r.valor;
      }
      res.json({
        success: true,
        somGarcom: configMap['config_som_garcom'] || 'campainha_classica',
        somCozinha: configMap['config_som_cozinha'] || 'sino_moderno',
        somAdmin: configMap['config_som_admin'] || 'alerta_digital',
        somMotoboy: configMap['config_som_motoboy'] || 'campainha_classica',
        somChurrasco: configMap['config_som_churrasco'] || 'sino_moderno',
        somWhatsapp: configMap['config_som_whatsapp'] || 'campainha_classica'
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/config/som-global
  router.post('/config/som-global', ensureDbInitialized, isAdmin, async (req, res) => {
    const { somGarcom, somCozinha, somAdmin, somMotoboy, somChurrasco, somWhatsapp } = req.body;
    try {
      const configs = [
        { chave: 'config_som_garcom', valor: somGarcom || 'campainha_classica' },
        { chave: 'config_som_cozinha', valor: somCozinha || 'sino_moderno' },
        { chave: 'config_som_admin', valor: somAdmin || 'alerta_digital' },
        { chave: 'config_som_motoboy', valor: somMotoboy || 'campainha_classica' },
        { chave: 'config_som_churrasco', valor: somChurrasco || 'sino_moderno' },
        { chave: 'config_som_whatsapp', valor: somWhatsapp || 'campainha_classica' }
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
          somMotoboy: somMotoboy || 'campainha_classica',
          somChurrasco: somChurrasco || 'sino_moderno',
          somWhatsapp: somWhatsapp || 'campainha_classica'
        });
      }
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/config/broadcast
  router.post('/config/broadcast', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const { mensagem, destinatario } = req.body;
      if (!mensagem) return res.json({ success: false, error: 'Mensagem vazia' });

      if (typeof safePusherTrigger !== 'undefined') {
        await safePusherTrigger('garconnexpress', 'comunicado-geral', {
          mensagem,
          destinatario: destinatario || 'todos'
        });
      }

      const targets = (destinatario === 'todos' || !destinatario) ? ['garcom', 'cozinha', 'motoboy', 'churrasqueiro'] : [destinatario];
      const subs = (await query("SELECT * FROM push_subscriptions")).rows;
      let enviados = 0;
      const sentEndpoints = new Set();
      
      for (const sub of subs) {
        if (!targets.includes(sub.app_type)) continue;
        if (sentEndpoints.has(sub.endpoint)) continue;
        sentEndpoints.add(sub.endpoint);
        
        const isNativeSub = sub.is_native === 1 || sub.is_native === true || 
                            (!sub.endpoint.startsWith('https://') && !sub.endpoint.includes('fcm.googleapis.com'));
        if (isNativeSub && admin && admin.apps && admin.apps.length > 0) {
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

          await admin.messaging().send(message)
            .then(() => enviados++)
            .catch(err => console.error('Erro ao enviar FCM broadcast:', err.message));
        }
      }

      res.json({ success: true, enviados });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
