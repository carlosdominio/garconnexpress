const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    ensureDbInitialized,
    isAuthenticated,
    isAdmin,
    safePusherTrigger,
    isPostgres,
    bcrypt,
    saltRounds,
    jwt,
    JWT_SECRET
  } = ctx;

  const router = express.Router();

  // POST /api/logout
  router.post('/logout', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies.garcom_token || req.cookies.admin_token || req.cookies.token;
    if (token && token !== 'null') {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.role === 'garcom') {
          await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isPostgres ? false : 0, decoded.id]);
          console.log(`👋 Garçom ${decoded.usuario} offline.`);
        }
      } catch (e) {
        console.error('Erro ao desativar online no logout:', e.message);
      }
    }
    const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none' };
    res.clearCookie('token', cookieOptions);
    res.clearCookie('admin_token', cookieOptions);
    res.clearCookie('garcom_token', cookieOptions);
    res.json({ success: true });
  });

  // POST /api/garcom/pausar  (mounted at /api/garcom)
  router.post('/garcom/pausar', isAuthenticated, async (req, res) => {
    const { pausado } = req.body;
    if (req.user.role !== 'garcom') return res.status(403).json({ error: 'Apenas garçons podem pausar atendimento.' });
    try {
      const isOnline = pausado ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
      await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isOnline, req.user.id]);
      console.log(`👤 Garçom ${req.user.usuario} agora está ${pausado ? 'PAUSADO' : 'DISPONÍVEL'}.`);
      await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
        garcom_id: req.user.id,
        pausado: pausado
      });
      res.json({ success: true, is_online: !pausado });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/admin/garcons/:id/toggle-status
  router.post('/admin/garcons/:id/toggle-status', isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      const garcom = (await query("SELECT id, is_online FROM garcons WHERE id = ?", [id])).rows[0];
      if (!garcom) return res.status(404).json({ error: 'Garçom não encontrado' });
      const novoStatus = garcom.is_online ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
      await query("UPDATE garcons SET is_online = ? WHERE id = ?", [novoStatus, id]);
      const pausado = novoStatus ? false : true;
      await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
        garcom_id: id,
        pausado: pausado
      });
      res.json({ success: true, is_online: !!novoStatus });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/garcons
  router.get('/garcons', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      const result = await query('SELECT id, nome, usuario, telefone, comissao, is_online FROM garcons ORDER BY nome');
      res.json(result.rows);
    } catch (error) {
      console.error('❌ ERRO NA ROTA /api/garcons:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/garcons
  router.post('/garcons', isAdmin, async (req, res) => {
    try {
      const { nome, usuario, senha, telefone, comissao } = req.body;
      const hashed = await bcrypt.hash(senha || '123', saltRounds);
      await query('INSERT INTO garcons (nome, usuario, senha, telefone, comissao) VALUES (?, ?, ?, ?, ?)', [nome, usuario, hashed, telefone, comissao || 0]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/garcons/:id
  router.put('/garcons/:id', isAdmin, async (req, res) => {
    try {
      const { nome, usuario, senha, telefone, comissao } = req.body;
      if (senha) {
        const hashed = await bcrypt.hash(senha, saltRounds);
        await query('UPDATE garcons SET nome = ?, usuario = ?, senha = ?, telefone = ?, comissao = ? WHERE id = ?', [nome, usuario, hashed, telefone, comissao || 0, req.params.id]);
      } else {
        await query('UPDATE garcons SET nome = ?, usuario = ?, telefone = ?, comissao = ? WHERE id = ?', [nome, usuario, telefone, comissao || 0, req.params.id]);
      }
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // DELETE /api/garcons/:id
  router.delete('/garcons/:id', isAdmin, async (req, res) => {
    try {
      const garcom = await query('SELECT usuario FROM garcons WHERE id = ?', [req.params.id]);
      if (garcom.rows && garcom.rows.length > 0) await query("UPDATE mesas SET status = 'livre', garcom_id = NULL WHERE garcom_id = ?", [garcom.rows[0].usuario]);
      await query('DELETE FROM garcons WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  return router;
};
