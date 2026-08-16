const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    runInTransaction,
    ensureDbInitialized,
    isAuthenticated,
    isAdmin,
    statusLimiter,
    orderLimiter,
    safePusherTrigger,
    notifyStatus,
    checkAndNotifyDelayedOrders,
    sendPushToGarcons,
    notifyDeliveryStatusToBot,
    formatarNomeMesaOuComanda,
    getTaxaServicoMultiplicador,
    abaterEstoquePorFichaTecnica,
    retornarEstoquePorFichaTecnica,
    verificarEstoqueDisponivel,
    checkTemItemCozinha,
    checkTemItemChurrasco,
    getFilterCozinha,
    getFilterChurrasco,
    getFilterPreparo,
    sendWhatsAppMessage,
    isPostgres,
    getWhatsappSocket
  } = ctx;

  const router = express.Router();
  const marcarEntregueLocks = new Set();

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

  // GET /api/pedidos/ativos-detalhado
  router.get('/ativos-detalhado', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      let pedidosRes;
      try {
        pedidosRes = await query(`
          SELECT p.*, CAST(p.created_at AS TEXT) as created_str, CAST(p.fechamento_solicitado_em AS TEXT) as fechamento_str, COALESCE(p.mesa_numero, m.numero) as mesa_numero, m.tipo as mesa_tipo, g.nome as garcom_nome 
          FROM pedidos p 
          LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT))
          LEFT JOIN garcons g ON p.garcom_id = g.usuario
          WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho')
          ORDER BY p.created_at DESC
        `);
      } catch (e) {
        console.warn("Query com fallback em ativos-detalhado:", e.message);
        try {
          if (isPostgres) {
            await query("ALTER TABLE mesas ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'mesa'; ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mesa_numero TEXT; ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS is_comanda INTEGER DEFAULT 0;");
          }
        } catch (migErr) {}
        
        try {
          pedidosRes = await query(`
            SELECT p.*, CAST(p.created_at AS TEXT) as created_str, CAST(p.fechamento_solicitado_em AS TEXT) as fechamento_str, m.numero as mesa_numero, 'mesa' as mesa_tipo, g.nome as garcom_nome 
            FROM pedidos p 
            LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT))
            LEFT JOIN garcons g ON p.garcom_id = g.usuario
            WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho')
            ORDER BY p.created_at DESC
          `);
        } catch (finalErr) {
          pedidosRes = await query(`
            SELECT p.*, CAST(p.created_at AS TEXT) as created_str, CAST(p.fechamento_solicitado_em AS TEXT) as fechamento_str, m.numero as mesa_numero, g.nome as garcom_nome 
            FROM pedidos p 
            LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT))
            LEFT JOIN garcons g ON p.garcom_id = g.usuario
            WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho')
            ORDER BY p.created_at DESC
          `);
        }
      }
      
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

      const pedidoIds = pedidos.map(p => p.id);
      const placeholders = pedidoIds.map(() => '?').join(',');
      const itensRes = await query(`
        SELECT pi.*, m.nome, COALESCE(pi.preco, m.preco) as preco, m.categoria, m.enviar_cozinha, m.imagem
        FROM pedido_itens pi
        JOIN menu m ON pi.menu_id = m.id
        WHERE pi.pedido_id IN (${placeholders})
      `, pedidoIds);

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

  // GET /api/pedidos
  router.get('/', ensureDbInitialized, isAuthenticated, async (req, res) => {
    if (checkAndNotifyDelayedOrders) checkAndNotifyDelayedOrders();
    try {
      let result;
      try {
        result = await query(`SELECT p.*, COALESCE(p.mesa_numero, m.numero) as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status NOT IN ('entregue', 'cancelado') ORDER BY p.created_at DESC`);
      } catch(e) {
        result = await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status NOT IN ('entregue', 'cancelado') ORDER BY p.created_at DESC`);
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/pedidos/cozinha
  router.get('/cozinha', ensureDbInitialized, isAuthenticated, async (req, res) => {
    if (checkAndNotifyDelayedOrders) checkAndNotifyDelayedOrders();
    res.setHeader('X-Debug-Version', '1.0.3');
    try {
      const filterCozinha = await getFilterCozinha();
      let whereClause = `LOWER(pi.status) = 'pendente' AND LOWER(p.status) IN ('recebido', 'aguardando_fechamento', 'pronto')`;

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
          COALESCE(g.nome, p.garcom_id) as garcom_nome,
          mes.numero as mesa_numero
        FROM pedido_itens pi
        JOIN menu m ON pi.menu_id = m.id 
        JOIN pedidos p ON pi.pedido_id = p.id 
        LEFT JOIN mesas mes ON (CAST(p.mesa_id AS TEXT) = CAST(mes.id AS TEXT) OR p.mesa_id = mes.numero) 
        LEFT JOIN garcons g ON p.garcom_id = g.usuario
        WHERE (${whereClause}) AND ${filterCozinha}
        ORDER BY p.created_at ASC
      `);
      
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/pedidos/churrasco
  router.get('/churrasco', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      const filterChurrasco = await getFilterChurrasco();
      let whereClause = `LOWER(pi.status) = 'pendente' AND LOWER(p.status) IN ('recebido', 'aguardando_fechamento', 'pronto')`;

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
          COALESCE(g.nome, p.garcom_id) as garcom_nome,
          mes.numero as mesa_numero
        FROM pedido_itens pi
        JOIN menu m ON pi.menu_id = m.id 
        JOIN pedidos p ON pi.pedido_id = p.id 
        LEFT JOIN mesas mes ON (CAST(p.mesa_id AS TEXT) = CAST(mes.id AS TEXT) OR p.mesa_id = mes.numero) 
        LEFT JOIN garcons g ON p.garcom_id = g.usuario
        WHERE (${whereClause}) AND ${filterChurrasco}
        ORDER BY p.created_at ASC
      `);
      
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/pedidos/:id/pagamentos
  router.get('/:id/pagamentos', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      try {
        const pagamentos = (await query("SELECT * FROM pagamentos WHERE pedido_id = ? ORDER BY data ASC", [id])).rows;
        res.json(pagamentos || []);
      } catch (e) {
        res.json([]);
      }
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/pedidos/historico-detalhado
  router.get('/historico-detalhado', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      let pedidosRes;
      try {
        pedidosRes = await query(`
          SELECT p.*, 
            COALESCE(p.mesa_numero, m.numero) as mesa_numero, 
            COALESCE(p.is_comanda, m.is_comanda) as is_comanda, 
            g.nome as garcom_nome 
          FROM pedidos p 
          LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) 
          LEFT JOIN garcons g ON p.garcom_id = g.usuario 
          WHERE p.status IN ('entregue', 'cancelado') 
          ORDER BY p.created_at DESC 
          LIMIT 50
        `);
      } catch (errCol) {
        if (isPostgres) {
          try {
            await query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mesa_numero TEXT; ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS is_comanda INTEGER DEFAULT 0;");
          } catch(e) {}
        }
        pedidosRes = await query(`
          SELECT p.*, 
            m.numero as mesa_numero, 
            m.is_comanda as is_comanda, 
            g.nome as garcom_nome 
          FROM pedidos p 
          LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) 
          LEFT JOIN garcons g ON p.garcom_id = g.usuario 
          WHERE p.status IN ('entregue', 'cancelado') 
          ORDER BY p.created_at DESC 
          LIMIT 50
        `);
      }
      
      const pedidos = pedidosRes.rows;
      if (pedidos.length === 0) return res.json([]);

      const ids = pedidos.map(p => p.id);
      const idList = ids.join(',');

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

  // GET /api/pedidos/historico
  router.get('/historico', isAuthenticated, async (req, res) => {
    try {
      let result;
      try {
        result = await query(`SELECT p.*, COALESCE(p.mesa_numero, m.numero) as mesa_numero, COALESCE(p.is_comanda, m.is_comanda) as is_comanda, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status IN ('entregue', 'cancelado') ORDER BY p.created_at DESC LIMIT 50`);
      } catch(e) {
        result = await query(`SELECT p.*, m.numero as mesa_numero, m.is_comanda as is_comanda, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status IN ('entregue', 'cancelado') ORDER BY p.created_at DESC LIMIT 50`);
      }
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/pedidos/limpar
  router.delete('/limpar', isAdmin, async (req, res) => {
    try {
      await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE status IN ('entregue', 'cancelado'))");
      await query("DELETE FROM pedidos WHERE status IN ('entregue', 'cancelado')");
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Erro ao limpar: " + error.message }); }
  });

  // GET /api/pedidos/ativo-telefone/:telefone
  router.get('/ativo-telefone/:telefone', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      const { telefone } = req.params;
      const cleanPhone = telefone.replace(/\D/g, '');
      if (!cleanPhone) return res.status(400).json({ error: 'Telefone inválido' });
      const queryStr = `
        SELECT * FROM pedidos 
        WHERE garcom_id = 'DELIVERY' 
          AND status NOT IN ('entregue', 'cancelado') 
          AND (cliente_telefone = ? OR cliente_telefone LIKE ?)
        ORDER BY id DESC LIMIT 1
      `;
      const result = await query(queryStr, [cleanPhone, `%${cleanPhone}`]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Nenhum pedido ativo encontrado' });
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/pedidos/mesa/:mesaId
  router.get('/mesa/:mesaId', isAuthenticated, async (req, res) => { 
    try {
      res.json((await query(`SELECT * FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY created_at DESC LIMIT 1`, [req.params.mesaId])).rows[0] || null); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/pedidos/rascunho/mesa/:mesaId
  router.get('/rascunho/mesa/:mesaId', isAuthenticated, async (req, res) => {
    const mesaId = req.params.mesaId;
    try {
      const rascunho = (await query("SELECT id, mesa_id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho' LIMIT 1", [mesaId])).rows[0];
      if (!rascunho) return res.status(404).json({ error: 'Nenhum rascunho encontrado para esta mesa.' });
      
      const itens = (await query(`
        SELECT pi.quantidade, m.id as menu_id, m.nome
        FROM pedido_itens pi
        JOIN menu m ON pi.menu_id = m.id
        WHERE pi.pedido_id = ? AND pi.status = 'rascunho'
      `, [rascunho.id])).rows;
      
      const rm = await query("SELECT numero FROM mesas WHERE id = ?", [mesaId]);
      const mesa_numero = rm.rows[0] ? rm.rows[0].numero : mesaId;

      res.json({
        mesa_id: Number(mesaId),
        mesa_numero: mesa_numero,
        pedido_id: rascunho.id,
        itens: itens
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/pedidos/:id
  router.get('/:id', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      let result;
      try {
        result = await query(`SELECT p.*, COALESCE(p.mesa_numero, m.numero) as mesa_numero, COALESCE(p.is_comanda, m.is_comanda) as is_comanda, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.id = ?`, [req.params.id]);
      } catch(e) {
        result = await query(`SELECT p.*, m.numero as mesa_numero, m.is_comanda as is_comanda, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.id = ?`, [req.params.id]);
      }
      if (result.rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/pedidos/:id/itens
  router.get('/:id/itens', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    try {
      const pedidoRes = await query("SELECT garcom_id FROM pedidos WHERE id = ?", [req.params.id]);
      if (pedidoRes.rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
      const result = await query(`SELECT pi.*, m.nome, COALESCE(pi.preco, m.preco) as preco, m.categoria, m.enviar_cozinha, m.imagem FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ? ORDER BY pi.status DESC, pi.id ASC`, [req.params.id]);
      res.json(result.rows);
    } catch (error) {
      console.error('Erro ao buscar itens do pedido:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/pedidos/itens/:id
  router.delete('/itens/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    try {
      const item = (await query("SELECT pedido_id, menu_id, quantidade FROM pedido_itens WHERE id = ?", [id])).rows[0];
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
      await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
      const itensRestantes = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [item.pedido_id])).rows;
      if (itensRestantes.length === 0) {
        const pedido = (await query("SELECT mesa_id, m.numero, p.garcom_id FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) WHERE p.id = ?", [item.pedido_id])).rows[0];
        await query("DELETE FROM pedidos WHERE id = ?", [item.pedido_id]);
        if (pedido && pedido.mesa_id) {
          await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
          await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pedido.mesa_id]);
          
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
        const pedidoObj = (await query("SELECT mesa_id FROM pedidos WHERE id = ?", [item.pedido_id])).rows[0];
        if (pedidoObj && pedidoObj.mesa_id) {
          safePusherTrigger('garconnexpress', `item-removido-mesa-${pedidoObj.mesa_id}`, {
            pedido_id: item.pedido_id,
            item_id: id
          }).catch(console.error);
        }
        const temPendente = itensRestantes.some(i => i.status === 'pendente');
        if (!temPendente) { await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [item.pedido_id]); await notifyStatus(item.pedido_id, null, 'servido'); }
        else await notifyStatus(item.pedido_id, null, 'itens_atualizados');
      }
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // DELETE /api/pedidos/:id
  router.delete('/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      const pedido = (await query("SELECT m.id as mesa_id, p.garcom_id, p.status, m.numero FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) WHERE p.id = ?", [id])).rows[0];
      const itens = (await query("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
      
      if (pedido && pedido.status !== 'cancelado' && pedido.status !== 'entregue') {
        for (const item of itens) await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
      }
      
      await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [id]);
      await query("DELETE FROM pagamentos WHERE pedido_id = ?", [id]);
      await query("DELETE FROM pedidos WHERE id = ?", [id]);
      
      if (pedido) {
        if (pedido.status !== 'entregue' && pedido.status !== 'cancelado' && pedido.mesa_id) {
          const checkAtivos = await query("SELECT id FROM pedidos WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status NOT IN ('entregue', 'cancelado', 'rascunho')", [pedido.mesa_id, pedido.numero]);
          if (checkAtivos.rows.length === 0) {
              await query("DELETE FROM mesas WHERE (id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)) AND COALESCE(is_comanda, 0) = 1", [pedido.mesa_id, pedido.numero]);
              await query("UPDATE mesas SET status = 'livre' WHERE id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [pedido.mesa_id, pedido.numero]);
          }
          await query("UPDATE codigos_acesso SET status = 'expirado' WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status = 'ativo'", [pedido.mesa_id, pedido.numero]);

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

  // POST /api/pedidos
  router.post('/', orderLimiter || ((req, res, next) => next()), async (req, res, next) => {
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
      // ── PRÉ-VALIDAÇÕES (fora da transação — leitura rápida sem lock) ──
      const caixaAberto = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
      if (!caixaAberto) return res.status(400).json({ error: 'O CAIXA ESTÁ FECHADO!' });

      if (mesa_id) {
        const mesaObj = (await query("SELECT status, garcom_id FROM mesas WHERE id = ?", [mesa_id])).rows[0];
        if (mesaObj && (mesaObj.status === 'fechando' || mesaObj.status === 'aguardando_fechamento')) {
          return res.status(400).json({ 
            error: 'MESA_OCUPADA', 
            message: 'Esta mesa está em processo de fechamento de conta ou aguardando pagamento.' 
          });
        }

        if (mesaObj && mesaObj.status === 'ocupada' && mesaObj.garcom_id && !isDelivery) {
          const isAdminRole = req.user && req.user.role === 'admin';
          const isClient = req.user && req.user.role === 'cliente';
          if (!isAdminRole && !isClient && mesaObj.garcom_id !== garcom_id) {
              console.log(`🔒 [BLOQUEIO DE ACESSO] Garçom ${garcom_id} tentou acessar a mesa ${mesa_id} que está bloqueada para o garçom ${mesaObj.garcom_id}`);
              return res.status(403).json({
                  error: 'MESA_ATENDIDA_POR_OUTRO',
                  message: `MESA BLOQUEADA! O garçom selecionado na fila (${mesaObj.garcom_id}) deve atender esta mesa.`
              });
          }
        }
      }

      // ── CÁLCULO DE FRETE (fora da transação — chamada externa Nominatim) ──
      let total;
      let taxaEntrega = 0;
      let distKm = 0;
      let subtotalReal = 0;

      if (garcom_id === 'DELIVERY') {
        const configsRows = (await query("SELECT chave, valor FROM sistema_config WHERE chave LIKE 'frete_%'")).rows;
        const cfgMap = {};
        for (const r of configsRows) cfgMap[r.chave] = r.valor;

        const taxaBase = parseFloat(cfgMap['frete_taxa_base']) || 5.00;
        const kmBaseIncluso = parseFloat(cfgMap['frete_km_base_incluso']) || 2.0;
        const valorKmAdicional = parseFloat(cfgMap['frete_valor_km_adicional']) || 1.50;
        const raioMaximo = parseFloat(cfgMap['frete_raio_maximo']) || 15.0;

        const latRestaurante = parseFloat(cfgMap['frete_lat_restaurante']) || -9.6600395;
        const lngRestaurante = parseFloat(cfgMap['frete_lng_restaurante']) || -35.7515460;
        let destLat = parseFloat(req.body.lat_cliente || req.body.lat);
        let destLng = parseFloat(req.body.lng_cliente || req.body.lng);

        if (req.body.taxa_entrega !== undefined && !isNaN(parseFloat(req.body.taxa_entrega))) {
          taxaEntrega = Math.max(0, parseFloat(req.body.taxa_entrega));
        } else {
          if ((isNaN(destLat) || isNaN(destLng)) && (req.body.endereco || req.body.cep)) {
            try {
              const queryStr = req.body.cep || req.body.endereco;
              const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryStr)}&limit=1`, {
                headers: { 'User-Agent': 'GarcomExpress/2.0' }
              });
              if (nomRes.ok) {
                const nomData = await nomRes.json();
                if (nomData && nomData.length > 0) {
                  destLat = parseFloat(nomData[0].lat);
                  destLng = parseFloat(nomData[0].lon);
                }
              }
            } catch (errNom) {
              console.warn('⚠️ Erro ao geolocalizar endereço via Nominatim:', errNom.message);
            }
          }

          if (!isNaN(destLat) && !isNaN(destLng)) {
            const R = 6371;
            const dLat = (destLat - latRestaurante) * Math.PI / 180;
            const dLon = (destLng - lngRestaurante) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(latRestaurante * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distKm = Math.round((R * c * 1.3) * 100) / 100;

            if (distKm > raioMaximo && (!req.user || req.user.role !== 'admin')) {
              return res.status(400).json({ error: `Endereço a ${distKm}km excede o raio máximo de entrega (${raioMaximo} km).` });
            }

            taxaEntrega = taxaBase;
            if (distKm > kmBaseIncluso) {
              taxaEntrega += ((distKm - kmBaseIncluso) * valorKmAdicional);
            }
          } else {
            taxaEntrega = taxaBase;
          }
        }
        taxaEntrega = Math.round(taxaEntrega * 100) / 100;
      }

      // ── Calcula subtotal com preços do banco (pré-transação, não precisa de lock) ──
      for (const item of (itens || [])) {
        if (!item.quantidade || item.quantidade <= 0) {
          return res.status(400).json({ error: `Quantidade inválida (menor ou igual a zero) detectada.` });
        }
        const p = (await query("SELECT nome, estoque, preco FROM menu WHERE id = ?", [item.menu_id])).rows[0];
        if (!p) return res.status(400).json({ error: `Produto não encontrado: ID ${item.menu_id}` });
        const precoOficial = parseFloat(p.preco) || 0;
        item.preco_unitario = precoOficial;
        subtotalReal += (precoOficial * item.quantidade);
      }

      if (isDelivery) {
        total = subtotalReal + taxaEntrega;
      } else {
        const taxaMultiplicador = await getTaxaServicoMultiplicador();
        total = deveCobrarTaxa ? Math.round(subtotalReal * taxaMultiplicador * 100) / 100 : subtotalReal;
      }

      const fPag = forma_pagamento || metodo_pagamento || null;
      const vRec = valor_recebido || 0;
      const vTrc = troco || 0;

      // ── TRANSAÇÃO ATÔMICA: verificação de estoque + INSERT + abate ──
      const { pedidoId } = await runInTransaction(async (tx) => {
        // 1. Re-verificar pedido ativo na mesa (dentro da transação para evitar duplicatas)
        if (mesa_id) {
          const pedidoAtivo = (await tx("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado', 'rascunho')", [mesa_id])).rows[0];
          if (pedidoAtivo) {
            console.log(`🚫 [BLOQUEIO] Tentativa de duplicar pedido na Mesa ${mesa_id}. Pedido ativo detectado: #${pedidoAtivo.id}`);
            throw Object.assign(new Error('Já existe um pedido em andamento para esta mesa. Use a função de adicionar itens.'), { statusCode: 400, errorCode: 'MESA_OCUPADA', pedido_id: pedidoAtivo.id });
          }
        }

        // 2. Verificar e reservar estoque atomicamente (dentro da transação)
        for (const item of (itens || [])) {
          const checagemEstoque = await verificarEstoqueDisponivel(item.menu_id, item.quantidade, tx);
          if (!checagemEstoque.disponivel) {
            throw Object.assign(new Error(checagemEstoque.erro), { statusCode: 400 });
          }
        }

        // 3. Limpar rascunhos
        if (mesa_id) {
          const mesaIdNum = Number(mesa_id);
          const rascunhos = (await tx("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
          for (const r of rascunhos) {
            await tx("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
            await tx("DELETE FROM pedidos WHERE id = ?", [r.id]);
          }
        }

        // 4. INSERT do pedido
        let resPedido;
        const mesaIdNum = mesa_id ? Number(mesa_id) : null;
        if (isPostgres) {
          try {
            resPedido = await tx('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco, taxa_entrega, distancia_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa, observacao || '', cliente_telefone || null, fPag, vRec, vTrc, taxaEntrega, distKm]);
          } catch (errCol) {
            if (errCol.message && (errCol.message.includes('taxa_entrega') || errCol.message.includes('distancia_km'))) {
              await tx("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS taxa_entrega REAL DEFAULT 0; ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS distancia_km REAL DEFAULT 0;");
              resPedido = await tx('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco, taxa_entrega, distancia_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa, observacao || '', cliente_telefone || null, fPag, vRec, vTrc, taxaEntrega, distKm]);
            } else { throw errCol; }
          }
        } else {
          try {
            resPedido = await tx('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco, taxa_entrega, distancia_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa ? 1 : 0, observacao || '', cliente_telefone || null, fPag, vRec, vTrc, taxaEntrega, distKm]);
          } catch (errColSq) {
            if (errColSq.message && (errColSq.message.includes('taxa_entrega') || errColSq.message.includes('distancia_km') || errColSq.message.includes('has no column'))) {
              try { await tx("ALTER TABLE pedidos ADD COLUMN taxa_entrega REAL DEFAULT 0"); } catch(e){}
              try { await tx("ALTER TABLE pedidos ADD COLUMN distancia_km REAL DEFAULT 0"); } catch(e){}
              resPedido = await tx('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco, taxa_entrega, distancia_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa ? 1 : 0, observacao || '', cliente_telefone || null, fPag, vRec, vTrc, taxaEntrega, distKm]);
            } else { throw errColSq; }
          }
        }
        const txPedidoId = resPedido.rows && resPedido.rows[0] ? resPedido.rows[0].id : resPedido.lastInsertRowid;

        // 5. UPDATE mesa e código de acesso
        if (mesa_id) {
          await tx("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesaIdNum]);
          const acessoExistente = (await tx("SELECT id FROM codigos_acesso WHERE mesa_id = ? AND status = 'ativo' LIMIT 1", [mesaIdNum])).rows[0];
          if (!acessoExistente) {
            const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let novoCodigo = '';
            for (let i = 0; i < 4; i++) novoCodigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
            await tx("INSERT INTO codigos_acesso (mesa_id, codigo, status) VALUES (?, ?, 'ativo')", [mesaIdNum, novoCodigo]);
          }
        }

        // 6. INSERT dos itens do pedido
        if (itens && itens.length > 0) {
          const placeholders = itens.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
          const values = [];
          for (const item of itens) {
            values.push(txPedidoId, item.menu_id, item.quantidade, item.observacao || '', 'pendente', item.preco_unitario || 0);
          }
          await tx(`INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status, preco) VALUES ${placeholders}`, values);

          // 7. Abate de estoque (dentro da transação — atômico com o INSERT)
          for (const item of itens) {
            await abaterEstoquePorFichaTecnica(item.menu_id, item.quantidade, tx);
          }
        }

        return { pedidoId: txPedidoId };
      });

      // ── PÓS-TRANSAÇÃO: notificações e eventos (não precisam de atomicidade) ──
      const socket = getWhatsappSocket ? getWhatsappSocket() : null;
      if (garcom_id === 'DELIVERY' && cliente_telefone) {
        const numClean = cliente_telefone.replace(/\D/g, '');
        if (numClean && socket && socket.connected && notifyDeliveryStatusToBot) {
          notifyDeliveryStatusToBot(numClean, 'recebido', pedidoId).catch(console.error);
        }
      }
      if (mesa_id) {
        safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${Number(mesa_id)}`, { success: true }).catch(console.error);
      }

      let mesaNum = 'BALCÃO';
      let isComVal = 0;
      if (mesa_id) { 
        const rm = await query("SELECT numero, is_comanda FROM mesas WHERE id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [mesa_id, mesa_id]); 
        if (rm.rows[0]) {
          mesaNum = rm.rows[0].numero || 'BALCÃO';
          isComVal = rm.rows[0].is_comanda ? 1 : 0;
        }
      } else if (garcom_id === 'DELIVERY') {
        mesaNum = `DELIVERY #${pedidoId}`;
      }

      if (pedidoId) {
        await query("UPDATE pedidos SET mesa_numero = ?, is_comanda = ? WHERE id = ?", [mesaNum, isComVal, pedidoId]).catch(() => {});
      }

      const menuIds = [...new Set((itens || []).map(i => i.menu_id))];
      const menuItemsRes = await query(`SELECT id, nome, enviar_cozinha, categoria FROM menu WHERE id IN (${menuIds.map(() => '?').join(',')})`, menuIds);
      const menuMap = {};
      menuItemsRes.rows.forEach(m => { menuMap[m.id] = m; });

      const itensNomes = (itens || []).map(item => {
        const p = menuMap[item.menu_id];
        return `${item.quantidade}x ${p ? p.nome : 'Item'}`;
      });
      const isDeliv = mesaNum && mesaNum.toString().toUpperCase().startsWith('DELIVERY');
      const isBalcao = !isDeliv && (!mesa_id || mesaNum === 'BALCÃO' || mesaNum.toString().toUpperCase().includes('BALCÃO') || mesaNum.toString().toUpperCase().includes('BALCAO'));
      const localLabel = isDeliv ? mesaNum : (isBalcao ? 'BALCÃO' : (mesaNum.startsWith('Mesa ') || mesaNum.startsWith('Comanda ') ? mesaNum : `Mesa ${mesaNum}`));
      const msgWpp = `🚀 *NOVO PEDIDO #${pedidoId}*\n📍 Local: ${localLabel}\n📝 Itens:\n${itensNomes.join('\n')}\n💰 Total: R$ ${total.toFixed(2)}`;
      
      const temItemCozinha = await checkTemItemCozinha(menuIds);
      const temItemChurrasco = await checkTemItemChurrasco(menuIds);

      await Promise.all([
        notifyStatus(pedidoId, mesa_id, 'recebido', mesaNum),
        safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
        safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesa_id}`, {
          success: true,
          mensagem: "Seu rascunho foi processado pelo garçom!"
        }),
        safePusherTrigger('garconnexpress', 'novo-pedido', {
          para_cozinha: temItemCozinha,
          para_churrasco: temItemChurrasco,
          pedido: { id: pedidoId, mesa_id, mesa_numero: mesaNum, status: 'recebido', garcom_id: garcom_id }
        })
      ]);

      if (sendWhatsAppMessage) sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro WhatsApp:', e.message));

      res.json({ id: pedidoId, success: true });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      const resposta = { error: error.message };
      if (error.errorCode) resposta.errorCode = error.errorCode;
      if (error.pedido_id) resposta.pedido_id = error.pedido_id;
      res.status(statusCode).json(resposta);
    }
  });

  // PUT /api/pedidos/:id/atualizar-itens

  router.put('/:id/atualizar-itens', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { itens: rawItens, observacao } = req.body;
    try {
      // Filtra para manter apenas itens com quantidade > 0 (itens zerados são tratados como excluídos pelo usuário)
      const itens = (rawItens || [])
        .filter(i => i && Number(i.quantidade) > 0)
        .map(i => ({ ...i, quantidade: parseInt(i.quantidade, 10) }));

      const itensAtuais = (await query("SELECT id, menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
      const menuItems = (await query("SELECT id, nome FROM menu")).rows;
      const menuMap = {};
      menuItems.forEach(m => { menuMap[m.id] = m.nome; });
      
      const atuaisMap = {};
      itensAtuais.forEach(i => { atuaisMap[i.menu_id] = (atuaisMap[i.menu_id] || 0) + i.quantidade; });
      
      const novosMap = {};
      (itens || []).forEach(i => { novosMap[i.menu_id] = (novosMap[i.menu_id] || 0) + i.quantidade; });
      
      const adicionados = [];
      const removidos = [];
      for (const menuId in novosMap) {
        const novaQtd = novosMap[menuId];
        const antigaQtd = atuaisMap[menuId] || 0;
        const nomeItem = menuMap[menuId] || `Item #${menuId}`;
        if (antigaQtd === 0) {
          adicionados.push({ nome: nomeItem, qtd: novaQtd });
        } else if (novaQtd > antigaQtd) {
          adicionados.push({ nome: nomeItem, qtd: novaQtd - antigaQtd });
        } else if (novaQtd < antigaQtd) {
          removidos.push({ nome: nomeItem, qtd: antigaQtd - novaQtd });
        }
      }
      for (const menuId in atuaisMap) {
        if (!novosMap[menuId]) {
          const antigaQtd = atuaisMap[menuId];
          const nomeItem = menuMap[menuId] || `Item #${menuId}`;
          removidos.push({ nome: nomeItem, qtd: antigaQtd });
        }
      }

      const substituicoes = [];
      const alteracoes = [];
      for (let i = removidos.length - 1; i >= 0; i--) {
        const rem = removidos[i];
        const addIdx = adicionados.findIndex(a => a.qtd === rem.qtd);
        if (addIdx !== -1) {
          const add = adicionados[addIdx];
          substituicoes.push(`🔄 Item '${rem.nome}' substituído por '${add.nome}' com sucesso!`);
          removidos.splice(i, 1);
          adicionados.splice(addIdx, 1);
        }
      }
      if (removidos.length === 1 && adicionados.length === 1) {
        const rem = removidos[0];
        const add = adicionados[0];
        substituicoes.push(`🔄 ${rem.qtd}x '${rem.nome}' substituído por ${add.qtd}x '${add.nome}' com sucesso!`);
        removidos.splice(0, 1);
        adicionados.splice(0, 1);
      }
      adicionados.forEach(a => { alteracoes.push(`➕ ${a.qtd}x ${a.nome}`); });
      removidos.forEach(r => { alteracoes.push(`➖ ${r.qtd}x ${r.nome}`); });

      const totalAlteracoes = [...substituicoes, ...alteracoes];
      const detalhesEdicao = totalAlteracoes.length > 0 ? totalAlteracoes.join(', ') : null;

      for (const item of itensAtuais) await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
      for (const item of (itens || [])) {
        if (!item.quantidade || item.quantidade <= 0) return res.status(400).json({ error: 'Quantidade inválida (negativa ou zero)' });
        const checagemEstoque = await verificarEstoqueDisponivel(item.menu_id, item.quantidade);
        if (!checagemEstoque.disponivel) {
          for (const itemRoll of itensAtuais) await abaterEstoquePorFichaTecnica(itemRoll.menu_id, itemRoll.quantidade);
          return res.status(400).json({ error: checagemEstoque.erro });
        }
      }
      await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [id]);
      let novoSub = 0;
      if (itens && itens.length > 0) {
        const placeholders = itens.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const values = [];
        for (const item of itens) {
          values.push(id, item.menu_id, item.quantidade, item.observacao || '', item.status || 'pendente');
        }
        await query(`INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES ${placeholders}`, values);

        for (const item of itens) {
          await abaterEstoquePorFichaTecnica(item.menu_id, item.quantidade);
          const pMenu = (await query("SELECT preco FROM menu WHERE id = ?", [item.menu_id])).rows[0];
          if (pMenu) novoSub += (parseFloat(pMenu.preco) * item.quantidade);
        }
      }
      const pedido = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
      const taxaMultiplicador = await getTaxaServicoMultiplicador();
      const total = (pedido && pedido.cobrar_taxa) ? Math.round(novoSub * taxaMultiplicador * 100) / 100 : novoSub;
      
      const temPendente = (itens || []).some(i => i.status === 'pendente' || i.status === 'pronto');
      const novoStatusPedido = temPendente ? 'recebido' : 'servido';
      const agora = new Date().toISOString();
      
      const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
      const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

      if (temPendente) {
        if (statusAnterior !== 'recebido') {
          await query("UPDATE pedidos SET total = ?, status = ?, created_at = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, agora, observacao || '', id]);
        } else {
          await query("UPDATE pedidos SET total = ?, status = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, observacao || '', id]);
        }
        
        const resMesa = await query("SELECT m.numero FROM pedidos p JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) WHERE p.id = ?", [id]);
        const mesaNum = resMesa.rows[0] ? resMesa.rows[0].numero : 'BALCÃO';
        const pMesa = (await query("SELECT garcom_id FROM pedidos WHERE id = ?", [id])).rows[0];

        const temItemCozinha = await checkTemItemCozinha((itens || []).map(i => i.menu_id));
        const temItemChurrasco = await checkTemItemChurrasco((itens || []).map(i => i.menu_id));
        
        await Promise.all([
          notifyStatus(id, null, 'itens_atualizados', null, detalhesEdicao),
          safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
          safePusherTrigger('garconnexpress', 'novo-pedido', { 
            para_cozinha: temItemCozinha,
            para_churrasco: temItemChurrasco,
            is_addition: true,
            pedido: { id: id, mesa_numero: mesaNum, status: 'recebido', garcom_id: pMesa ? pMesa.garcom_id : null } 
          })
        ]);
      } else {
        await query("UPDATE pedidos SET total = ?, status = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, observacao || '', id]);
        await Promise.all([
          notifyStatus(id, null, 'itens_atualizados', null, detalhesEdicao),
          safePusherTrigger('garconnexpress', 'menu-atualizado', {})
        ]);
      }
      res.json({ success: true, detalhes_edicao: detalhesEdicao });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/pedidos/:id/adicionar
  router.put('/:id/adicionar', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { itens, cobrar_taxa, observacao } = req.body;
    try {
      const pOrig = (await query("SELECT mesa_id, garcom_id, cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
      const deveTaxa = cobrar_taxa !== undefined ? cobrar_taxa : (pOrig ? pOrig.cobrar_taxa : true);
      
      if (pOrig && pOrig.garcom_id && pOrig.garcom_id !== 'DELIVERY') {
          const isAdminRole = req.user && req.user.role === 'admin';
          const isClient = req.user && req.user.role === 'cliente';
          const garcom_id = req.user ? (req.user.usuario || req.user.nome) : null;
          if (!isAdminRole && !isClient && pOrig.garcom_id !== garcom_id) {
              return res.status(403).json({
                  error: 'MESA_ATENDIDA_POR_OUTRO',
                  message: `MESA BLOQUEADA! O garçom selecionado na fila (${pOrig.garcom_id}) deve atender esta mesa.`
              });
          }
      }

      const menuIds = [...new Set((itens || []).map(i => i.menu_id))];
      const menuItemsRes = await query(`SELECT id, preco, nome FROM menu WHERE id IN (${menuIds.map(() => '?').join(',')})`, menuIds);
      const menuMap = {};
      menuItemsRes.rows.forEach(m => { menuMap[m.id] = m; });

      for (const item of (itens || [])) {
        if (!item.quantidade || item.quantidade <= 0) {
          return res.status(400).json({ error: `Quantidade inválida (menor ou igual a zero) detectada.` });
        }
        
        const checagemEstoque = await verificarEstoqueDisponivel(item.menu_id, item.quantidade);
        if (!checagemEstoque.disponivel) return res.status(400).json({ error: checagemEstoque.erro });

        const pMenu = menuMap[item.menu_id];
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

      const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
      const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

      if (statusAnterior !== 'recebido') {
        await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', created_at = ?, observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), agora, observacao || '', id]);
      } else {
        await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), observacao || '', id]);
      }
      const pMesa = (await query("SELECT p.mesa_id, p.garcom_id, m.numero FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) WHERE p.id = ?", [id])).rows[0];
      if (pMesa && pMesa.mesa_id) {
        const mesaIdNum = pMesa.mesa_id;
        await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesaIdNum]);

        const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
        for (const r of rascunhos) {
            await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
            await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
        }

        safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesaIdNum}`, { success: true }).catch(console.error);
      }
      
      const mesaNum = pMesa ? pMesa.numero || 'BALCÃO' : 'BALCÃO';
      const temItemCozinha = await checkTemItemCozinha((itens || []).map(i => i.menu_id));
      const temItemChurrasco = await checkTemItemChurrasco((itens || []).map(i => i.menu_id));

      const alteracoes = [];
      for (const item of (itens || [])) {
        const pMenu = menuMap[item.menu_id];
        const nomeItem = pMenu ? pMenu.nome : `Item #${item.menu_id}`;
        alteracoes.push(`➕ ${item.quantidade}x ${nomeItem}`);
      }
      const detalhesEdicao = alteracoes.join(', ');

      await Promise.all([
        notifyStatus(id, null, 'itens_atualizados', null, detalhesEdicao),
        safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
        safePusherTrigger('garconnexpress', 'novo-pedido', { 
          para_cozinha: temItemCozinha,
          para_churrasco: temItemChurrasco,
          is_addition: true,
          garcom_id: pMesa ? (pMesa.garcom_id || 'ADMIN') : 'ADMIN',
          pedido: { id: id, mesa_numero: mesaNum, status: 'recebido', garcom_id: pMesa ? (pMesa.garcom_id || 'ADMIN') : 'ADMIN' } 
        })
      ]);

      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/pedidos/:id/solicitar-fechamento
  router.put('/:id/solicitar-fechamento', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { mesa_id, forma_pagamento, desconto, acrescimo, valor_recebido, troco, total, num_pessoas, valor_por_pessoa, pagamentos_detalhados, cliente_telefone, balcao_imediato } = req.body;
    try {
      let totalFinal = total;
      
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

      await query(`UPDATE pedidos SET status = 'aguardando_fechamento', forma_pagamento = ?, desconto = ?, acrescimo = ?, valor_recebido = ?, troco = ?, total = ?, num_pessoas = ?, valor_por_pessoa = ?, cobrar_taxa = ?, fechamento_liberado = TRUE, fechamento_solicitado_em = COALESCE(fechamento_solicitado_em, CURRENT_TIMESTAMP), pagamentos_detalhados = ?, cliente_telefone = COALESCE(?, cliente_telefone), balcao_imediato = COALESCE(?, balcao_imediato) WHERE id = ?`, 
        [formaPagamentoFinal, desconto || 0, acrescimo || 0, valor_recebido || 0, troco || 0, totalFinal, num_pessoas || 1, valor_por_pessoa || totalFinal, (req.body.cobrar_taxa !== undefined ? (req.body.cobrar_taxa ? 1 : 0) : 1), pagamentosStr, cliente_telefone || null, balcao_imediato ? 1 : 0, id]);
      
      if (mesa_id) await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
      
      await notifyStatus(id, mesa_id, 'aguardando_fechamento');

      if (mesa_id) {
          safePusherTrigger('garconnexpress', `fechamento-liberado-mesa-${mesa_id}`, {
              pedido_id: id,
              mensagem: "Seu cupom de conferência está disponível!"
          }).catch(console.error);
      }

      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/pedidos/:id/pessoas
  router.put('/:id/pessoas', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { num_pessoas } = req.body;
    try {
      const p = (await query("SELECT total FROM pedidos WHERE id = ?", [id])).rows[0];
      const valor_por_pessoa = p ? p.total / (num_pessoas || 1) : 0;
      await query("UPDATE pedidos SET num_pessoas = ?, valor_por_pessoa = ? WHERE id = ?", [num_pessoas || 1, valor_por_pessoa, id]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/pedidos/:id/pagamento-fracao
  router.post('/:id/pagamento-fracao', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { mesa_id, valor_pago, forma_pagamento, num_pessoas_restantes, recebido, troco } = req.body;
    
    try {
      if (valor_pago <= 0) return res.status(400).json({ error: 'Valor de pagamento não pode ser negativo ou zero' });

      const txRes = await runInTransaction(async (tx) => {
        const cxRes = await tx("SELECT id FROM fluxo_caixa WHERE status = 'aberto'", []);
        const cx = cxRes.rows[0];
        if (!cx) return { code: 400, error: 'CAIXA FECHADO' };

        const rec = (recebido !== undefined) ? recebido : valor_pago;
        const trc = (troco !== undefined) ? troco : 0;

        const selectSql = isPostgres ? "SELECT * FROM pedidos WHERE id = $1 FOR UPDATE" : "SELECT * FROM pedidos WHERE id = ?";
        const pOrigRes = await tx(selectSql, [id]);
        const pOrig = pOrigRes.rows[0];
        if (!pOrig) return { code: 404, error: 'PEDIDO NÃO ENCONTRADO' };

        const col = getColPagamento(forma_pagamento);
        await tx(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valor_pago, valor_pago, cx.id]);
        await tx("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valor_pago, forma_pagamento, rec, trc]);

        const novoPagoParcial = (pOrig.pago_parcial || 0) + valor_pago;
        const novoTotalMesa = Math.max(0, pOrig.total - valor_pago);
        const novoValorPessoa = num_pessoas_restantes > 0 ? novoTotalMesa / num_pessoas_restantes : 0;

        await tx("UPDATE pedidos SET total = ?, pago_parcial = ?, num_pessoas = ?, valor_por_pessoa = ? WHERE id = ?", 
          [novoTotalMesa, novoPagoParcial, num_pessoas_restantes, novoValorPessoa, id]);

        return { code: 200, novoTotalMesa };
      });

      if (txRes.error) return res.status(txRes.code).json({ error: txRes.error });

      await notifyStatus(id, mesa_id, 'itens_atualizados');
      
      res.json({ 
        success: true, 
        saldo_restante: txRes.novoTotalMesa 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/pedidos/:id/pagamento-parcial
  router.post('/:id/pagamento-parcial', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { mesa_id, itens, forma_pagamento, total } = req.body;
    try {
      const txRes = await runInTransaction(async (tx) => {
        const cxRes = await tx("SELECT id FROM fluxo_caixa WHERE status = 'aberto'", []);
        const cx = cxRes.rows[0];
        if (!cx) return { code: 400, error: 'CAIXA FECHADO' };

        await tx("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, total, forma_pagamento, total, 0]);

        for (const i of (itens || [])) {
          await tx('DELETE FROM pedido_itens WHERE id = ?', [i.id]);
        }

        const col = getColPagamento(forma_pagamento);
        await tx(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [total, total, cx.id]);

        const restRes = await tx("SELECT id FROM pedido_itens WHERE pedido_id = ?", [id]);
        const rest = restRes.rows;
        if (rest.length === 0) { 
          const mInfo = (await tx("SELECT numero, is_comanda FROM mesas WHERE id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [mesa_id, mesa_id])).rows[0];
          if (mInfo) {
            await tx("UPDATE pedidos SET mesa_numero = ?, is_comanda = ? WHERE id = ?", [mInfo.numero, mInfo.is_comanda ? 1 : 0, id]).catch(() => {});
            if (Number(mInfo.is_comanda) === 1) {
              await tx("DELETE FROM mesas WHERE id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [mesa_id, mesa_id]).catch(() => {});
            } else {
              await tx("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);
            }
          } else {
            await tx("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);
          }
          await tx("UPDATE pedidos SET status = 'entregue', pago_parcial = pago_parcial + ?, total = 0 WHERE id = ?", [total, id]); 
          await tx("UPDATE codigos_acesso SET status = 'expirado' WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR mesa_id = ?) AND status = 'ativo'", [mesa_id, mesa_id]);
          return { code: 200, deslogarMesa: true };
        } else { 
          const pDataRes = await tx("SELECT total, pago_parcial FROM pedidos WHERE id = ?", [id]);
          const pData = pDataRes.rows[0];
          const novoTotal = pData ? Math.max(0, (pData.total || 0) - total) : 0;
          const novoPagoParcial = pData ? ((pData.pago_parcial || 0) + total) : total;
          await tx("UPDATE pedidos SET total = ?, pago_parcial = ? WHERE id = ?", [novoTotal, novoPagoParcial, id]);
          return { code: 200, deslogarMesa: false };
        }
      });

      if (txRes.error) return res.status(txRes.code).json({ error: txRes.error });

      if (txRes.deslogarMesa) {
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
          mensagem: "Sua conta foi finalizada. Obrigado pela preferência!" 
        });
        await notifyStatus(null, mesa_id, 'liberada'); 
      } else {
        await notifyStatus(id, mesa_id, 'itens_atualizados'); 
      }

      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/pedidos/:id/transferir
  router.put('/:id/transferir', isAuthenticated, async (req, res) => {
    if (req.user && req.user.role === 'cliente') return res.status(403).json({ error: 'Acesso negado.' });
    const { id } = req.params;
    const { garcom_id } = req.body;
    try {
      const isGarcomReal = garcom_id && garcom_id !== 'ADMIN' && garcom_id !== 'DELIVERY';
      
      if (isGarcomReal) {
        const todosItens = (await query("SELECT i.quantidade, COALESCE(i.preco, m.preco) as preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE CAST(i.pedido_id AS TEXT) = CAST(? AS TEXT)", [id])).rows;
        const subtotal = todosItens.reduce((sum, i) => sum + ((parseFloat(i.preco) || 0) * i.quantidade), 0);
        const taxaMultiplicador = await getTaxaServicoMultiplicador();
        const total = Math.round(subtotal * taxaMultiplicador * 100) / 100;
        const taxaBanco = isPostgres ? true : 1;
        
        await query("UPDATE pedidos SET garcom_id = ?, total = ?, cobrar_taxa = ? WHERE CAST(id AS TEXT) = CAST(? AS TEXT)", [garcom_id, total, taxaBanco, id]);
      } else {
        await query("UPDATE pedidos SET garcom_id = ? WHERE CAST(id AS TEXT) = CAST(? AS TEXT)", [garcom_id, id]);
      }

      const p = (await query("SELECT mesa_id FROM pedidos WHERE CAST(id AS TEXT) = CAST(? AS TEXT)", [id])).rows[0];
      if (p && p.mesa_id) {
        await query("UPDATE mesas SET garcom_id = ? WHERE CAST(id AS TEXT) = CAST(? AS TEXT)", [garcom_id, p.mesa_id]);
        await notifyStatus(id, p.mesa_id, 'transferido');
      } else {
        await notifyStatus(id, null, 'transferido');
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/pedidos/:id/cozinha-pronto
  router.put('/:id/cozinha-pronto', statusLimiter || ((req, res, next) => next()), isAuthenticated, async (req, res) => {
    const { id } = req.params;
    try {
      const filterCozinha = await getFilterCozinha();
      await query(`
        UPDATE pedido_itens SET status = 'pronto' 
        WHERE pedido_id = ? AND status = 'pendente' 
        AND menu_id IN (
          SELECT id FROM menu m WHERE ${filterCozinha}
        )
      `, [id]);
      
      const itens = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
      const todosProntos = itens.every(i => i.status === 'pronto' || i.status === 'entregue');
      
      if (todosProntos) {
        await query("UPDATE pedidos SET status = 'pronto' WHERE id = ?", [id]);
      }

      const pedido = (await query("SELECT p.garcom_id, p.cliente_telefone, m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) WHERE p.id = ?", [id])).rows[0];
      let mesaExibicao = 'BALCÃO';
      if (pedido) {
        if (pedido.garcom_id === 'DELIVERY') mesaExibicao = `DELIVERY #${id}`;
        else mesaExibicao = pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : 'BALCÃO';
      }
      
      await safePusherTrigger('garconnexpress', 'pedido-pronto', { 
        pedido_id: id, 
        mesa_numero: mesaExibicao,
        garcom_id: pedido ? pedido.garcom_id : null,
        mensagem: `🍳 Pedido ${mesaExibicao} está pronto na Cozinha!` 
      });

      await notifyStatus(id, null, 'pronto');
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/pedidos/:id/churrasco-pronto
  router.put('/:id/churrasco-pronto', statusLimiter || ((req, res, next) => next()), isAuthenticated, async (req, res) => {
    const { id } = req.params;
    try {
      const filterChurrasco = await getFilterChurrasco();
      await query(`
        UPDATE pedido_itens SET status = 'pronto' 
        WHERE pedido_id = ? AND status = 'pendente' 
        AND menu_id IN (
          SELECT id FROM menu m WHERE ${filterChurrasco}
        )
      `, [id]);
      
      const itens = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
      const todosProntos = itens.every(i => i.status === 'pronto' || i.status === 'entregue');
      
      if (todosProntos) {
        await query("UPDATE pedidos SET status = 'pronto' WHERE id = ?", [id]);
      }

      const pedido = (await query("SELECT p.garcom_id, p.cliente_telefone, m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) WHERE p.id = ?", [id])).rows[0];
      let mesaExibicao = 'BALCÃO';
      if (pedido) {
        if (pedido.garcom_id === 'DELIVERY') mesaExibicao = `DELIVERY #${id}`;
        else mesaExibicao = pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : 'BALCÃO';
      }
      
      await safePusherTrigger('garconnexpress', 'pedido-pronto', { 
        pedido_id: id, 
        mesa_numero: mesaExibicao,
        garcom_id: pedido ? pedido.garcom_id : null,
        mensagem: `🍢 Pedido ${mesaExibicao} está pronto no Churrasqueiro!` 
      });

      await notifyStatus(id, null, 'pronto');
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/pedidos/:id/marcar-entregue
  router.put('/:id/marcar-entregue', statusLimiter || ((req, res, next) => next()), isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { apenasProntos, forcarAdmin } = req.body;
    if (marcarEntregueLocks.has(id)) return res.status(429).json({ error: 'Processando requisição anterior, aguarde...' });
    marcarEntregueLocks.add(id);
    try {
      const filterPreparo = await getFilterPreparo();

      if (apenasProntos) {
        await query(`
          UPDATE pedido_itens 
          SET status = 'entregue' 
          WHERE pedido_id = ? 
          AND (status = 'pronto' OR (status = 'pendente' AND menu_id IN (SELECT id FROM menu m WHERE NOT (${filterPreparo}))))
        `, [id]);
      } else {
        if (!forcarAdmin) {
          const prep = await query(`
            SELECT pi.id 
            FROM pedido_itens pi 
            JOIN menu m ON pi.menu_id = m.id 
            WHERE pi.pedido_id = ? 
            AND pi.status = 'pendente' 
            AND (${filterPreparo})
          `, [id]);

          if (prep.rows.length > 0) {
            return res.status(400).json({ 
              error: 'COZINHA_ATIVA', 
              mensagem: `Não é possível entregar tudo! Existem ${prep.rows.length} itens ainda em preparo (Cozinha/Churrasco).` 
            });
          }
        }
        await query("UPDATE pedido_itens SET status = 'entregue' WHERE pedido_id = ? AND status != 'cancelado'", [id]);
      }

      const itens = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
      const todosEntregues = itens.every(i => i.status === 'entregue' || i.status === 'cancelado');
      
      const pedidoObj = (await query("SELECT mesa_id, garcom_id FROM pedidos WHERE id = ?", [id])).rows[0];

      if (todosEntregues) {
        await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [id]);
        await notifyStatus(id, null, 'servido');
      } else {
        await notifyStatus(id, null, 'itens_atualizados');
      }

      if (pedidoObj && pedidoObj.mesa_id) {
        safePusherTrigger('garconnexpress', `item-entregue-mesa-${pedidoObj.mesa_id}`, {
          pedido_id: id,
          todosEntregues
        }).catch(console.error);
      }

      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true, todosEntregues });
    } catch (error) { 
      res.status(500).json({ error: error.message }); 
    } finally {
      marcarEntregueLocks.delete(id);
    }
  });

  // PUT /api/pedidos/:id/taxa
  router.put('/:id/taxa', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { cobrar_taxa } = req.body;
    try {
      const pedidoOriginal = (await query("SELECT p.mesa_id, p.garcom_id, p.taxa_entrega, m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) WHERE p.id = ?", [id])).rows[0];
      const todosItens = (await query("SELECT i.quantidade, COALESCE(i.preco, m.preco) as preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
      const subtotal = todosItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const isDelivery = pedidoOriginal && (pedidoOriginal.garcom_id === 'DELIVERY' || String(pedidoOriginal.mesa_numero).toUpperCase().includes('DELIVERY'));
      const taxaEntrega = isDelivery ? parseFloat(pedidoOriginal.taxa_entrega !== undefined && pedidoOriginal.taxa_entrega !== null ? pedidoOriginal.taxa_entrega : 3.00) : 0;
      const taxaMultiplicador = await getTaxaServicoMultiplicador();
      const total = cobrar_taxa ? (isDelivery ? (subtotal + taxaEntrega) : Math.round(subtotal * taxaMultiplicador * 100) / 100) : subtotal;

      const taxaBanco = isPostgres ? cobrar_taxa : (cobrar_taxa ? 1 : 0);
      await query("UPDATE pedidos SET total = ?, cobrar_taxa = ? WHERE id = ?", [total, taxaBanco, id]);

      const mesaNum = pedidoOriginal ? (pedidoOriginal.mesa_numero || (!pedidoOriginal.mesa_id ? 'Balcão' : pedidoOriginal.mesa_id)) : 'Balcão';

      safePusherTrigger('garconnexpress', 'status-atualizado', {
        pedido_id: id,
        mesa_id: pedidoOriginal ? pedidoOriginal.mesa_id : null,
        mesa_numero: mesaNum,
        garcom_id: pedidoOriginal ? pedidoOriginal.garcom_id : null,
        cobrar_taxa: cobrar_taxa,
        subtotal: subtotal,
        total: total
      }).catch(console.error);

      if (pedidoOriginal && pedidoOriginal.mesa_id) {
        safePusherTrigger('garconnexpress', `taxa-atualizada-mesa-${pedidoOriginal.mesa_id}`, {
          cobrar_taxa: cobrar_taxa,
          subtotal: subtotal,
          total: total,
          pedido_id: id
        }).catch(console.error);
      }

      res.json({ success: true, total });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/pedidos/:id/status
  router.put('/:id/status', statusLimiter || ((req, res, next) => next()), isAuthenticated, async (req, res) => {
    if (req.user && req.user.role === 'cliente') return res.status(403).json({ error: 'Clientes não podem alterar status de pedidos.' });
    const { id } = req.params;
    const { status, pagamentos_detalhados } = req.body;
    try {
      const txResult = await runInTransaction(async (tx) => {
        const selectSql = isPostgres 
          ? "SELECT status, garcom_id, total, forma_pagamento, pago_parcial FROM pedidos WHERE id = $1 FOR UPDATE"
          : "SELECT status, garcom_id, total, forma_pagamento, pago_parcial FROM pedidos WHERE id = ?";
        const prevStatusRes = await tx(selectSql, [id]);
        const p = prevStatusRes.rows[0];

        if (!p) return { code: 404, error: 'Pedido não encontrado' };

        const userRole = req.user ? req.user.role : null;
        const userUsuario = req.user ? (req.user.usuario || req.user.username) : null;
        if (userRole === 'garcom' && p.garcom_id && p.garcom_id !== 'DELIVERY' && p.garcom_id !== 'QRCODE' && p.garcom_id !== userUsuario) {
          return { code: 403, error: 'Acesso negado: você só pode alterar status de pedidos atribuídos a você.' };
        }

        const prevStatus = p.status;
        if (prevStatus === status) return { code: 200, already: true };
        if (status === 'entregue' && ['entregue', 'cancelado'].includes(prevStatus)) {
          return { code: 409, error: 'Pedido já foi finalizado ou cancelado anteriormente.' };
        }

        if (status === 'entregue') {
          const cxRes = await tx("SELECT id FROM fluxo_caixa WHERE status = 'aberto'", []);
          const cx = cxRes.rows[0];
          if (!cx) return { code: 400, error: 'CAIXA FECHADO' };

          if (Array.isArray(pagamentos_detalhados) && pagamentos_detalhados.length > 0) {
            for (const pag of pagamentos_detalhados) {
              let forma = (pag && typeof pag === 'object') ? pag.forma_pagamento : pag;
              let valorParte = (pag && typeof pag === 'object') ? pag.valor : (p.total / pagamentos_detalhados.length);
              let recebido = (pag && typeof pag === 'object') ? (pag.recebido || valorParte) : valorParte;
              let troco = (pag && typeof pag === 'object') ? (pag.troco || 0) : 0;
              
              if (!forma) forma = 'Dinheiro';
              if (!valorParte || isNaN(valorParte)) valorParte = 0;
              if (valorParte < 0) return { code: 400, error: 'Valor fracionado negativo detectado' };

              const col = getColPagamento(forma);
              await tx(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorParte, valorParte, cx.id]);
              await tx("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorParte, forma, recebido, troco]);
            }
          } else {
            const col = getColPagamento(p.forma_pagamento);
            const valorFinal = p.total;
            const pDetalhesRes = await tx("SELECT valor_recebido, troco FROM pedidos WHERE id = ?", [id]);
            const pDetalhes = pDetalhesRes.rows[0];
            const rec = pDetalhes ? pDetalhes.valor_recebido : valorFinal;
            const trc = pDetalhes ? pDetalhes.troco : 0;

            await tx(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorFinal, valorFinal, cx.id]);
            await tx("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorFinal, p.forma_pagamento, rec, trc]);
          }

          await tx("UPDATE pedidos SET pago_parcial = pago_parcial + total, total = 0 WHERE id = ?", [id]);
        }

        if (status === 'entregue' || status === 'cancelado') {
          const resetFlag = isPostgres ? 'FALSE' : '0';
          await tx(`UPDATE pedidos SET status = ?, solicitou_fechamento = ${resetFlag}, notificado_atraso_fechamento = 1 WHERE id = ?`, [status, id]);
        } else {
          await tx('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
        }

        if (status === 'cancelado' && prevStatus !== 'cancelado' && prevStatus !== 'rascunho') {
          const itensRes = await tx("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id]);
          for (const item of itensRes.rows) {
            await retornarEstoquePorFichaTecnica(item.menu_id, item.quantidade);
          }
          await tx("UPDATE pedido_itens SET status = 'cancelado' WHERE pedido_id = ?", [id]);
        }

        return { code: 200, prevStatus };
      });

      if (txResult.error) return res.status(txResult.code).json({ error: txResult.error });
      if (txResult.already) return res.json({ success: true, already: true });

      const pm = (await query("SELECT m.id as mesa_id, p.garcom_id, m.numero, m.is_comanda FROM pedidos p LEFT JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) WHERE p.id = ?", [id])).rows[0];
      const numRaw = pm ? (pm.numero || 'BALCÃO') : 'BALCÃO';
      const isCom = pm ? (pm.is_comanda ? 1 : 0) : 0;
      const fmtFn = formatarNomeMesaOuComanda || ((n) => n || 'BALCÃO');
      const mesaNum = pm ? (pm.garcom_id === 'DELIVERY' ? `DELIVERY #${id}` : fmtFn(numRaw, isCom)) : 'BALCÃO';
      const localStr = mesaNum;

      if ((status === 'cancelado' || status === 'entregue') && pm && pm.mesa_id) {
          const checkAtivos = await query("SELECT id FROM pedidos WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status NOT IN ('entregue', 'cancelado', 'rascunho') AND id != ?", [pm.mesa_id, pm.numero, id]);
          if (checkAtivos.rows.length === 0) {
              await query("UPDATE pedidos SET mesa_numero = ?, is_comanda = ? WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT))", [mesaNum, isCom, pm.mesa_id, pm.numero]).catch(() => {});
              await query("DELETE FROM mesas WHERE (id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)) AND COALESCE(is_comanda, 0) = 1", [pm.mesa_id, pm.numero]);
              await query("UPDATE mesas SET status = 'livre' WHERE id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [pm.mesa_id, pm.numero]);
          }
          await query("UPDATE codigos_acesso SET status = 'expirado' WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status = 'ativo'", [pm.mesa_id, pm.numero]);

          const msgLogout = status === 'entregue' ? "Sua conta foi finalizada. Obrigado pela preferência!" : "Este pedido foi cancelado pelo estabelecimento. Seu acesso foi encerrado.";
          await safePusherTrigger('garconnexpress', `deslogar-mesa-${pm.mesa_id}`, { 
            mensagem: msgLogout,
            status: status,
            mesa_id: pm.mesa_id 
          });
      }

      if (status === 'cancelado') {
        await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
          id: id,
          pedido_id: id, 
          mesa_numero: mesaNum,
          garcom_id: pm ? pm.garcom_id : null,
          mensagem: `🚨 O Pedido #${id} (${localStr}) foi CANCELADO pelo Admin.` 
        });
      }
      
      await notifyStatus(id, pm ? pm.mesa_id : null, status, mesaNum);
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/pedidos/aceitar-rascunho
  router.post('/aceitar-rascunho', isAuthenticated, async (req, res) => {
    const { mesa_id } = req.body;
    if (!mesa_id) return res.status(400).json({ error: 'Mesa não identificada.' });

    try {
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesa_id])).rows;
      for (const r of rascunhos) {
        await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
        await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }
      
      safePusherTrigger('garconnexpress', `rascunho-aceito-mesa-${mesa_id}`, {
        status: 'aceito',
        mensagem: 'Seu pedido foi aceito pelo garçom!'
      }).catch(console.error);
      
      res.json({ success: true, mensagem: 'Rascunho aceito com sucesso.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/pedidos/rejeitar-rascunho
  router.post('/rejeitar-rascunho', isAuthenticated, async (req, res) => {
    const { mesa_id } = req.body;
    if (!mesa_id) return res.status(400).json({ error: 'Mesa não identificada.' });

    try {
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesa_id])).rows;
      for (const r of rascunhos) {
        await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
        await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }
      
      safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesa_id}`, {
        success: false,
        rejeitado: true,
        mensagem: "Seu rascunho foi recusado pelo garçom."
      }).catch(console.error);

      safePusherTrigger('garconnexpress', 'rascunho-cancelado', { mesa_id }).catch(console.error);

      res.json({ success: true, mensagem: 'Rascunho recusado com sucesso.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
