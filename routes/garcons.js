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
      let garcom;
      try {
        garcom = (await query("SELECT id, usuario, cargo, is_online FROM garcons WHERE id = ?", [id])).rows[0];
      } catch (e1) {
        garcom = (await query("SELECT id, usuario, is_online FROM garcons WHERE id = ?", [id])).rows[0];
      }

      if (!garcom) return res.status(404).json({ error: 'Colaborador não encontrado' });
      const novoStatus = garcom.is_online ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
      await query("UPDATE garcons SET is_online = ? WHERE id = ?", [novoStatus, id]);
      const pausado = novoStatus ? false : true;

      // 1. Notifica evento padrão de garçom
      await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
        garcom_id: id,
        pausado: pausado
      });

      // 2. Se for Cozinha ou Churrasqueiro, sincroniza a fila e push_subscriptions em tempo real
      const cargo = (garcom.cargo || '').toLowerCase();
      if (cargo === 'cozinha' || cargo === 'churrasqueiro') {
        try {
          await query("UPDATE push_subscriptions SET pausado = ? WHERE app_type = ?", [pausado ? 1 : 0, cargo]);
        } catch(e) {}
        await safePusherTrigger('garconnexpress', 'setor-fila-alterada', {
          app_type: cargo,
          pausado: pausado
        });
        console.log(`📡 [Admin] Status de fila do setor ${cargo} alterado para ${pausado ? 'PAUSA' : 'FILA ON'} em tempo real.`);
      }

      res.json({ success: true, is_online: !!novoStatus });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/admin/garcons/:id/toggle-bloqueio
  router.post('/admin/garcons/:id/toggle-bloqueio', isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      let garcom;
      try {
        garcom = (await query("SELECT id, nome, usuario, cargo, ativo, is_online FROM garcons WHERE id = ?", [id])).rows[0];
      } catch (errCol) {
        try {
          garcom = (await query("SELECT id, nome, usuario, cargo, is_online FROM garcons WHERE id = ?", [id])).rows[0];
        } catch (e2) {
          garcom = (await query("SELECT id, nome, usuario, is_online FROM garcons WHERE id = ?", [id])).rows[0];
        }
      }

      if (!garcom) return res.status(404).json({ error: 'Colaborador não encontrado' });
      
      const estaAtivo = garcom.ativo === false ? false : true;
      const novoAtivo = !estaAtivo;
      
      try {
        if (!novoAtivo) {
          // Bloqueado: desativa ativo e desativa is_online
          await query("UPDATE garcons SET ativo = ?, is_online = ? WHERE id = ?", [isPostgres ? false : 0, isPostgres ? false : 0, id]);
        } else {
          // Desbloqueado: ativa ativo
          await query("UPDATE garcons SET ativo = ? WHERE id = ?", [isPostgres ? true : 1, id]);
        }
      } catch (errUp) {
        console.warn('Fallback update ativo:', errUp.message);
      }

      const bloqueado = !novoAtivo;

      // Dispara logout imediato no aparelho do usuário caso tenha sido bloqueado
      if (bloqueado) {
        await safePusherTrigger('garconnexpress', 'usuario-bloqueado', {
          garcom_id: id,
          usuario: garcom.usuario,
          cargo: garcom.cargo,
          motivo: 'bloqueio_admin'
        });
        console.log(`🔒 Colaborador ${garcom.usuario} bloqueado pelo Admin. Comando de logout enviado via Pusher.`);
      }

      res.json({ success: true, ativo: novoAtivo, bloqueado: bloqueado });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/garcons
  router.get('/garcons', ensureDbInitialized, isAuthenticated, async (req, res) => {
    try {
      let result;
      try {
        result = await query('SELECT id, nome, usuario, telefone, comissao, diaria, is_online, cargo, ativo FROM garcons ORDER BY nome');
      } catch (errCol) {
        try {
          result = await query('SELECT id, nome, usuario, telefone, comissao, diaria, is_online, cargo FROM garcons ORDER BY nome');
        } catch (e2) {
          try {
            result = await query('SELECT id, nome, usuario, telefone, comissao, diaria, is_online FROM garcons ORDER BY nome');
          } catch (e3) {
            result = await query('SELECT id, nome, usuario, telefone, comissao, is_online FROM garcons ORDER BY nome');
          }
        }
      }
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
      const cargo = (req.body.cargo || 'garcom').toLowerCase().trim();
      const diaria = Math.max(0, parseFloat(req.body.diaria) || 0);
      const hashed = await bcrypt.hash(senha || '123', saltRounds);
      try {
        await query('INSERT INTO garcons (nome, usuario, senha, telefone, comissao, diaria, cargo) VALUES (?, ?, ?, ?, ?, ?, ?)', [nome, usuario, hashed, telefone, comissao || 0, diaria, cargo]);
      } catch (errCol) {
        await query('INSERT INTO garcons (nome, usuario, senha, telefone, comissao, diaria) VALUES (?, ?, ?, ?, ?, ?)', [nome, usuario, hashed, telefone, comissao || 0, diaria]);
      }
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // PUT /api/garcons/:id
  router.put('/garcons/:id', isAdmin, async (req, res) => {
    try {
      const { nome, usuario, senha, telefone, comissao } = req.body;
      const cargo = (req.body.cargo || 'garcom').toLowerCase().trim();
      const diaria = Math.max(0, parseFloat(req.body.diaria) || 0);
      if (senha) {
        const hashed = await bcrypt.hash(senha, saltRounds);
        try {
          await query('UPDATE garcons SET nome = ?, usuario = ?, senha = ?, telefone = ?, comissao = ?, diaria = ?, cargo = ? WHERE id = ?', [nome, usuario, hashed, telefone, comissao || 0, diaria, cargo, req.params.id]);
        } catch (errCol) {
          await query('UPDATE garcons SET nome = ?, usuario = ?, senha = ?, telefone = ?, comissao = ?, diaria = ? WHERE id = ?', [nome, usuario, hashed, telefone, comissao || 0, diaria, req.params.id]);
        }
      } else {
        try {
          await query('UPDATE garcons SET nome = ?, usuario = ?, telefone = ?, comissao = ?, diaria = ?, cargo = ? WHERE id = ?', [nome, usuario, telefone, comissao || 0, diaria, cargo, req.params.id]);
        } catch (errCol) {
          await query('UPDATE garcons SET nome = ?, usuario = ?, telefone = ?, comissao = ?, diaria = ? WHERE id = ?', [nome, usuario, telefone, comissao || 0, diaria, req.params.id]);
        }
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
