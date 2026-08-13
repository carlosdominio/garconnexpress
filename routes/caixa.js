const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    ensureDbInitialized,
    isAdmin,
    safePusherTrigger,
    sendWhatsAppMessage,
    isPostgres,
    jwt,
    JWT_SECRET
  } = ctx;

  const router = express.Router();

  // GET /api/caixa/status
  router.get('/status', ensureDbInitialized, async (req, res) => {
    try {
      const result = await query("SELECT * FROM fluxo_caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1");
      const caixa = result.rows[0];
      if (!caixa) return res.json(null);

      let isUserAdmin = false;
      const token = req.headers.authorization?.split(' ')[1] || req.cookies.admin_token || req.cookies.token;
      if (token && token !== 'null' && token !== 'undefined') {
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          if (decoded.role === 'admin') isUserAdmin = true;
        } catch (err) {}
      }

      if (isUserAdmin) {
        res.json(caixa);
      } else {
        res.json({ id: caixa.id, status: caixa.status, aberto: true });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/caixa/abrir
  router.post('/abrir', isAdmin, async (req, res) => {
    const { valor_inicial } = req.body;
    const valInicialNum = parseFloat(valor_inicial) || 0;
    if (valInicialNum < 0) return res.status(400).json({ error: 'O valor inicial não pode ser negativo.' });
    try {
      const aberto = await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'");
      if (aberto.rows.length > 0) return res.status(400).json({ error: 'Já existe um caixa aberto' });
      const spDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const dataLocal = spDate.getFullYear() + '-' + String(spDate.getMonth() + 1).padStart(2, '0') + '-' + String(spDate.getDate()).padStart(2, '0') + ' ' + String(spDate.getHours()).padStart(2, '0') + ':' + String(spDate.getMinutes()).padStart(2, '0') + ':' + String(spDate.getSeconds()).padStart(2, '0');
      await query("INSERT INTO fluxo_caixa (valor_inicial, status, data_abertura) VALUES (?, 'aberto', ?)", [valInicialNum, dataLocal]);
      await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'aberto' });
      await sendWhatsAppMessage(`💰 *CAIXA ABERTO*\n🕒 Horário: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n💵 Valor Inicial: R$ ${Number(valInicialNum).toFixed(2)}`).catch(e => console.error('Erro Wpp:', e.message));
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Erro ao abrir caixa' }); }
  });

  // POST /api/caixa/fechar
  router.post('/fechar', isAdmin, async (req, res) => {
    const { valor_final, id } = req.body;
    try {
      const pedidosAtivos = await query("SELECT id FROM pedidos WHERE status NOT IN ('entregue', 'cancelado', 'rascunho')");
      if (pedidosAtivos.rows.length > 0) return res.status(400).json({ error: 'Existem pedidos pendentes.' });

      const dadosCaixa = (await query("SELECT * FROM fluxo_caixa WHERE id = ?", [id])).rows[0];
      const spDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const dataLocal = spDate.getFullYear() + '-' + String(spDate.getMonth() + 1).padStart(2, '0') + '-' + String(spDate.getDate()).padStart(2, '0') + ' ' + String(spDate.getHours()).padStart(2, '0') + ':' + String(spDate.getMinutes()).padStart(2, '0') + ':' + String(spDate.getSeconds()).padStart(2, '0');
      await query("UPDATE fluxo_caixa SET valor_final = ?, status = 'fechado', data_fechamento = ? WHERE id = ?", [valor_final, dataLocal, id]);
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE status = 'ativo'");
      await safePusherTrigger('garconnexpress', 'caixa-encerrado', {});
      await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'fechado' });

      if (dadosCaixa) {
        const msgWpp = `🔴 *CAIXA FECHADO*\n🕒 Horário: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n` +
                       `📊 *RESUMO DO DIA:*\n` +
                       `💵 Dinheiro: R$ ${Number(dadosCaixa.total_dinheiro || 0).toFixed(2)}\n` +
                       `💳 Cartão: R$ ${Number(dadosCaixa.total_cartao || 0).toFixed(2)}\n` +
                       `📱 Pix: R$ ${Number(dadosCaixa.total_pix || 0).toFixed(2)}\n` +
                       `📈 Total Vendas: R$ ${Number(dadosCaixa.total_vendas || 0).toFixed(2)}\n` +
                       `🏁 Valor Final: R$ ${Number(valor_final || 0).toFixed(2)}`;
        await sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro Wpp:', e.message));
      }
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Erro ao fechar caixa' }); }
  });

  // POST /api/caixa/movimentacao
  router.post('/movimentacao', isAdmin, async (req, res) => {
    const { caixa_id, tipo, valor, motivo } = req.body;
    const valNum = parseFloat(valor) || 0;

    if (valNum <= 0) return res.status(400).json({ error: 'O valor da movimentação deve ser maior que zero.' });
    if (tipo !== 'sangria' && tipo !== 'suprimento') return res.status(400).json({ error: 'Tipo de movimentação inválido (deve ser sangria ou suprimento).' });

    try {
      const cx = (await query("SELECT id, status, total_dinheiro FROM fluxo_caixa WHERE id = ?", [caixa_id])).rows[0];
      if (!cx) return res.status(404).json({ error: 'Caixa não encontrado.' });
      if (cx.status !== 'aberto') return res.status(400).json({ error: 'Não é possível movimentar um caixa fechado.' });
      if (tipo === 'sangria' && cx.total_dinheiro < valNum) return res.status(400).json({ error: `Saldo em dinheiro insuficiente no caixa. Disponível: R$ ${cx.total_dinheiro.toFixed(2)}` });

      await query("INSERT INTO caixa_movimentacoes (caixa_id, tipo, valor, motivo) VALUES (?, ?, ?, ?)", [caixa_id, tipo, valNum, motivo || '']);
      const operador = tipo === 'sangria' ? '-' : '+';
      await query(`UPDATE fluxo_caixa SET total_dinheiro = total_dinheiro ${operador} ? WHERE id = ?`, [valNum, caixa_id]);
      await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'aberto' });

      const emoji = tipo === 'sangria' ? '📤' : '📥';
      const msgWpp = `${emoji} *MOVIMENTAÇÃO DE CAIXA*\n🕒 Horário: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n📝 Tipo: ${tipo.toUpperCase()}\n💵 Valor: R$ ${valNum.toFixed(2)}\n💬 Motivo: ${motivo || 'Sem observações'}`;
      await sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro Wpp:', e.message));

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/caixa/:id/movimentacoes
  router.get('/:id/movimentacoes', isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      const result = await query("SELECT * FROM caixa_movimentacoes WHERE caixa_id = ? ORDER BY data DESC", [id]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
