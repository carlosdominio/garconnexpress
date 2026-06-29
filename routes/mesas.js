const express = require('express');

module.exports = (query, ensureDbInitialized, safePusherTrigger, notifyStatus, checkAndNotifyDelayedOrders) => {
  const router = express.Router();

  router.post('/', async (req, res) => { 
    try {
      await query('INSERT INTO mesas (numero) VALUES (?)', [req.body.numero]); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.put('/:id/liberar', async (req, res) => { 
    try { 
      const mesaId = req.params.id;
      await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesaId]); 
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesaId]);
      
      // Notifica o cliente para encerrar o acesso
      await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesaId}`, { 
        status: 'cancelado',
        mensagem: "Mesa liberada pelo estabelecimento. Seu acesso foi encerrado." 
      });

      await notifyStatus(null, mesaId, 'liberada'); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); } 
  });

  router.delete('/:id', async (req, res) => { 
    try {
      await query('DELETE FROM mesas WHERE id = ?', [req.params.id]); 
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/', ensureDbInitialized, async (req, res) => { 
    if (typeof checkAndNotifyDelayedOrders === 'function') checkAndNotifyDelayedOrders();
    try {
      res.json((await query(`
        SELECT m.*, 
          (SELECT p.id FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_id,
          (SELECT p.created_at FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_created_at, 
          COALESCE(
            (SELECT p.garcom_id FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1),
            m.garcom_id
          ) as garcom_id,
          (SELECT p.status FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_status,
          (SELECT p.solicitou_fechamento FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as solicitou_fechamento,
          (SELECT p.fechamento_solicitado_em FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as fechamento_solicitado_em,
          (SELECT p.fechamento_liberado FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as fechamento_liberado,
          (SELECT ca.codigo FROM codigos_acesso ca WHERE ca.mesa_id = m.id AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1) as codigo_acesso
        FROM mesas m ORDER BY m.numero
      `)).rows); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  return router;
};
