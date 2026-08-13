const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    isAuthenticated,
    safePusherTrigger,
    formatarNomeMesaOuComanda,
    getTaxaServicoMultiplicador,
    sendWhatsAppMessage,
    isPostgres,
    jwt,
    JWT_SECRET
  } = ctx;

  const router = express.Router();

  // POST /api/cliente/solicitar-conta
  router.post('/solicitar-conta', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role !== 'cliente') return res.status(403).json({ error: 'Acesso negado.' });

      const mesaId = decoded.mesa_id;
      
      const pedido = (await query("SELECT id, mesa_id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [mesaId])).rows[0];
      if (!pedido) return res.status(404).json({ error: 'Nenhum pedido ativo encontrado para esta mesa.' });

      // TRAVA DE SEGURANÇA: Verifica se existem itens pendentes de entrega
      const itensPendentes = (await query(`
        SELECT id FROM pedido_itens 
        WHERE pedido_id = ? 
        AND status NOT IN ('entregue', 'servido', 'cancelado')
      `, [pedido.id])).rows;

      if (itensPendentes.length > 0) {
        return res.status(400).json({ 
          error: 'PENDENCIAS_ENTREGA', 
          mensagem: 'Você ainda tem itens em preparo ou entrega. Aguarde o recebimento de todos para pedir a conta.' 
        });
      }

      await query("UPDATE pedidos SET solicitou_fechamento = TRUE, fechamento_solicitado_em = COALESCE(fechamento_solicitado_em, CURRENT_TIMESTAMP) WHERE id = ?", [pedido.id]);
      await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesaId]); 

      const mesaRes = await query("SELECT numero, is_comanda FROM mesas WHERE id = ?", [mesaId]);
      const isCom = mesaRes.rows[0]?.is_comanda;
      const fmtFn = formatarNomeMesaOuComanda || ((n) => n || 'BALCÃO');
      const mesaNum = fmtFn(mesaRes.rows[0]?.numero, isCom);

      await safePusherTrigger('garconnexpress', 'solicitacao-fechamento-cliente', {
        pedido_id: pedido.id,
        mesa_id: mesaId,
        mesa_numero: mesaNum,
        is_comanda: isCom,
        mensagem: `🙋‍♂️ ${mesaNum} solicitou o fechamento da conta!`
      });

      res.json({ success: true });
    } catch (error) {
      console.error('❌ ERRO EM /api/cliente/solicitar-conta:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/cliente/meus-pedidos
  router.post('/meus-pedidos', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });

    try {
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (e) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      }

      if (decoded.role !== 'cliente') {
        return res.status(403).json({ error: 'Acesso negado.' });
      }

      const mesaId = decoded.mesa_id;
      const acessoId = decoded.acesso_id;

      // Limpeza de rascunhos expirados por inatividade (> 5 min)
      const cincoMinutosAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const rascunhosExpirados = (await query(`
        SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho' AND created_at < ?
      `, [mesaId, cincoMinutosAtras])).rows;
      
      if (rascunhosExpirados.length > 0) {
        for (const r of rascunhosExpirados) {
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
        }
        safePusherTrigger('garconnexpress', 'rascunho-cancelado', { mesa_id: mesaId }).catch(console.error);
      }

      const acesso = (await query("SELECT id, status, criado_at, mesa_id FROM codigos_acesso WHERE id = ?", [acessoId])).rows[0];
      if (!acesso) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

      const mesaAtual = (await query("SELECT status FROM mesas WHERE id = ?", [mesaId])).rows[0];
      const mesaStatus = mesaAtual ? mesaAtual.status : 'livre';

      const pedidosSessao = (await query(`
        SELECT id, total, status, cobrar_taxa, desconto, acrescimo, solicitou_fechamento, fechamento_solicitado_em, fechamento_liberado 
        FROM pedidos 
        WHERE mesa_id = ? 
        AND (
          status NOT IN ('entregue', 'cancelado')
          OR 
          (status = 'entregue' AND created_at >= ?)
        )
        ORDER BY id ASC
      `, [mesaId, acesso.criado_at])).rows;

      if (pedidosSessao.length === 0) {
        return res.json({ success: true, pedido: null, itens: [] });
      }

      const pedidoIds = pedidosSessao.map(p => p.id);
      const placeholders = pedidoIds.map(() => '?').join(',');
      const itens = (await query(`
        SELECT pi.*, m.nome as menu_nome, m.imagem as menu_imagem, m.preco as menu_preco
        FROM pedido_itens pi
        JOIN menu m ON pi.menu_id = m.id
        WHERE pi.pedido_id IN (${placeholders})
        AND pi.status != 'cancelado'
        ORDER BY pi.id DESC
      `, pedidoIds)).rows;

      const ultimoPedido = pedidosSessao[pedidosSessao.length - 1];
      const temPendente = pedidosSessao.some(p => p.status === 'rascunho') || itens.some(i => i.status === 'rascunho');

      let totalReal = 0;
      itens.forEach(i => {
        const preco = i.preco || i.menu_preco || 0;
        totalReal += (i.quantidade * preco);
      });

      const cobrarTaxa = pedidosSessao.some(p => p.cobrar_taxa === 1 || p.cobrar_taxa === true);
      if (cobrarTaxa) {
        const taxaMultiplicador = getTaxaServicoMultiplicador ? await getTaxaServicoMultiplicador() : 1.10;
        totalReal = Math.round(totalReal * taxaMultiplicador * 100) / 100;
      }

      const pedidoConsolidado = {
        ...ultimoPedido,
        total: totalReal,
        cobrar_taxa: cobrarTaxa
      };

      res.json({
        success: true,
        pedido: pedidoConsolidado,
        itens,
        tem_pendente: temPendente,
        mesaStatus: mesaStatus
      });

    } catch (error) {
      console.error('❌ ERRO EM /api/cliente/meus-pedidos:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/cliente/chamar-garcom
  router.post('/chamar-garcom', isAuthenticated, async (req, res) => {
    const mesa_id = req.user.role === 'cliente' ? req.user.mesa_id : req.body.mesa_id;
    const mesa_numero = req.user.role === 'cliente' ? req.user.mesa_numero : req.body.mesa_numero;
    try {
      await safePusherTrigger('garconnexpress', 'chamado-garcom', {
        mesa_id,
        mesa_numero,
        mensagem: `🛎️ MESA ${mesa_numero} solicitou atendimento!`
      });
      
      if (sendWhatsAppMessage) {
        await sendWhatsAppMessage(`🛎️ *CHAMADO DE MESA*\n📍 Mesa: ${mesa_numero}\n🙋‍♂️ O cliente solicitou atendimento imediato.`).catch(e => console.error('Erro Wpp Chamado:', e.message));
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/cliente/enviar-rascunho
  router.post('/enviar-rascunho', isAuthenticated, async (req, res) => {
    const { itens } = req.body;
    if (!itens || itens.length === 0) {
      return res.status(400).json({ error: 'Carrinho vazio. Adicione pelo menos um item.' });
    }

    const mesa_id = req.user.role === 'cliente' ? req.user.mesa_id : req.body.mesa_id;
    const mesa_numero = req.user.role === 'cliente' ? req.user.mesa_numero : req.body.mesa_numero;
    try {
      if (mesa_id) {
        const cincoMinutosAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const rascunhosExpirados = (await query(`
          SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho' AND created_at < ?
        `, [mesa_id, cincoMinutosAtras])).rows;
        for (const r of rascunhosExpirados) {
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
        }
      }

      if (mesa_id) {
        const mesaObj = (await query("SELECT status FROM mesas WHERE id = ?", [mesa_id])).rows[0];
        if (mesaObj && (mesaObj.status === 'fechando' || mesaObj.status === 'aguardando_fechamento')) {
          return res.status(403).json({ 
            error: 'CONTA_SOLICITADA',
            mensagem: 'Você já solicitou o fechamento da conta para esta mesa. Se deseja pedir novos itens, por favor, chame o garçom.' 
          });
        }
      }

      const pendentes = await query(`
        SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'
      `, [mesa_id]);

      if (pendentes.rows.length > 0) {
        return res.status(403).json({ 
          error: 'PENDENTE', 
          mensagem: 'Ops! Você já enviou um pedido que está aguardando a confirmação do garçom. Por favor, aguarde ele confirmar este primeiro pedido para poder enviar novos itens. Obrigado pela paciência!' 
        });
      }

      const itensPendentesEntrega = await query(`
        SELECT COUNT(pi.id) as qtd
        FROM pedido_itens pi
        JOIN pedidos p ON pi.pedido_id = p.id
        WHERE p.mesa_id = ? AND pi.status NOT IN ('entregue', 'servido', 'cancelado', 'rascunho')
      `, [mesa_id]);

      const qtdPendentesEntrega = itensPendentesEntrega.rows[0] ? Number(itensPendentesEntrega.rows[0].qtd) : 0;
      if (qtdPendentesEntrega > 0) {
        return res.status(403).json({
          error: 'PENDENTE_ENTREGA',
          mensagem: 'Você possui itens em preparo ou aguardando entrega na cozinha. Aguarde a entrega desses itens para poder fazer um novo pedido.'
        });
      }

      let pedidoRascunhoId;
      const agora = new Date().toISOString();
      if (isPostgres) {
        const resR = await query('INSERT INTO pedidos (mesa_id, total, status, created_at, observacao) VALUES (?, ?, ?, ?, ?) RETURNING id', 
          [mesa_id, 0, 'rascunho', agora, 'RASCUNHO CLIENTE']);
        pedidoRascunhoId = resR.rows[0].id;
      } else {
        const resR = await query('INSERT INTO pedidos (mesa_id, total, status, created_at, observacao) VALUES (?, ?, ?, ?, ?)', 
          [mesa_id, 0, 'rascunho', agora, 'RASCUNHO CLIENTE']);
        pedidoRascunhoId = resR.lastInsertRowid;
      }

      if (itens.length > 0) {
        const placeholders = itens.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const values = [];
        for (const item of itens) {
          values.push(pedidoRascunhoId, item.menu_id, item.quantidade, '', 'rascunho');
        }
        await query(`INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES ${placeholders}`, values);
      }

      const itensFormatados = itens.map(i => `${i.quantidade}x ${i.nome}`).join('\n');
      const msg = `📝 RASCUNHO RECEBIDO - MESA ${mesa_numero}\n${itensFormatados}`;

      await safePusherTrigger('garconnexpress', 'rascunho-recebido', {
        mesa_id,
        mesa_numero,
        itens,
        pedido_id: pedidoRascunhoId,
        mensagem: msg
      });

      if (sendWhatsAppMessage) {
        await sendWhatsAppMessage(`📝 *RASCUNHO DE PEDIDO*\n📍 Mesa: ${mesa_numero}\n\n${itensFormatados}\n\n⚠️ _Aguardando confirmação do garçom._`).catch(e => console.error('Erro Wpp Rascunho:', e.message));
      }

      res.json({ success: true, pedido_id: pedidoRascunhoId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/cliente/cancelar-rascunho
  router.post('/cancelar-rascunho', isAuthenticated, async (req, res) => {
    const mesa_id = req.user.role === 'cliente' ? req.user.mesa_id : req.body.mesa_id;
    if (!mesa_id) return res.status(400).json({ error: 'Mesa não identificada.' });

    try {
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesa_id])).rows;
      if (rascunhos.length === 0) {
        return res.status(403).json({ 
          error: 'PEDIDO_JA_ACEITO',
          mensagem: 'O garçom já aceitou o seu pedido! Não é mais possível cancelá-lo.' 
        });
      }
      for (const r of rascunhos) {
        await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
        await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }
      
      safePusherTrigger('garconnexpress', 'rascunho-cancelado', { mesa_id }).catch(console.error);
      
      res.json({ success: true, mensagem: 'Rascunho cancelado com sucesso.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
