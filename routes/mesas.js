const express = require('express');

module.exports = (query, ensureDbInitialized, safePusherTrigger, notifyStatus, checkAndNotifyDelayedOrders, isAdmin, isAuthenticated) => {
  const router = express.Router();

  router.post('/', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    try {
      const numOuNome = String(req.body.numero || '').trim();
      const tipo = String(req.body.tipo || 'mesa').trim();
      if (!numOuNome) return res.status(400).json({ error: 'Informe o número ou nome da mesa/comanda' });

      const ins = await query('INSERT INTO mesas (numero, tipo) VALUES (?, ?)', [numOuNome, tipo]);
      const novaId = ins.rows?.[0]?.id || ins.insertId || null;

      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true, id: novaId, numero: numOuNome, tipo: tipo }); 
    } catch (error) { 
      console.error('❌ ERRO EM POST /api/mesas:', error);
      res.status(500).json({ error: error.message }); 
    }
  });

  router.put('/:id/liberar', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    try { 
      const mesaId = req.params.id;
      await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesaId]); 
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'ativo'", [mesaId]);
      
      // Limpa rascunhos antigos/órfãos da mesa liberada
      await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'rascunho')", [mesaId]);
      await query("DELETE FROM pedidos WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'rascunho'", [mesaId]);

      // Notifica o cliente para encerrar o acesso
      await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesaId}`, { 
        status: 'cancelado',
        mensagem: "Mesa liberada pelo estabelecimento. Seu acesso foi encerrado." 
      });

      await notifyStatus(null, mesaId, 'liberada'); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); } 
  });

  router.delete('/:id', ensureDbInitialized, isAdmin, async (req, res) => { 
    try {
      await query('DELETE FROM mesas WHERE id = ?', [req.params.id]); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.put('/:id', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const mesaId = req.params.id;
      const novoNome = String(req.body.numero || '').trim();
      if (!novoNome) return res.status(400).json({ error: 'Nome inválido' });
      await query('UPDATE mesas SET numero = ? WHERE id = ?', [novoNome, mesaId]);
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    if (typeof checkAndNotifyDelayedOrders === 'function') checkAndNotifyDelayedOrders();
    try {
      // Limpa rascunhos antigos de mesas que já estão LIVRES
      await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT p.id FROM pedidos p JOIN mesas m ON CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) WHERE p.status = 'rascunho' AND m.status = 'livre')");
      await query("DELETE FROM pedidos WHERE status = 'rascunho' AND CAST(mesa_id AS TEXT) IN (SELECT CAST(id AS TEXT) FROM mesas WHERE status = 'livre')");

      const mesasResult = await query(`
        SELECT m.*,
          p.id as pedido_id,
          p.created_at as pedido_created_at,
          COALESCE(p.garcom_id, m.garcom_id) as garcom_id,
          p.status as pedido_status,
          p.solicitou_fechamento as solicitou_fechamento,
          p.fechamento_solicitado_em as fechamento_solicitado_em,
          p.fechamento_liberado as fechamento_liberado,
          p.forma_pagamento as forma_pagamento,
          ca.codigo as codigo_acesso,
          ca.criado_at as codigo_criado_at,
          (CASE WHEN m.status != 'livre' AND (SELECT COUNT(id) FROM pedidos WHERE CAST(mesa_id AS TEXT) = CAST(m.id AS TEXT) AND status = 'rascunho') > 0 THEN 1 ELSE 0 END) as tem_rascunho
        FROM mesas m
        LEFT JOIN (
          SELECT p1.*
          FROM pedidos p1
          INNER JOIN (
            SELECT CAST(mesa_id AS TEXT) as mesa_id_txt, MAX(id) as max_id
            FROM pedidos
            WHERE status NOT IN ('entregue', 'cancelado', 'rascunho')
            GROUP BY CAST(mesa_id AS TEXT)
          ) p2 ON p1.id = p2.max_id
        ) p ON CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT)
        LEFT JOIN (
          SELECT ca1.*
          FROM codigos_acesso ca1
          INNER JOIN (
            SELECT CAST(mesa_id AS TEXT) as mesa_id_txt, MAX(id) as max_id
            FROM codigos_acesso
            WHERE status = 'ativo'
            GROUP BY CAST(mesa_id AS TEXT)
          ) ca2 ON ca1.id = ca2.max_id
        ) ca ON CAST(ca.mesa_id AS TEXT) = CAST(m.id AS TEXT)
      `); 

      const mesasRows = mesasResult.rows || [];
      mesasRows.sort((a, b) => {
        const numA = parseInt(a.numero);
        const numB = parseInt(b.numero);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.numero || '').localeCompare(String(b.numero || ''));
      });

      res.json(mesasRows);
    } catch (error) { 
      console.error('❌ ERRO EM GET /api/mesas:', error);
      res.status(500).json({ error: error.message }); 
    }
  });

  return router;
};
