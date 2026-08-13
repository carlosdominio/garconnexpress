const express = require('express');

module.exports = (ctx) => {
  const {
    query,
    isAuthenticated,
    isAdmin,
    safePusherTrigger,
    notifyStatus,
    isPostgres,
    bcrypt,
    saltRounds,
    jwt,
    JWT_SECRET,
    loginLimiter
  } = ctx;

  const router = express.Router();

  // POST /api/admin/login
  router.post('/admin/login', loginLimiter || ((req, res, next) => next()), async (req, res) => {
    try {
      const { usuario, senha } = req.body;
      const result = await query('SELECT id, usuario, senha FROM usuarios_admin WHERE usuario = ?', [usuario]);
      if (result.rows.length > 0 && await bcrypt.compare(senha, result.rows[0].senha)) { 
        const admin = result.rows[0];
        delete admin.senha;
        
        const token = jwt.sign({ id: admin.id, usuario: admin.usuario, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
        
        const isProd = process.env.NODE_ENV === 'production';
        res.cookie('admin_token', token, {
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? 'none' : 'lax',
          maxAge: 1000 * 60 * 60 * 2 // 2 horas
        });
        
        res.json({ success: true, admin, token }); 
      }
      else res.status(401).json({ error: 'Incorreto' });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // POST /api/login (Garcom)
  router.post('/login', loginLimiter || ((req, res, next) => next()), async (req, res) => {
    try {
      const { usuario, senha } = req.body;
      const result = await query('SELECT id, nome, usuario, senha FROM garcons WHERE usuario = ?', [usuario]);
      if (result.rows.length > 0 && await bcrypt.compare(senha, result.rows[0].senha)) { 
        const garcom = result.rows[0];
        delete garcom.senha;
        
        const token = jwt.sign({ id: garcom.id, nome: garcom.nome, usuario: garcom.usuario, role: 'garcom' }, JWT_SECRET, { expiresIn: '15d' });
        
        // Define garçom como ONLINE para o rodízio
        const agora = new Date().toISOString();
        await query("UPDATE garcons SET is_online = ?, last_assigned_at = ? WHERE id = ?", [isPostgres ? true : 1, agora, garcom.id]);
        
        const isProd = process.env.NODE_ENV === 'production';
        res.cookie('garcom_token', token, {
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? 'none' : 'lax',
          maxAge: 1000 * 60 * 60 * 16 // 16 horas
        });

        res.json({ success: true, garcom, token }); 
      }
      else res.status(401).json({ error: 'Incorreto' });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // GET /api/pusher-config
  router.get('/pusher-config', (req, res) => {
    res.json({
      key: (process.env.PUSHER_APP_KEY || "").trim(),
      cluster: (process.env.PUSHER_CLUSTER || "sa1").trim()
    });
  });

  // POST /api/acesso/gerar
  router.post('/acesso/gerar', isAuthenticated, async (req, res) => {
    const { mesa_id } = req.body;
    console.log(`🔑 GERAR CÓDIGO: Mesa ID=${mesa_id}`);
    if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });
    
    try {
      // 1. Desativa códigos anteriores desta mesa
      const resDesativa = await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);
      console.log(`   - Desativados: ${resDesativa.changes}`);
      
      // 2. Gera código aleatório de 4 dígitos
      const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let codigo = '';
      for (let i = 0; i < 4; i++) {
        codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
      }
      
      // 3. Insere o novo código
      const resInsert = await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
      console.log(`   - Novo código: ${codigo} (ID: ${resInsert.lastInsertRowid || resInsert.insertId})`);
      
      // 4. Marca a mesa como ocupada e associa ao garçom que gerou o código
      const garcom_id = req.user ? (req.user.usuario || req.user.nome) : 'Sistema';
      
      const resUpdateMesa = await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
      console.log(`   - Status Mesa ${mesa_id} atualizado para 'ocupada' (Garçom: ${garcom_id}): ${resUpdateMesa.changes} linha(s) afetada(s)`);
      
      // Notifica via Pusher para atualizar as mesas de todos
      await safePusherTrigger('garconnexpress', 'status-atualizado', { 
        mesa_id, 
        status: 'ocupada',
        garcom_id: garcom_id,
        origem: 'codigo_gerado'
      });
      
      res.json({ success: true, codigo });
    } catch (error) {
      console.error(`❌ ERRO AO GERAR CÓDIGO:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/acesso/cancelar
  router.post('/acesso/cancelar', isAuthenticated, async (req, res) => {
    const { mesa_id } = req.body;
    if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });

    try {
      const mRes = await query("SELECT id, numero, is_comanda FROM mesas WHERE CAST(id AS TEXT) = CAST(? AS TEXT) OR CAST(numero AS TEXT) = CAST(? AS TEXT)", [mesa_id, mesa_id]);
      const m = mRes.rows[0];

      if (m) {
        if (Number(m.is_comanda) === 1) {
          await query("DELETE FROM mesas WHERE id = ?", [m.id]);
        } else {
          await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [m.id]);
        }
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE (CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT) OR CAST(mesa_id AS TEXT) = CAST(? AS TEXT)) AND status = 'ativo'", [m.id, m.numero, mesa_id]);

        await safePusherTrigger('garconnexpress', `deslogar-mesa-${m.id}`, { 
          status: 'cancelado',
          mensagem: "Este acesso foi cancelado pelo garçom." 
        });
        if (m.numero != m.id) {
          await safePusherTrigger('garconnexpress', `deslogar-mesa-${m.numero}`, { 
            status: 'cancelado',
            mensagem: "Este acesso foi cancelado pelo garçom." 
          });
        }
        if (mesa_id != m.id && mesa_id != m.numero) {
          await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
            status: 'cancelado',
            mensagem: "Este acesso foi cancelado pelo garçom." 
          });
        }

        await safePusherTrigger('garconnexpress', 'status-atualizado', { 
          mesa_id: m.id, 
          status: 'liberada',
          origem: 'acesso_cancelado'
        });
        await notifyStatus(null, m.id, 'acesso_cancelado');
      } else {
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE CAST(mesa_id AS TEXT) = CAST(? AS TEXT) AND status = 'ativo'", [mesa_id]);
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/acesso/qr
  router.post('/acesso/qr', async (req, res) => {
    const { mesa_id } = req.body;
    if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });

    try {
      const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
      if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardápio digital só funciona com o caixa aberto.' });

      const mesa = (await query("SELECT * FROM mesas WHERE id = ?", [mesa_id])).rows[0];
      if (!mesa) return res.status(404).json({ error: 'Mesa não encontrada' });

      // 2.5 BLOQUEIO: Se já existe um código ativo (gerado pelo garçom), impede o escaneamento direto
      const acessoExistente = (await query("SELECT id FROM codigos_acesso WHERE mesa_id = ? AND status = 'ativo'", [mesa_id])).rows[0];
      if (acessoExistente) {
          return res.status(400).json({ success: false, error: 'Esta mesa já possui um código ativo. Por favor, insira o código manualmente ou peça ao garçom.' });
      }

      let acesso;
      if (mesa.status === 'livre') {
        // LÓGICA DE RODÍZIO (Round-Robin): Pega o garçom online que está há mais tempo sem atender
        const proximoGarcom = (await query("SELECT id, usuario, nome FROM garcons WHERE is_online = ? ORDER BY last_assigned_at ASC LIMIT 1", [isPostgres ? true : 1])).rows[0];
        
        if (!proximoGarcom) {
          return res.status(503).json({ error: 'Nenhum garçom online no momento para te atender. Por favor, chame um atendente no balcão.' });
        }

        const garcom_id = proximoGarcom.usuario;
        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let codigo = '';
        for (let i = 0; i < 4; i++) codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

        await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
        await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
        
        // Atualiza o timestamp para mover o garçom para o fim da fila
        await query("UPDATE garcons SET last_assigned_at = ? WHERE id = ?", [new Date().toISOString(), proximoGarcom.id]);

        acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON (CAST(ca.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR ca.mesa_id = m.numero) WHERE CAST(ca.mesa_id AS TEXT) = CAST(? AS TEXT) AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1", [mesa_id])).rows[0];
        
        console.log(`🤖 [Rodízio] Mesa ${mesa.numero} atribuída a: ${proximoGarcom.nome}`);
        
        await safePusherTrigger('garconnexpress', 'status-atualizado', { 
          mesa_id, 
          status: 'ocupada',
          garcom_id: garcom_id,
          origem: 'qr_code'
        });
      } else {
        // TRAVA DE SEGURANÇA: Se a mesa não estiver livre, bloqueia o novo escaneamento
        return res.status(403).json({ 
          error: 'MESA OCUPADA: Esta mesa já possui um atendimento em andamento. Se você já estava nesta mesa, use o menu anterior ou peça ajuda ao garçom.' 
        });
      }

      const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [mesa_id])).rows[0];

      const token = jwt.sign({ 
        mesa_id: acesso.mesa_id, 
        mesa_numero: acesso.mesa_numero, 
        acesso_id: acesso.id,
        pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
        role: 'cliente' 
      }, JWT_SECRET, { expiresIn: '30d' });

      res.json({ 
        success: true,
        mesa_id: acesso.mesa_id,
        mesa_numero: acesso.mesa_numero,
        token_acesso: token
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/acesso/validar
  router.post('/acesso/validar', async (req, res) => {
    const { codigo } = req.body;
    if (!codigo) return res.status(400).json({ error: 'Código é obrigatório' });

    try {
      // 1. Verifica se o caixa está aberto
      const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
      if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardápio digital só funciona com o caixa aberto.' });

      // 2. Verifica se o código é válido e ativo
      const acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON (CAST(ca.mesa_id AS TEXT) = CAST(m.id AS TEXT) OR ca.mesa_id = m.numero) WHERE UPPER(ca.codigo) = UPPER(?) AND ca.status = 'ativo'", [codigo])).rows[0];

      if (!acesso) return res.status(401).json({ error: 'Código inválido ou já expirado.' });

      // 3. Verificação de Segurança: A mesa está realmente ocupada?
      const mesaStatus = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
      
      if (!mesaStatus || mesaStatus.status === 'livre') {
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [acesso.id]);
        return res.status(403).json({ error: 'ESTA MESA NÃO ESTÁ ATIVA: Peça ao garçom para abrir sua mesa novamente.' });
      }

      // 4. Busca pedido_id se existir (opcional nesta fase)
      const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [acesso.mesa_id])).rows[0];

      // 5. Gera o token de acesso
      const token = jwt.sign({ 
        mesa_id: acesso.mesa_id, 
        mesa_numero: acesso.mesa_numero, 
        acesso_id: acesso.id,
        pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
        role: 'cliente' 
      }, JWT_SECRET, { expiresIn: '30d' });

      res.json({ 
        success: true,
        mesa_id: acesso.mesa_id,
        mesa_numero: acesso.mesa_numero,
        pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
        acesso_id: acesso.id,
        token_acesso: token
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/acesso/check
  router.get('/acesso/check', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Não autorizado' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role !== 'cliente' || !decoded.acesso_id) {
          return res.status(403).json({ error: 'Token inválido para esta operação' });
      }

      const acesso = (await query("SELECT status, mesa_id FROM codigos_acesso WHERE id = ?", [decoded.acesso_id])).rows[0];
      if (!acesso || acesso.status !== 'ativo') {
          return res.json({ valid: false, error: 'Acesso expirado' });
      }

      // Verifica se a mesa ainda está ativa
      const mesa = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
      if (!mesa || mesa.status === 'livre') {
          await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [decoded.acesso_id]);
          return res.json({ valid: false, error: 'Mesa liberada' });
      }

      res.json({ valid: true });
    } catch (err) {
      res.status(401).json({ error: 'Sessão expirada' });
    }
  });

  return router;
};
