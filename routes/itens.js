const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    isAuthenticated,
    safePusherTrigger,
    notifyStatus
  } = ctx;

  const router = express.Router();

  // PUT /api/itens/:id/pronto
  router.put('/:id/pronto', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    try {
      const item = (await query("SELECT pedido_id, menu_id, quantidade, observacao FROM pedido_itens WHERE id = ?", [id])).rows[0];
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });

      const itemExistente = (await query(
        "SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND status = 'entregue' AND (observacao = ? OR (observacao IS NULL AND ? IS NULL)) AND id != ?", 
        [item.pedido_id, item.menu_id, item.observacao, item.observacao, id]
      )).rows[0];

      if (itemExistente) {
        await query("UPDATE pedido_itens SET quantidade = quantidade + ? WHERE id = ?", [item.quantidade, itemExistente.id]);
        await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
      } else {
        await query("UPDATE pedido_itens SET status = 'entregue' WHERE id = ?", [id]);
      }

      const pendentes = (await query("SELECT id FROM pedido_itens WHERE pedido_id = ? AND status IN ('pendente', 'pronto')", [item.pedido_id])).rows;
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

  return router;
};
