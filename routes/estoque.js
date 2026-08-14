const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    isAdmin,
    safePusherTrigger,
    isPostgres
  } = ctx;

  const router = express.Router();

  // POST /api/config/ordem-categorias
  router.post('/config/ordem-categorias', isAdmin, async (req, res) => {
    const { ordem } = req.body;
    try {
      const valor = JSON.stringify(ordem);
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('ordem_categorias', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('ordem_categorias', ?)", [valor]);
      }
      if (ctx) ctx.cachedOrdemCategorias = ordem;
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/relatorios/estoque
  router.get('/relatorios/estoque', isAdmin, async (req, res) => {
    const { inicio, fim } = req.query;
    const dateInicio = inicio ? `${inicio} 00:00:00` : '1970-01-01 00:00:00';
    const dateFim = fim ? `${fim} 23:59:59` : '2999-12-31 23:59:59';
    try {
      const valorEstoqueDetalhadoRes = await query(`SELECT id, nome, categoria, estoque, unidade, preco_custo, preco, (estoque * preco_custo) as custo_total FROM menu WHERE estoque > 0 ORDER BY custo_total DESC`);
      const valorEstoque = valorEstoqueDetalhadoRes.rows.reduce((acc, item) => acc + (parseFloat(item.custo_total) || 0), 0);
      const maisVendidosRes = await query(`SELECT m.id, m.nome, m.categoria, m.unidade, COALESCE(pi.preco, m.preco) as preco, m.preco_custo, SUM(pi.quantidade) as total_vendido, SUM(pi.quantidade * (COALESCE(pi.preco, m.preco) - m.preco_custo)) as lucro_total FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id JOIN pedidos p ON pi.pedido_id = p.id WHERE p.status NOT IN ('cancelado', 'rascunho') AND p.created_at >= ? AND p.created_at <= ? GROUP BY m.id, m.nome, m.categoria, m.unidade, COALESCE(pi.preco, m.preco), m.preco_custo ORDER BY total_vendido DESC`, [dateInicio, dateFim]);
      const produtosParadosRes = await query(`SELECT id, nome, categoria, estoque, unidade, preco_custo FROM menu WHERE estoque > 0 AND id NOT IN (SELECT DISTINCT pi.menu_id FROM pedido_itens pi JOIN pedidos p ON pi.pedido_id = p.id WHERE p.status NOT IN ('cancelado', 'rascunho') AND p.created_at >= ? AND p.created_at <= ?) ORDER BY categoria ASC, nome ASC`, [dateInicio, dateFim]);
      const movimentacoesRes = await query(`SELECT em.id, em.menu_id, em.quantidade, em.tipo, em.motivo, em.criado_at, m.nome as produto_nome, m.unidade as produto_unidade FROM estoque_movimentacoes em JOIN menu m ON em.menu_id = m.id WHERE em.criado_at >= ? AND em.criado_at <= ? ORDER BY em.criado_at DESC LIMIT 200`, [dateInicio, dateFim]);
      const totaisRes = await query(`SELECT em.tipo, SUM(em.quantidade) as total_qtd, SUM(em.quantidade * m.preco_custo) as total_valor FROM estoque_movimentacoes em JOIN menu m ON em.menu_id = m.id WHERE em.criado_at >= ? AND em.criado_at <= ? GROUP BY em.tipo`, [dateInicio, dateFim]);
      res.json({ valorEstoque, valorEstoqueDetalhado: valorEstoqueDetalhadoRes.rows, maisVendidos: maisVendidosRes.rows, produtosParados: produtosParadosRes.rows, movimentacoes: movimentacoesRes.rows, totais: totaisRes.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/estoque/movimentacao
  router.post('/estoque/movimentacao', isAdmin, async (req, res) => {
    const { menu_id, quantidade, tipo, motivo } = req.body;
    const menuId = parseInt(menu_id);
    const qtd = parseFloat(quantidade);
    if (!menuId || isNaN(qtd) || qtd <= 0 || !['entrada', 'perda', 'saida'].includes(tipo)) return res.status(400).json({ error: 'Parâmetros inválidos' });
    try {
      const p = (await query('SELECT estoque, nome FROM menu WHERE id = ?', [menuId])).rows[0];
      if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
      if (p.estoque !== -1) {
        // FUNC-002: Operação atômica — o banco calcula o novo saldo diretamente,
        // evitando race conditions quando dois admins operam simultaneamente.
        const fator = tipo === 'entrada' ? 1 : -1;
        await query(
          'UPDATE menu SET estoque = GREATEST(0, estoque + ?) WHERE id = ? AND estoque != -1',
          [qtd * fator, menuId]
        );
      }
      await query('INSERT INTO estoque_movimentacoes (menu_id, quantidade, tipo, motivo) VALUES (?, ?, ?, ?)', [menuId, qtd, tipo, motivo || (tipo === 'entrada' ? 'Entrada manual' : 'Perda manual')]);
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });


  // POST /api/estoque/resetar-movimentacoes
  router.post('/estoque/resetar-movimentacoes', isAdmin, async (req, res) => {
    try {
      await query("DELETE FROM estoque_movimentacoes");
      await query("DELETE FROM pagamentos");
      await query("DELETE FROM pedido_itens");
      await query("DELETE FROM pedidos");
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      await safePusherTrigger('garconnexpress', 'pedido-atualizado', {});
      res.json({ success: true, message: 'Todo o histórico de estoque, vendas e pagamentos foi resetado com sucesso.' });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  return router;
};
