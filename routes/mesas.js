const express = require('express');

module.exports = (query, ensureDbInitialized, safePusherTrigger, notifyStatus, checkAndNotifyDelayedOrders, isAdmin, isAuthenticated) => {
  const router = express.Router();

  router.post('/', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    try {
      const numOuNome = String(req.body.numero || '').trim();
      const tipo = String(req.body.tipo || 'mesa').trim();
      const isComanda = req.body.is_comanda ? 1 : 0;
      if (!numOuNome) return res.status(400).json({ error: 'Informe o número ou nome da mesa/comanda' });

      // Garante que a coluna is_comanda existe (migração silenciosa)
      try {
        await query("ALTER TABLE mesas ADD COLUMN is_comanda INTEGER DEFAULT 0");
      } catch(e) { /* coluna já existe, ignorar */ }

      let ins;
      try {
        ins = await query('INSERT INTO mesas (numero, tipo, is_comanda) VALUES (?, ?, ?) RETURNING id', [numOuNome, tipo, isComanda]);
      } catch (e) {
        ins = await query('INSERT INTO mesas (numero, tipo, is_comanda) VALUES (?, ?, ?)', [numOuNome, tipo, isComanda]);
      }

      let novaId = ins.rows?.[0]?.id || ins.insertId || null;
      if (!novaId) {
        const fetchRes = await query("SELECT id FROM mesas WHERE numero = ? ORDER BY id DESC LIMIT 1", [numOuNome]);
        novaId = fetchRes.rows?.[0]?.id || null;
      }

      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true, id: novaId, numero: numOuNome, tipo: tipo, is_comanda: isComanda }); 
    } catch (error) { 
      console.error('❌ ERRO EM POST /api/mesas:', error);
      res.status(500).json({ error: error.message }); 
    }
  });

  router.put('/:id/liberar', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    try { 
      const paramId = req.params.id;
      const mRes = await query("SELECT id, numero, is_comanda FROM mesas WHERE CAST(id AS TEXT) = CAST(? AS TEXT) OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [paramId, paramId]);
      const m = mRes.rows[0];

      if (m) {
        if (Number(m.is_comanda) === 1) {
          await query("DELETE FROM mesas WHERE id = ?", [m.id]);
        } else {
          await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [m.id]);
        }
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status = 'ativo'", [m.id, m.numero, paramId]);
        
        // Limpa rascunhos antigos/órfãos da mesa liberada
        await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status = 'rascunho')", [m.id, m.numero]);
        await query("DELETE FROM pedidos WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status = 'rascunho'", [m.id, m.numero]);

        // Notifica o cliente para encerrar o acesso
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${m.id}`, { 
          status: 'cancelado',
          mensagem: "Mesa liberada pelo estabelecimento. Seu acesso foi encerrado." 
        });
        if (m.numero != m.id) {
          await safePusherTrigger('garconnexpress', `deslogar-mesa-${m.numero}`, { 
            status: 'cancelado',
            mensagem: "Mesa liberada pelo estabelecimento. Seu acesso foi encerrado." 
          });
        }
        if (paramId != m.id && paramId != m.numero) {
          await safePusherTrigger('garconnexpress', `deslogar-mesa-${paramId}`, { 
            status: 'cancelado',
            mensagem: "Mesa liberada pelo estabelecimento. Seu acesso foi encerrado." 
          });
        }

        await notifyStatus(null, m.id, 'liberada'); 
      } else {
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'ativo'", [paramId]);
      }

      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); } 
  });

  router.delete('/:id', ensureDbInitialized, isAdmin, async (req, res) => { 
    try {
      const paramId = req.params.id;
      await query('DELETE FROM mesas WHERE id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)', [paramId, paramId]); 
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'ativo'", [paramId]);
      res.json({ success: true }); 
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.put('/:id', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const mesaId = req.params.id;
      const novoNome = String(req.body.numero || '').trim();
      if (!novoNome) return res.status(400).json({ error: 'Nome inválido' });
      await query('UPDATE mesas SET numero = ? WHERE id = ?', [novoNome, mesaId]);
      safePusherTrigger('garconnexpress', 'menu-atualizado', {}).catch(e=>console.error(e));
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    if (typeof checkAndNotifyDelayedOrders === 'function') checkAndNotifyDelayedOrders();
    try {
      // Limpa rascunhos antigos de mesas que já estão LIVRES
      await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT p.id FROM pedidos p JOIN mesas m ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT)) WHERE p.status = 'rascunho' AND m.status = 'livre')");
      await query("DELETE FROM pedidos WHERE status = 'rascunho' AND (CAST(mesa_id AS TEXT) IN (SELECT CAST(id AS TEXT) FROM mesas WHERE status = 'livre') OR CAST(mesa_id AS TEXT) IN (SELECT CAST(numero AS TEXT) FROM mesas WHERE status = 'livre'))");

      // Auto-limpeza de comandas (is_comanda = 1) que já tiveram pedidos, mas cujos pedidos foram todos finalizados/cancelados
      try {
        await query(`
          DELETE FROM mesas 
          WHERE COALESCE(is_comanda, 0) = 1 
          AND id IN (
            SELECT DISTINCT m.id 
            FROM mesas m 
            JOIN pedidos p ON CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT)
          )
          AND id NOT IN (
            SELECT DISTINCT m.id 
            FROM mesas m 
            JOIN pedidos p ON CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT)
            WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho')
          )
          AND id NOT IN (
            SELECT DISTINCT m.id 
            FROM mesas m 
            JOIN codigos_acesso ca ON CAST(ca.mesa_id AS TEXT) = CAST(m.id AS TEXT)
            WHERE ca.status = 'ativo'
          )
        `);

        // Auto-liberação de mesas fixas que ficaram com status 'ocupada' mas não possuem pedidos ativos nem código ativo
        await query(`
          UPDATE mesas 
          SET status = 'livre' 
          WHERE COALESCE(is_comanda, 0) = 0 
          AND status != 'livre'
          AND id NOT IN (
            SELECT DISTINCT m.id 
            FROM mesas m 
            JOIN pedidos p ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT))
            WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho')
          )
          AND id NOT IN (
            SELECT DISTINCT m.id 
            FROM mesas m 
            JOIN codigos_acesso ca ON (CAST(ca.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(ca.mesa_id AS TEXT) = CAST(m.numero AS TEXT))
            WHERE ca.status = 'ativo'
          )
        `);
      } catch (cleanupErr) {
        console.warn('⚠️ [GET /api/mesas] Erro na auto-limpeza de mesas órfãs:', cleanupErr.message);
      }

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
          (CASE WHEN m.status != 'livre' AND (SELECT COUNT(id) FROM pedidos WHERE (CAST(mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(m.numero AS TEXT)) AND status = 'rascunho') > 0 THEN 1 ELSE 0 END) as tem_rascunho
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
        ) p ON (CAST(p.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(p.mesa_id AS TEXT) = CAST(m.numero AS TEXT))
        LEFT JOIN (
          SELECT ca1.*
          FROM codigos_acesso ca1
          INNER JOIN (
            SELECT CAST(mesa_id AS TEXT) as mesa_id_txt, MAX(id) as max_id
            FROM codigos_acesso
            WHERE status = 'ativo'
            GROUP BY CAST(mesa_id AS TEXT)
          ) ca2 ON ca1.id = ca2.max_id
        ) ca ON (CAST(ca.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR CAST(ca.mesa_id AS TEXT) = CAST(m.numero AS TEXT))
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
