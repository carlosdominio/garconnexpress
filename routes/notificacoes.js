const express = require('express');

const FCM_DEFAULTS = [
  { evento: 'novo_pedido', tituloPadrao: '🍕 NOVO PEDIDO RECEBIDO!', corpoPadrao: 'Mesa {mesa} fez um novo pedido (#{pedido_id}).', label: 'Novo Pedido', destinatario: 'garcom', variaveis: ['mesa', 'cliente', 'itens', 'pedido_id'] },
  { evento: 'pedido_pronto', tituloPadrao: '🍳 PEDIDO PRONTO!', corpoPadrao: 'O pedido #{pedido_id} da Mesa {mesa} já pode ser servido.', label: 'Pedido Pronto', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'chamado_garcom', tituloPadrao: '🛎️ CLIENTE CHAMANDO!', corpoPadrao: 'A Mesa {mesa} solicitou atendimento imediato.', label: 'Chamado de Garçom', destinatario: 'garcom', variaveis: ['mesa'] },
  { evento: 'solicitacao_fechamento', tituloPadrao: '💰 FECHAMENTO DE CONTA', corpoPadrao: 'A Mesa {mesa} pediu o fechamento da conta do pedido #{pedido_id}.', label: 'Solicitação de Conta', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'cozinha_novo_item', tituloPadrao: '👨‍🍳 NOVO ITEM NA COZINHA!', corpoPadrao: 'Mesa {mesa} enviou novo(s) item(ns) para preparo (#{pedido_id}).', label: 'Novo Item Cozinha', destinatario: 'cozinha', variaveis: ['mesa', 'pedido_id', 'itens'] },
  { evento: 'churrasco_novo_item', tituloPadrao: '🥩 NOVO ITEM NA CHURRASQUEIRA!', corpoPadrao: 'Mesa {mesa} enviou novo(s) corte(s) para preparo (#{pedido_id}).', label: 'Novo Item Churrasco', destinatario: 'churrasqueiro', variaveis: ['mesa', 'pedido_id', 'itens'] },
  { evento: 'motoboy_nova_entrega', tituloPadrao: '🛵 NOVA ENTREGA DISPONÍVEL!', corpoPadrao: 'Pedido #{pedido_id} saiu para entrega ({endereco}).', label: 'Nova Entrega Delivery', destinatario: 'motoboy', variaveis: ['pedido_id', 'endereco', 'cliente'] },
  { evento: 'estoque_baixo', tituloPadrao: '⚠️ ALERTA DE ESTOQUE BAIXO!', corpoPadrao: 'O produto {produto} atingiu o limite crítico ({estoque} un).', label: 'Estoque Baixo', destinatario: 'todos', variaveis: ['produto', 'estoque'] },
  { evento: 'pedido_atrasado_garcom', tituloPadrao: '🔥 GARÇOM: PEDIDO ATRASADO!', corpoPadrao: 'O pedido da Mesa {mesa} (#{pedido_id}) está parado há mais de 10 minutos!', label: 'Alerta de Atraso (Garçom)', destinatario: 'garcom', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido_atrasado_cozinha', tituloPadrao: '🔥 COZINHA: PEDIDO ATRASADO!', corpoPadrao: 'O pedido da Mesa {mesa} (#{pedido_id}) está aguardando preparo há mais de 10 minutos!', label: 'Alerta de Atraso (Cozinha)', destinatario: 'cozinha', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido_atrasado_churrasco', tituloPadrao: '🔥 CHURRASCO: PEDIDO ATRASADO!', corpoPadrao: 'O pedido da Mesa {mesa} (#{pedido_id}) está aguardando churrasco há mais de 10 minutos!', label: 'Alerta de Atraso (Churrasco)', destinatario: 'churrasqueiro', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido_atrasado_motoboy', tituloPadrao: '🔥 MOTOBOY: ENTREGA ATRASADA!', corpoPadrao: 'O pedido #{pedido_id} está aguardando entrega há mais de 10 minutos!', label: 'Alerta de Atraso (Motoboy)', destinatario: 'motoboy', variaveis: ['pedido_id'] },
  { evento: 'fechamento_atrasado', tituloPadrao: '⚠️ CAIXA: FECHAMENTO ATRASADO!', corpoPadrao: 'A Mesa {mesa} solicitou a conta há mais de 5 minutos e ainda não foi encerrada.', label: 'Caixa: Fechamento Atrasado', destinatario: 'garcom', variaveis: ['mesa'] },
  { evento: 'aguardando_cliente_atrasado', tituloPadrao: '⚠️ CAIXA: AGUARDANDO CLIENTE!', corpoPadrao: 'A Mesa {mesa} está aguardando o pagamento do cliente há mais de 5 minutos.', label: 'Caixa: Aguardando Cliente (Atrasado)', destinatario: 'garcom', variaveis: ['mesa'] },
  { evento: 'aguardando_cliente_registro_atrasado', tituloPadrao: '🛎️ MESA AGUARDANDO CLIENTE!', corpoPadrao: 'A Mesa {mesa} está com o código ativo há mais de 5 minutos sem nenhum pedido.', label: 'Caixa: Registro Atrasado', destinatario: 'garcom', variaveis: ['mesa'] }
];

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
  { evento: 'fechamento-atrasado', textoPadrao: '⚠️ CAIXA: FECHAMENTO ATRASADO! O fechamento da {mesa} foi solicitado pelo cliente há mais de 5 minutos.', label: 'Caixa: Fechamento Atrasado', tipo: 'erro', variaveis: ['mesa'] },
  { evento: 'aguardando-cliente-atrasado', textoPadrao: '⚠️ CAIXA: AGUARDANDO CLIENTE! A {mesa} está aguardando o pagamento do cliente há mais de 5 minutos.', label: 'Caixa: Aguardando Cliente (Atrasado)', tipo: 'erro', variaveis: ['mesa'] },
  { evento: 'aguardando-cliente-registro-atrasado', textoPadrao: '🛎️ MESA AGUARDANDO CLIENTE! A {mesa} está com o código de acesso ativo há mais de 5 minutos e nenhum pedido foi enviado ainda.', label: 'Caixa: Registro Atrasado (Aguardando Cliente)', tipo: 'erro', variaveis: ['mesa'] },
  { evento: 'pedido-atrasado-garcom', textoPadrao: '🔥 GARÇOM: PEDIDO ATRASADO! O pedido da {mesa} (#{pedido_id}) está parado há mais de 10 minutos!', label: 'Pedido Atrasado (Garçom)', tipo: 'erro', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-atrasado-cozinha', textoPadrao: '🔥 COZINHA: PEDIDO ATRASADO! O pedido #{pedido_id} ({mesa}) está aguardando há mais de 10 minutos!', label: 'Pedido Atrasado (Cozinha)', tipo: 'erro', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-atrasado-churrasco', textoPadrao: '🔥 CHURRASCO: PEDIDO ATRASADO! O pedido #{pedido_id} ({mesa}) está aguardando há mais de 10 minutos!', label: 'Pedido Atrasado (Churrasco)', tipo: 'erro', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-atrasado-motoboy', textoPadrao: '🔥 MOTOBOY: ENTREGA ATRASADA! O pedido #{pedido_id} está parado há mais de 10 minutos!', label: 'Pedido Atrasado (Motoboy)', tipo: 'erro', variaveis: ['pedido_id'] },
  { evento: 'rascunho-recebido', textoPadrao: '📝 Novo rascunho de pedido #{pedido_id} pendente na {mesa}.', label: 'Novo Rascunho', tipo: 'info', variaveis: ['mesa', 'pedido_id'] },
  { evento: 'pedido-servido', textoPadrao: '🍽️ O pedido #{pedido_id} ({mesa}) foi servido/entregue!', label: 'Pedido Servido (Salão)', tipo: 'sucesso', variaveis: ['mesa', 'pedido_id'] }
];

module.exports = (ctx) => {
  const {
    query,
    ensureDbInitialized,
    isAuthenticated,
    isAdmin,
    safePusherTrigger,
    sendWhatsAppMessage,
    isPostgres,
    admin,
    VAPID_PUBLIC_KEY
  } = ctx;

  const router = express.Router();

  // GET /api/vapid-publicKey
  router.get('/vapid-publicKey', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '' });
  });

  // POST /api/subscribe
  router.post('/subscribe', isAuthenticated, async (req, res) => {
    const subscription = req.body;
    const garcomId = req.user.id || req.user.usuario;
    const appType = req.body.app_type || 'garcom';
    try {
      if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Endpoint/token é obrigatório.' });
      }
      await query("DELETE FROM push_subscriptions WHERE endpoint = ?", [subscription.endpoint]);
      await query("DELETE FROM push_subscriptions WHERE garcom_id = ? AND app_type = ?", [garcomId, appType]);

      const p256dh = subscription.keys?.p256dh || '';
      const auth = subscription.keys?.auth || '';
      const isNative = subscription.isNative ? 1 : 0;
      await query("INSERT INTO push_subscriptions (garcom_id, endpoint, p256dh, auth, app_type, is_native) VALUES (?, ?, ?, ?, ?, ?)", 
        [garcomId, subscription.endpoint, p256dh, auth, appType, isNative]);

      res.status(201).json({ success: true });
    } catch (error) {
      console.error("Erro ao salvar inscrição push:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/subscribe-motoboy
  router.post('/subscribe-motoboy', isAuthenticated, async (req, res) => {
    const { endpoint } = req.body;
    const garcomId = req.user.id || req.user.usuario;
    try {
      if (!endpoint) return res.status(400).json({ error: 'Endpoint/token é obrigatório.' });
      await query("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
      await query("DELETE FROM push_subscriptions WHERE garcom_id = ? AND app_type = 'motoboy'", [garcomId]);
      await query("INSERT INTO push_subscriptions (garcom_id, endpoint, app_type) VALUES (?, ?, 'motoboy')", [garcomId, endpoint]);
      res.status(201).json({ success: true });
    } catch (error) {
      console.error("Erro ao salvar inscrição motoboy:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/subscribe-cozinha
  router.post('/subscribe-cozinha', isAuthenticated, async (req, res) => {
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

  // POST /api/notify-admin
  router.post('/notify-admin', isAuthenticated, async (req, res) => {
    const { titulo, mensagem, message } = req.body;
    const msgContent = mensagem || message;
    if (!titulo || !msgContent) {
      return res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });
    }
    try {
      const formattedText = `🔔 *PAINEL ADM — ${titulo}*\n\n${msgContent}`;
      if (sendWhatsAppMessage) await sendWhatsAppMessage(formattedText);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/fcm-config/listar
  router.post('/fcm-config/listar', ensureDbInitialized, isAdmin, async (req, res) => {
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

  // POST /api/fcm-config/salvar-sistema
  router.post('/fcm-config/salvar-sistema', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const { templates } = req.body;
      if (!templates || !Array.isArray(templates)) return res.json({ success: false, error: 'Templates inválidos' });
      
      for (const t of templates) {
        if (t.restaurar) {
          if (isPostgres) {
            await query("DELETE FROM sistema_config WHERE chave = $1 OR chave = $2 OR chave = $3", [`fcm_title_${t.evento}`, `fcm_body_${t.evento}`, `fcm_sound_${t.evento}`]);
          } else {
            await query("DELETE FROM sistema_config WHERE chave = ? OR chave = ? OR chave = ?", [`fcm_title_${t.evento}`, `fcm_body_${t.evento}`, `fcm_sound_${t.evento}`]);
          }
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

  // POST /api/fcm-config/salvar-custom
  router.post('/fcm-config/salvar-custom', ensureDbInitialized, isAdmin, async (req, res) => {
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

      const valorFinal = JSON.stringify(lista);
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('fcm_custom_events', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valorFinal]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('fcm_custom_events', ?)", [valorFinal]);
      }

      res.json({ success: true, lista });
    } catch (error) { 
      res.json({ success: false, error: 'Erro ao salvar evento customizado', detalhes: error.message }); 
    }
  });

  // GET /api/toast-config/listar
  router.get('/toast-config/listar', ensureDbInitialized, async (req, res) => {
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
          texto: (customText !== undefined && customText !== null && customText !== '') ? customText : d.textoPadrao,
          ativo: (customEnabled !== undefined && customEnabled !== null) ? customEnabled === 'true' : true,
          som: (customSound !== undefined && customSound !== null) ? customSound === 'true' : true
        };
      });

      res.json({ success: true, templates });
    } catch (error) {
      res.json({ success: false, error: 'Falha ao buscar configurações de Toasts', detalhes: error.message });
    }
  });

  // POST /api/toast-config/salvar
  router.post('/toast-config/salvar', ensureDbInitialized, isAdmin, async (req, res) => {
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

  // POST /api/toast-config/restaurar/:evento
  router.post('/toast-config/restaurar/:evento', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const { evento } = req.params;
      if (isPostgres) {
        await query("DELETE FROM sistema_config WHERE chave = $1 OR chave = $2 OR chave = $3", [`toast_text_${evento}`, `toast_enabled_${evento}`, `toast_sound_${evento}`]);
      } else {
        await query("DELETE FROM sistema_config WHERE chave = ? OR chave = ? OR chave = ?", [`toast_text_${evento}`, `toast_enabled_${evento}`, `toast_sound_${evento}`]);
      }
      if (typeof safePusherTrigger !== 'undefined') {
        await safePusherTrigger('garconnexpress', 'toast-config-atualizado', {});
      }
      res.json({ success: true });
    } catch (error) {
      res.json({ success: false, error: 'Erro ao restaurar padrão de Toast', detalhes: error.message });
    }
  });

  // POST /api/toast-config/testar
  router.post('/toast-config/testar', ensureDbInitialized, isAdmin, async (req, res) => {
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

  // GET /api/debug/push-subs
  router.get('/debug/push-subs', isAdmin, ensureDbInitialized, async (req, res) => {
    try {
      const subs = await query("SELECT id, garcom_id, endpoint, app_type, is_native, created_at FROM push_subscriptions ORDER BY id DESC LIMIT 50");
      res.json({ total: subs.rows.length, subs: subs.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
