const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    ensureDbInitialized,
    isAdmin,
    safePusherTrigger,
    isPostgres
  } = ctx;

  const router = express.Router();

  // GET /api/menu
  router.get('/', ensureDbInitialized, async (req, res) => {
    try {
      const { admin, garcom } = req.query;
      let querySql = 'SELECT * FROM menu';

      if (admin !== 'true') {
        const visivelValue = isPostgres ? 'TRUE' : '1';
        if (garcom === 'true') {
          querySql += ` WHERE visivel = ${visivelValue}`;
        } else {
          querySql += ` WHERE visivel = ${visivelValue} AND (estoque = -1 OR (estoque IS NOT NULL AND estoque > 0))`;
        }
      }

      querySql += ' ORDER BY categoria ASC, nome ASC';

      const menuRes = await query(querySql);
      let menu = menuRes.rows;

      if (admin !== 'true' && garcom !== 'true') {
        menu = menu.filter(item => {
          const est = parseInt(item.estoque);
          return item.visivel && (est === -1 || est > 0);
        });
      }

      let ordem = null;
      if (ctx.cachedOrdemCategorias) {
        ordem = ctx.cachedOrdemCategorias;
      } else {
        const ordemRes = await query("SELECT valor FROM sistema_config WHERE chave = 'ordem_categorias'");
        if (ordemRes.rows.length > 0 && ordemRes.rows[0].valor) {
          try {
            ordem = JSON.parse(ordemRes.rows[0].valor).map(c => c.trim().toUpperCase());
            ctx.cachedOrdemCategorias = ordem;
          } catch (e) {
            console.error("Erro ao fazer parse de ordem_categorias:", e.message);
          }
        }
      }

      if (ordem && ordem.length > 0) {
        menu.sort((a, b) => {
          const catA = (a.categoria || '').trim().toUpperCase();
          const catB = (b.categoria || '').trim().toUpperCase();
          const indexA = ordem.indexOf(catA);
          const indexB = ordem.indexOf(catB);
          if (indexA !== -1 && indexB !== -1) {
            if (indexA !== indexB) return indexA - indexB;
          } else if (indexA !== -1) {
            return -1;
          } else if (indexB !== -1) {
            return 1;
          } else {
            const comp = catA.localeCompare(catB);
            if (comp !== 0) return comp;
          }
          return (a.nome || '').localeCompare(b.nome || '');
        });
      }

      res.json(menu);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/menu/:id/ficha-tecnica
  router.get('/:id/ficha-tecnica', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const ficha = (await query(
        `SELECT ft.id, ft.ingrediente_id, ft.quantidade, ft.unidade,
                m.nome AS ingrediente_nome, m.estoque AS ingrediente_estoque, m.unidade AS ingrediente_unidade
         FROM ficha_tecnica ft
         JOIN menu m ON ft.ingrediente_id = m.id
         WHERE ft.menu_id = ?`,
        [id]
      )).rows;
      res.json(ficha);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/menu/:id/ficha-tecnica
  router.post('/:id/ficha-tecnica', isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { itens } = req.body;
      await query('DELETE FROM ficha_tecnica WHERE menu_id = ?', [id]);
      if (Array.isArray(itens) && itens.length > 0) {
        for (const item of itens) {
          const ingredienteId = parseInt(item.ingrediente_id);
          const quantidade = parseFloat(item.quantidade);
          const unidade = item.unidade || 'un';
          if (!ingredienteId || isNaN(quantidade) || quantidade <= 0) continue;
          await query('INSERT INTO ficha_tecnica (menu_id, ingrediente_id, quantidade, unidade) VALUES (?, ?, ?, ?)', [id, ingredienteId, quantidade, unidade]);
        }
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/menu/categoria/:categoria
  router.delete('/categoria/:categoria', isAdmin, async (req, res) => {
    const { categoria } = req.params;
    try {
      await query('DELETE FROM menu WHERE UPPER(categoria) = UPPER(?)', [categoria]);
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/menu/categoria/:categoria
  router.put('/categoria/:categoria', isAdmin, async (req, res) => {
    const { categoria } = req.params;
    const { novoNome } = req.body;
    if (!novoNome) return res.status(400).json({ error: 'Novo nome é obrigatório' });
    const nomeLimpo = novoNome.trim();
    try {
      await query('UPDATE menu SET categoria = ? WHERE UPPER(categoria) = UPPER(?)', [nomeLimpo, categoria]);

      const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
      if (configRes.rows.length > 0 && configRes.rows[0].valor) {
        let categoriasCozinha = JSON.parse(configRes.rows[0].valor);
        let alterouConfig = false;
        categoriasCozinha = categoriasCozinha.map(cat => {
          if (cat.toUpperCase() === categoria.toUpperCase()) { alterouConfig = true; return nomeLimpo; }
          return cat;
        });
        if (alterouConfig) {
          const novoValorConfig = JSON.stringify(categoriasCozinha);
          if (isPostgres) {
            await query("UPDATE sistema_config SET valor = ? WHERE chave = 'categorias_cozinha'", [novoValorConfig]);
          } else {
            await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?)", [novoValorConfig]);
          }
        }
      }

      const configResChurr = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_churrasco'");
      if (configResChurr.rows.length > 0 && configResChurr.rows[0].valor) {
        let categoriasChurrasco = JSON.parse(configResChurr.rows[0].valor);
        let alterouConfigChurr = false;
        categoriasChurrasco = categoriasChurrasco.map(cat => {
          if (cat.toUpperCase() === categoria.toUpperCase()) { alterouConfigChurr = true; return nomeLimpo; }
          return cat;
        });
        if (alterouConfigChurr) {
          const novoValorConfig = JSON.stringify(categoriasChurrasco);
          if (isPostgres) {
            await query("UPDATE sistema_config SET valor = ? WHERE chave = 'categorias_churrasco'", [novoValorConfig]);
          } else {
            await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_churrasco', ?)", [novoValorConfig]);
          }
        }
      }

      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) {
      console.error('Erro ao renomear categoria:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/menu/:id
  router.put('/:id', isAdmin, async (req, res) => {
    const { nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, enviar_churrasco, visivel, em_promocao, unidade, preco_custo } = req.body;
    const valPreco = parseFloat(preco) || 0;
    const valPrecoOriginal = parseFloat(preco_original) || 0;
    const custo = parseFloat(preco_custo) || 0;
    if (valPreco < 0 || valPrecoOriginal < 0 || custo < 0) return res.status(400).json({ error: 'Preço, preço original ou custo não podem ser negativos.' });
    const dataValidade = validade && validade.trim() !== "" ? validade : null;
    const envCozinha = enviar_cozinha !== undefined && enviar_cozinha !== null ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : null;
    const envChurrasco = enviar_churrasco !== undefined && enviar_churrasco !== null ? (isPostgres ? enviar_churrasco : (enviar_churrasco ? 1 : 0)) : null;
    const isVisivel = visivel !== undefined ? (isPostgres ? visivel : (visivel ? 1 : 0)) : (isPostgres ? true : 1);
    const emPromocao = em_promocao !== undefined ? (isPostgres ? em_promocao : (em_promocao ? 1 : 0)) : (isPostgres ? false : 0);
    const und = unidade || 'un';
    try {
      try {
        await query('UPDATE menu SET nome = ?, categoria = ?, preco = ?, preco_original = ?, descricao = ?, imagem = ?, estoque = ?, validade = ?, enviar_cozinha = ?, enviar_churrasco = ?, visivel = ?, em_promocao = ?, unidade = ?, preco_custo = ? WHERE id = ?', [nome, categoria, valPreco, valPrecoOriginal, descricao, imagem, estoque, dataValidade, envCozinha, envChurrasco, isVisivel, emPromocao, und, custo, req.params.id]);
      } catch (errCol) {
        if (errCol.message && (errCol.message.includes('enviar_churrasco') || errCol.message.includes('no column'))) {
          try {
            if (isPostgres) {
              await query("ALTER TABLE menu ADD COLUMN IF NOT EXISTS enviar_churrasco BOOLEAN DEFAULT FALSE;");
            } else {
              await query("ALTER TABLE menu ADD COLUMN enviar_churrasco BOOLEAN DEFAULT FALSE;");
            }
          } catch(e){}
          await query('UPDATE menu SET nome = ?, categoria = ?, preco = ?, preco_original = ?, descricao = ?, imagem = ?, estoque = ?, validade = ?, enviar_cozinha = ?, enviar_churrasco = ?, visivel = ?, em_promocao = ?, unidade = ?, preco_custo = ? WHERE id = ?', [nome, categoria, valPreco, valPrecoOriginal, descricao, imagem, estoque, dataValidade, envCozinha, envChurrasco, isVisivel, emPromocao, und, custo, req.params.id]);
        } else {
          throw errCol;
        }
      }
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/menu
  router.post('/', isAdmin, async (req, res) => {
    const { nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, enviar_churrasco, visivel, em_promocao, unidade, preco_custo } = req.body;
    const valPreco = parseFloat(preco) || 0;
    const valPrecoOriginal = parseFloat(preco_original) || 0;
    const custo = parseFloat(preco_custo) || 0;
    if (valPreco < 0 || valPrecoOriginal < 0 || custo < 0) return res.status(400).json({ error: 'Preço, preço original ou custo não podem ser negativos.' });
    const envCozinha = enviar_cozinha !== undefined && enviar_cozinha !== null ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : null;
    const envChurrasco = enviar_churrasco !== undefined && enviar_churrasco !== null ? (isPostgres ? enviar_churrasco : (enviar_churrasco ? 1 : 0)) : null;
    const isVisivel = visivel !== undefined ? (isPostgres ? visivel : (visivel ? 1 : 0)) : (isPostgres ? true : 1);
    const emPromocao = em_promocao !== undefined ? (isPostgres ? em_promocao : (em_promocao ? 1 : 0)) : (isPostgres ? false : 0);
    const und = unidade || 'un';
    try {
      let newId = null;
      const doInsert = async () => {
        if (isPostgres) {
          const result = await query('INSERT INTO menu (nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, enviar_churrasco, visivel, em_promocao, unidade, preco_custo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [nome, categoria, valPreco, valPrecoOriginal, descricao, imagem, estoque || -1, validade || null, envCozinha, envChurrasco, isVisivel, emPromocao, und, custo]);
          return result.rows && result.rows[0] ? result.rows[0].id : null;
        } else {
          const result = await query('INSERT INTO menu (nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, enviar_churrasco, visivel, em_promocao, unidade, preco_custo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [nome, categoria, valPreco, valPrecoOriginal, descricao, imagem, estoque || -1, validade || null, envCozinha, envChurrasco, isVisivel, emPromocao, und, custo]);
          return result.lastInsertRowid || result.lastID || null;
        }
      };

      try {
        newId = await doInsert();
      } catch (errCol) {
        if (errCol.message && (errCol.message.includes('enviar_churrasco') || errCol.message.includes('no column'))) {
          try {
            if (isPostgres) {
              await query("ALTER TABLE menu ADD COLUMN IF NOT EXISTS enviar_churrasco BOOLEAN DEFAULT FALSE;");
            } else {
              await query("ALTER TABLE menu ADD COLUMN enviar_churrasco BOOLEAN DEFAULT FALSE;");
            }
          } catch(e){}
          newId = await doInsert();
        } else {
          throw errCol;
        }
      }

      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true, id: newId });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // DELETE /api/menu/:id
  router.delete('/:id', isAdmin, async (req, res) => {
    try {
      await query('DELETE FROM menu WHERE id = ?', [req.params.id]);
      await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  return router;
};
