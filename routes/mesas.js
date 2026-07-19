const express = require('express');

module.exports = (query, ensureDbInitialized, safePusherTrigger, notifyStatus, checkAndNotifyDelayedOrders, isAdmin, isAuthenticated) => {
  const router = express.Router();

  router.post('/', isAdmin, async (req, res) => { 
    try {
      await query('INSERT INTO mesas (numero) VALUES (?)', [req.body.numero]); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.put('/:id/liberar', isAuthenticated, async (req, res) => { 
    try { 
      const mesaId = req.params.id;
      await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesaId]); 
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesaId]);
      
      // Limpa rascunhos antigos/órfãos da mesa liberada
      await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho')", [mesaId]);
      await query("DELETE FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaId]);

      // Notifica o cliente para encerrar o acesso
      await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesaId}`, { 
        status: 'cancelado',
        mensagem: "Mesa liberada pelo estabelecimento. Seu acesso foi encerrado." 
      });

      await notifyStatus(null, mesaId, 'liberada'); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); } 
  });

  router.delete('/:id', isAdmin, async (req, res) => { 
    try {
      await query('DELETE FROM mesas WHERE id = ?', [req.params.id]); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    if (typeof checkAndNotifyDelayedOrders === 'function') checkAndNotifyDelayedOrders();
    try {
      // Limpa rascunhos antigos de mesas que já estão LIVRES
      await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT p.id FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.status = 'rascunho' AND m.status = 'livre')");
      await query("DELETE FROM pedidos WHERE status = 'rascunho' AND mesa_id IN (SELECT id FROM mesas WHERE status = 'livre')");

      res.json((await query(`
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
          (CASE WHEN m.status != 'livre' AND (SELECT COUNT(id) FROM pedidos WHERE mesa_id = m.id AND status = 'rascunho') > 0 THEN 1 ELSE 0 END) as tem_rascunho
        FROM mesas m
        LEFT JOIN (
          SELECT p1.*
          FROM pedidos p1
          INNER JOIN (
            SELECT mesa_id, MAX(id) as max_id
            FROM pedidos
            WHERE status NOT IN ('entregue', 'cancelado', 'rascunho')
            GROUP BY mesa_id
          ) p2 ON p1.id = p2.max_id
        ) p ON p.mesa_id = m.id
        LEFT JOIN (
          SELECT ca1.*
          FROM codigos_acesso ca1
          INNER JOIN (
            SELECT mesa_id, MAX(id) as max_id
            FROM codigos_acesso
            WHERE status = 'ativo'
            GROUP BY mesa_id
          ) ca2 ON ca1.id = ca2.max_id
        ) ca ON ca.mesa_id = m.id
        ORDER BY m.numero
      `)).rows); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  return router;
};
