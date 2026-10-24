const express = require('express');

module.exports = (query, ensureDbInitialized, safePusherTrigger, notifyStatus, checkAndNotifyDelayedOrders, isAdmin, isAuthenticated) => {
  const router = express.Router();

  router.post('/', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    try {
      const numOuNome = String(req.body.numero || '').trim();
      let tipo = String(req.body.tipo || 'mesa').trim();
      const isComanda = (req.body.is_comanda || tipo === 'comanda' || tipo === 'balcao' || numOuNome.toLowerCase().startsWith('comanda')) ? 1 : 0;
      if (isComanda && tipo === 'mesa') {
        tipo = 'comanda';
      }
      if (!numOuNome) return res.status(400).json({ error: 'Informe o número ou nome da mesa/comanda' });

      // TRAVA DE DUPLICIDADE (Case-insensitive) - Separado por tipo para não colidir mesa física com balcão
      let existing;
      if (tipo === 'balcao') {
        existing = await query('SELECT id, status, tipo FROM mesas WHERE LOWER(CAST(numero AS TEXT)) = LOWER(CAST(? AS TEXT)) AND tipo = ?', [numOuNome, 'balcao']);
      } else {
        existing = await query('SELECT id, status, tipo FROM mesas WHERE LOWER(CAST(numero AS TEXT)) = LOWER(CAST(? AS TEXT)) AND (tipo != ? OR tipo IS NULL)', [numOuNome, 'balcao']);
      }

      if (existing && existing.rows && existing.rows.length > 0) {
        const row = existing.rows[0];
        // Se a mesa/comanda já existe e está livre, aproveita ela imediatamente
        if (row.status === 'livre') {
          await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
          return res.json({ success: true, id: row.id, numero: numOuNome, tipo: row.tipo || tipo, is_comanda: isComanda });
        }
        return res.status(400).json({ error: `Já existe uma ${tipo === 'balcao' ? 'comanda de balcão' : 'mesa'} aberta com esse número ou nome!` });
      }

      let ins;
      try {
        ins = await query("INSERT INTO mesas (numero, tipo, is_comanda, status, created_at) VALUES (?, ?, ?, 'livre', CURRENT_TIMESTAMP) RETURNING id", [numOuNome, tipo, isComanda]);
      } catch (e) {
        try {
          ins = await query("INSERT INTO mesas (numero, tipo, is_comanda, status, created_at) VALUES (?, ?, ?, 'livre', CURRENT_TIMESTAMP)", [numOuNome, tipo, isComanda]);
        } catch (e2) {
          ins = await query("INSERT INTO mesas (numero, tipo, is_comanda, status) VALUES (?, ?, ?, 'livre')", [numOuNome, tipo, isComanda]);
        }
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
      const mRes = await query("SELECT id, numero, tipo, is_comanda FROM mesas WHERE CAST(id AS TEXT) = CAST(? AS TEXT) OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [paramId, paramId]);
      const m = mRes.rows[0];

      if (m) {
        const isCom = (Number(m.is_comanda) === 1) || 
                      (m.tipo && String(m.tipo).toLowerCase().includes('comanda')) || 
                      (m.tipo === 'balcao') ||
                      String(m.numero || '').toLowerCase().startsWith('comanda');

        if (isCom) {
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

  router.put('/:id', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      const mesaId = req.params.id;
      const novoNome = String(req.body.numero || '').trim();
      const pedidoId = req.body.pedido_id;
      if (!novoNome) return res.status(400).json({ error: 'Nome inválido' });

      // 1. Atualiza na tabela mesas por ID ou por número
      await query('UPDATE mesas SET numero = ? WHERE id = ? OR CAST(numero AS TEXT) = CAST(? AS TEXT)', [novoNome, mesaId, mesaId]);

      // 2. Atualiza no pedido específico se fornecido
      if (pedidoId) {
        try {
          await query('UPDATE pedidos SET mesa_numero = ? WHERE id = ?', [novoNome, pedidoId]);
        } catch(e) {}
      }

      // 3. Atualiza nos pedidos ativos desta mesa
      try {
        await query("UPDATE pedidos SET mesa_numero = ? WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_numero AS TEXT) = CAST(? AS TEXT)) AND status NOT IN ('entregue', 'cancelado')", [novoNome, mesaId, mesaId]);
      } catch(e) {}

      safePusherTrigger('garconnexpress', 'menu-atualizado', {}).catch(e => console.error(e));
      res.json({ success: true, numero: novoNome });
    } catch (error) { 
      console.error('❌ Erro ao atualizar nome da mesa/comanda:', error);
      res.status(500).json({ error: error.message }); 
    }
  });

  router.get('/', ensureDbInitialized, isAuthenticated, async (req, res) => { 
    if (typeof checkAndNotifyDelayedOrders === 'function') {
      checkAndNotifyDelayedOrders().catch(err => console.warn('⚠️ Erro background em checkAndNotifyDelayedOrders:', err.message));
    }
    try {
      // Limpeza automática de comandas finalizadas/canceladas ou abandonadas sem itens
      try {
        const comandasLivre = await query("SELECT id, numero, tipo, is_comanda, created_at FROM mesas WHERE status = 'livre' AND (COALESCE(is_comanda, 0) = 1 OR tipo = 'comanda' OR tipo = 'balcao' OR LOWER(CAST(numero AS TEXT)) LIKE 'comanda%')");
        let limpouAlguma = false;

        for (const c of (comandasLivre.rows || [])) {
          // Comandas de balcão NUNCA devem ser deletadas pela rotina automática de órfãs
          if (c.tipo === 'balcao') continue;

          const numTrim = String(c.numero || '').trim();
          // Se for mesa física com número puro (ex: 1 a 100) e não é comanda nem balcão, protege e repara
          if (/^\d+$/.test(numTrim) && c.tipo !== 'comanda' && !numTrim.toLowerCase().startsWith('comanda')) {
            await query("UPDATE mesas SET is_comanda = 0, tipo = 'mesa' WHERE id = ?", [c.id]);
            continue;
          }
          // Para comandas descartáveis:
          const ativos = await query("SELECT id FROM pedidos WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status NOT IN ('entregue', 'cancelado', 'rascunho')", [c.id]);
          const rascunhos = await query("SELECT id FROM pedidos WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'rascunho'", [c.id]);
          const codigos = await query("SELECT id FROM codigos_acesso WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'ativo'", [c.id]);
          const finalizados = await query("SELECT id FROM pedidos WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status IN ('entregue', 'cancelado')", [c.id]);

          const temAtivos = (ativos.rows || []).length > 0;
          const temRascunhos = (rascunhos.rows || []).length > 0;
          const temCodigos = (codigos.rows || []).length > 0;
          const temFinalizados = (finalizados.rows || []).length > 0;

          if (!temAtivos && !temRascunhos && !temCodigos) {
            let deveExcluir = false;

            if (temFinalizados) {
              // Teve pedidos e todos foram entregues ou cancelados -> exclui imediatamente
              deveExcluir = true;
            } else {
              // Comanda criada sem nenhum item:
              // Exclui se foi criada há mais de 5 minutos ou se não tem timestamp registrado (antigas órfãs)
              let criadoHaMinutos = 999;
              if (c.created_at) {
                try {
                  let dStr = String(c.created_at);
                  if (!dStr.endsWith('Z') && dStr.includes('-') && dStr.includes(':')) {
                    dStr = dStr.replace(' ', 'T') + 'Z';
                  }
                  const d = new Date(dStr);
                  const agora = new Date();
                  const diffMs = agora.getTime() - d.getTime();
                  if (!isNaN(diffMs)) {
                    criadoHaMinutos = Math.max(0, Math.floor(diffMs / 60000));
                  }
                } catch (e) {
                  criadoHaMinutos = 999;
                }
              }

              if (criadoHaMinutos >= 5) {
                deveExcluir = true;
              }
            }

            if (deveExcluir) {
              await query("DELETE FROM mesas WHERE id = ?", [c.id]);
              limpouAlguma = true;
            }
          }
        }

        if (limpouAlguma) {
          safePusherTrigger('garconnexpress', 'menu-atualizado', {}).catch(() => {});
        }
      } catch (cleanErr) {
        console.warn('⚠️ Erro não-bloqueante na limpeza de comandas finalizadas:', cleanErr.message);
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

      const mesasRows = (mesasResult.rows || []).map(m => {
        const numTrim = String(m.numero || '').trim();
        if (/^\d+$/.test(numTrim) && m.tipo !== 'comanda' && m.tipo !== 'balcao' && !numTrim.toLowerCase().startsWith('comanda')) {
          if (Number(m.is_comanda) === 1) {
            query("UPDATE mesas SET is_comanda = 0, tipo = 'mesa' WHERE id = ?", [m.id]).catch(() => {});
          }
          m.is_comanda = 0;
          if (!m.tipo || m.tipo === '') m.tipo = 'mesa';
        }
        return m;
      });

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
