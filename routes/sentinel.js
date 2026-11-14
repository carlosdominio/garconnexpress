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

  // Inicialização assíncrona da tabela sentinel_logs
  (async () => {
    try {
      if (isPostgres) {
        await query(`
          CREATE TABLE IF NOT EXISTS sentinel_logs (
            id SERIAL PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            modulo VARCHAR(50) NOT NULL,
            gravidade VARCHAR(20) DEFAULT 'atencao',
            mensagem TEXT NOT NULL,
            detalhes TEXT,
            diagnostico_ia TEXT,
            resolvido INTEGER DEFAULT 0
          )
        `);
      } else {
        await query(`
          CREATE TABLE IF NOT EXISTS sentinel_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modulo VARCHAR(50) NOT NULL,
            gravidade VARCHAR(20) DEFAULT 'atencao',
            mensagem TEXT NOT NULL,
            detalhes TEXT,
            diagnostico_ia TEXT,
            resolvido INTEGER DEFAULT 0
          )
        `);
      }
      console.log('🛡️ [Sentinel AI] Tabela sentinel_logs pronta para operação.');
    } catch (e) {
      console.warn('🛡️ [Sentinel AI] Aviso ao criar tabela sentinel_logs:', e.message);
    }
  })();

  // Helper para buscar a chave da Groq (.env ou banco)
  async function obterChaveGroq() {
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== '') {
      return process.env.GROQ_API_KEY.trim();
    }
    try {
      const res = await query("SELECT valor FROM sistema_config WHERE chave = 'groq_api_key'");
      if (res.rows.length > 0 && res.rows[0].valor) {
        return res.rows[0].valor.trim();
      }
    } catch (e) {}
    return null;
  }

  // Helper de Diagnóstico Inteligente via Groq
  async function diagnosticarComGroq(modulo, gravidade, mensagem, detalhes) {
    const apiKey = await obterChaveGroq();
    if (!apiKey) {
      return diagnosticoRegraEspecialista(modulo, mensagem, detalhes);
    }

    const systemPrompt = `Você é o Sentinel AI, robô de monitoramento e autodiagnóstico inteligente do sistema GarçomExpress (restaurante, bar e delivery).
O sistema é composto por:
- Painel Admin (fechamento de conta, caixa, transferências, gestão de estoque e impressora Elgin i7).
- App do Garçom (abertura de mesas, adição de itens, confirmação de pratos entregues, solicitação de conta).
- Cozinha & Churrasqueira (filas de preparação em tempo real com cronômetro de atraso).
- Cardápio Digital QR Code (pedidos por comanda/mesa).
- Banco de Dados PostgreSQL/SQLite e WebSocket Pusher.

Analise o erro reportado e responda OBRIGATORIAMENTE em português brasileiro de forma direta e concisa (máximo de 3 frases curtas):
1. O que provavelmente causou o erro em termos práticos do restaurante.
2. Se houve algum impacto nas vendas/mesas.
3. Ação recomendada para o administrador.
Não use termos prolixos. Seja um especialista técnico objetivo.`;

    const userPrompt = `INCIDENTE DETECTADO:
Módulo: ${modulo}
Gravidade: ${gravidade}
Erro: ${mensagem}
Detalhes Adicionais: ${detalhes || 'Nenhum'}`;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 250
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn('🛡️ [Sentinel AI] Falha na API da Groq:', response.status, errText);
        return diagnosticoRegraEspecialista(modulo, mensagem, detalhes);
      }

      const data = await response.json();
      const respostaIA = data.choices?.[0]?.message?.content?.trim();
      return respostaIA || diagnosticoRegraEspecialista(modulo, mensagem, detalhes);
    } catch (err) {
      console.warn('🛡️ [Sentinel AI] Exceção ao consultar Groq:', err.message);
      return diagnosticoRegraEspecialista(modulo, mensagem, detalhes);
    }
  }

  // Motor Especialista Fallback (caso a Groq esteja sem chave ou sem internet)
  function diagnosticoRegraEspecialista(modulo, msg, detalhes) {
    const texto = `${msg} ${detalhes || ''}`.toLowerCase();
    if (texto.includes('does not exist') || texto.includes('no such column')) {
      return 'Inconsistência de esquema no banco de dados. Uma coluna necessária não foi encontrada nas migrações atuais.';
    }
    if (texto.includes('mesa_ocupada') || texto.includes('fechando')) {
      return 'Tentativa de lançamento ou alteração em uma mesa que já está em processo de fechamento de conta pelo caixa.';
    }
    if (texto.includes('timeout') || texto.includes('econnrefused')) {
      return 'Instabilidade passageira de conexão de rede ou lentidão na resposta do banco de dados/API.';
    }
    if (texto.includes('caixa fechado')) {
      return 'Operação bloqueada preventivamente porque o caixa do dia ainda não foi aberto pelo administrador.';
    }
    if (texto.includes('estoque') || texto.includes('insuficiente')) {
      return 'Tentativa de lançamento de produto cuja quantidade excede o estoque disponível ou os insumos da ficha técnica.';
    }
    return `Ocorrência registrada no módulo ${modulo}. O fluxo de dados foi protegido preventivamente pelo sistema.`;
  }

  // Função central para registrar incidentes no Sentinel
  async function registrarIncidente({ modulo, gravidade = 'atencao', mensagem, detalhes = null }) {
    try {
      const diagnostico = await diagnosticarComGroq(modulo, gravidade, mensagem, detalhes);
      const res = await query(
        `INSERT INTO sentinel_logs (modulo, gravidade, mensagem, detalhes, diagnostico_ia) VALUES (?, ?, ?, ?, ?) RETURNING id, created_at`,
        [modulo, gravidade, mensagem, detalhes, diagnostico]
      ).catch(async () => {
        // Fallback SQLite caso não suporte RETURNING
        await query(
          `INSERT INTO sentinel_logs (modulo, gravidade, mensagem, detalhes, diagnostico_ia) VALUES (?, ?, ?, ?, ?)`,
          [modulo, gravidade, mensagem, detalhes, diagnostico]
        );
        return { rows: [{ id: Date.now(), created_at: new Date().toISOString() }] };
      });

      const novoLog = {
        id: res.rows[0]?.id || Date.now(),
        created_at: res.rows[0]?.created_at || new Date().toISOString(),
        modulo,
        gravidade,
        mensagem,
        detalhes,
        diagnostico_ia: diagnostico
      };

      // Notifica em tempo real a aba de Monitoramento aberta no painel Admin
      safePusherTrigger('garconnexpress', 'sentinel-novo-log', novoLog).catch(() => {});
      return novoLog;
    } catch (err) {
      console.error('🛡️ [Sentinel AI] Erro ao gravar log de incidente:', err.message);
      return null;
    }
  }

  // 1. GET /api/sentinel/status - Métricas de Saúde do Sistema
  router.get('/status', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const inicioDb = Date.now();
      await query('SELECT 1');
      const latenciaDb = Date.now() - inicioDb;

      const mem = process.memoryUsage();
      const memoriaRssMb = Math.round(mem.rss / 1024 / 1024);
      const memoriaHeapMb = Math.round(mem.heapUsed / 1024 / 1024);

      const uptimeSegundos = Math.floor(process.uptime());
      const horas = Math.floor(uptimeSegundos / 3600);
      const minutos = Math.floor((uptimeSegundos % 3600) / 60);
      const uptimeFormatado = `${horas}h ${minutos}m`;

      const pedidosAtivosRes = await query("SELECT count(*) as total FROM pedidos WHERE status NOT IN ('entregue', 'cancelado', 'rascunho')").catch(() => ({ rows: [{ total: 0 }] }));
      const totalPedidosAtivos = parseInt(pedidosAtivosRes.rows[0]?.total || 0, 10);

      const logsHojeRes = await query("SELECT count(*) as total FROM sentinel_logs WHERE created_at >= CURRENT_DATE").catch(() => ({ rows: [{ total: 0 }] }));
      const incidentesHoje = parseInt(logsHojeRes.rows[0]?.total || 0, 10);

      const chaveGroq = await obterChaveGroq();

      let nivelSaude = 'operacional';
      let mensagemSaude = 'Todos os sistemas operando normalmente com 100% de estabilidade.';
      if (latenciaDb > 400) {
        nivelSaude = 'atencao';
        mensagemSaude = `Latência do banco elevada (${latenciaDb}ms).`;
      }

      res.json({
        saude: nivelSaude,
        mensagem_saude: mensagemSaude,
        latencia_db_ms: latenciaDb,
        uptime_segundos: uptimeSegundos,
        uptime_formatado: uptimeFormatado,
        memoria_rss_mb: memoriaRssMb,
        memoria_heap_mb: memoriaHeapMb,
        pedidos_ativos: totalPedidosAtivos,
        incidentes_hoje: incidentesHoje,
        groq_ativo: Boolean(chaveGroq),
        node_version: process.version,
        banco_tipo: isPostgres ? 'PostgreSQL (Produção)' : 'SQLite Local'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 2. GET /api/sentinel/logs - Lista dos últimos incidentes analisados
  router.get('/logs', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const result = await query("SELECT * FROM sentinel_logs ORDER BY id DESC LIMIT 50");
      res.json(result.rows || []);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 3. POST /api/sentinel/testar-ia - Teste de Diagnóstico em Tempo Real
  router.post('/testar-ia', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      const chaveGroq = await obterChaveGroq();
      const modulo = 'PAINEL_ADMIN';
      const gravidade = 'info';
      const mensagem = 'Simulação de Diagnóstico Sentinel AI disparada pelo Administrador';
      const detalhes = 'Verificando integridade das respostas do modelo Groq LLM com regras operacionais do restaurante.';

      const diagnostico = await diagnosticarComGroq(modulo, gravidade, mensagem, detalhes);

      const logCriado = await registrarIncidente({
        modulo,
        gravidade,
        mensagem,
        detalhes
      });

      res.json({
        success: true,
        usou_groq: Boolean(chaveGroq),
        modelo: chaveGroq ? 'llama-3.3-70b-versatile' : 'Motor Especialista Local (Fallback)',
        diagnostico,
        log: logCriado
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 4. POST /api/sentinel/salvar-chave-groq - Configura a chave no painel
  router.post('/salvar-chave-groq', ensureDbInitialized, isAdmin, async (req, res) => {
    const { chave } = req.body;
    try {
      const valChave = (chave || '').trim();
      if (isPostgres) {
        await query(
          "INSERT INTO sistema_config (chave, valor) VALUES ('groq_api_key', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor",
          [valChave]
        );
      } else {
        await query(
          "INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('groq_api_key', ?)",
          [valChave]
        );
      }
      res.json({ success: true, configurado: Boolean(valChave) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 5. POST /api/sentinel/limpar-logs - Limpa o histórico de incidentes
  router.post('/limpar-logs', ensureDbInitialized, isAdmin, async (req, res) => {
    try {
      await query("DELETE FROM sentinel_logs");
      safePusherTrigger('garconnexpress', 'sentinel-logs-limpos', {}).catch(() => {});
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 6. POST /api/sentinel/telemetria - Receptor de falhas de clientes web
  router.post('/telemetria', async (req, res) => {
    const { modulo = 'FRONTEND', mensagem, detalhes, gravidade = 'atencao' } = req.body;
    if (!mensagem) return res.status(400).json({ error: 'Mensagem obrigatória' });
    try {
      const log = await registrarIncidente({ modulo, gravidade, mensagem, detalhes });
      res.json({ success: true, log_id: log?.id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
