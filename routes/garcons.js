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
    JWT_SECRET,
    enviarFcmStatusColaborador
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
    if (req.user.role !== 'garcom' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas colaboradores ou administradores podem alterar atendimento.' });
    }
    try {
      const isOnline = pausado ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
      const valPausado = !!pausado;
      let garcomId = req.user.id;
      let usuario = req.user.usuario;
      let cargo = (req.user.cargo || 'garcom').toLowerCase().trim();

      if (garcomId) {
        await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isOnline, garcomId]);
        await query("UPDATE push_subscriptions SET pausado = ? WHERE garcom_id = ? OR garcom_id = ?", [valPausado ? 1 : 0, String(garcomId), String(usuario)]).catch(() => {});
      }

      console.log(`👤 Colaborador ${usuario} (${cargo}) agora está ${valPausado ? 'PAUSADO' : 'DISPONÍVEL'}.`);

      // Notifica o Admin em tempo real via garcom-status-alterado
      await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
        garcom_id: garcomId,
        usuario: usuario,
        cargo: cargo,
        pausado: valPausado
      });

      // Se for motoboy, cozinha ou churrasqueiro, também dispara setor-fila-alterada
      if (cargo === 'motoboy' || cargo === 'cozinha' || cargo === 'churrasqueiro') {
        await safePusherTrigger('garconnexpress', 'setor-fila-alterada', {
          app_type: cargo,
          user_id: usuario,
          garcom_id: garcomId,
          pausado: valPausado
        });
        if (cargo === 'churrasqueiro') {
          await safePusherTrigger('garconnexpress', 'setor-fila-alterada', {
            app_type: 'churrasco',
            user_id: usuario,
            garcom_id: garcomId,
            pausado: valPausado
          });
        }
      }

      res.json({ success: true, is_online: !valPausado });
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
        garcom = (await query("SELECT id, nome, usuario, cargo, is_online FROM garcons WHERE id = ?", [id])).rows[0];
      } catch (e1) {
        garcom = (await query("SELECT id, usuario, is_online FROM garcons WHERE id = ?", [id])).rows[0];
      }

      if (!garcom) return res.status(404).json({ error: 'Colaborador não encontrado' });
      const novoStatus = garcom.is_online ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
      await query("UPDATE garcons SET is_online = ? WHERE id = ?", [novoStatus, id]);
      const pausado = novoStatus ? false : true;

      // Determina o cargo com fallback inteligente caso ainda não tenha sido editado no Admin
      let cargo = (garcom.cargo || '').toLowerCase().trim();
      if (!cargo || cargo === 'garcom') {
        const u = (garcom.usuario || '').toLowerCase();
        const n = (garcom.nome || '').toLowerCase();
        if (u.includes('cozinha') || n.includes('cozinha')) cargo = 'cozinha';
        else if (u.includes('churras') || n.includes('churras')) cargo = 'churrasqueiro';
        else if (u.includes('moto') || n.includes('moto') || u.includes('entrega') || n.includes('entrega')) cargo = 'motoboy';
      }

      // 1. Notifica evento padrão de garçom / colaborador
      await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
        garcom_id: id,
        usuario: garcom.usuario,
        cargo: cargo,
        pausado: pausado,
        origem: 'admin'
      });

      // 2. Sincroniza a fila e push_subscriptions em tempo real
      try {
        if (cargo === 'cozinha' || cargo === 'churrasqueiro') {
          await query("UPDATE push_subscriptions SET pausado = ? WHERE app_type = ? OR app_type = ?", [pausado ? 1 : 0, cargo, cargo === 'churrasqueiro' ? 'churrasco' : cargo]);
        } else {
          await query("UPDATE push_subscriptions SET pausado = ? WHERE garcom_id = ? OR garcom_id = ?", [pausado ? 1 : 0, String(id), String(garcom.usuario)]);
        }
      } catch(e) {}

      if (cargo === 'cozinha' || cargo === 'churrasqueiro' || cargo === 'motoboy') {
        await safePusherTrigger('garconnexpress', 'setor-fila-alterada', {
          app_type: cargo,
          user_id: garcom.usuario,
          garcom_id: id,
          pausado: pausado,
          origem: 'admin'
        });
        if (cargo === 'churrasqueiro') {
          await safePusherTrigger('garconnexpress', 'setor-fila-alterada', {
            app_type: 'churrasco',
            user_id: garcom.usuario,
            garcom_id: id,
            pausado: pausado,
            origem: 'admin'
          });
        }
        console.log(`📡 [Admin] Status de fila do setor ${cargo} alterado para ${pausado ? 'PAUSA' : 'FILA ON'} em tempo real.`);
      }

      // 3. Dispara Notificação FCM / WebPush (para alertar mesmo com tela desligada / em background)
      if (typeof enviarFcmStatusColaborador === 'function') {
        await enviarFcmStatusColaborador({
          garcomId: id,
          usuario: garcom.usuario,
          cargo: cargo,
          pausado: pausado
        });
      }

      res.json({ success: true, is_online: !!novoStatus, pausado });
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
