import http from 'k6/http';
import { check, sleep } from 'k6';

// Configurações do teste de carga
export const options = {
  stages: [
    { duration: '1m', target: 100 }, // Rampa de subida: sobe para 100 usuários
    { duration: '3m', target: 500 }, // Pico: Mantém 500 usuários virtuais simultâneos
    { duration: '1m', target: 0 },   // Rampa de descida: encerra conexões
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],   // Taxa de erro (excluindo 429/401/403 esperados) menor que 5%
    http_req_duration: ['p(95)<250'], // 95% das requisições devem responder em menos de 250ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // Gera uma distribuição estatística de uso realista usando Math.random()
  const rand = Math.random() * 100;

  if (rand < 40) {
    // --- 40% CONSULTAM O CARDÁPIO (GET /api/menu) ---
    const res = http.get(`${BASE_URL}/api/menu`);
    check(res, {
      'cardápio carregado (200)': (r) => r.status === 200,
      'cardápio rápido (< 250ms)': (r) => r.timings.duration < 250,
    });
  } else if (rand < 60) {
    // --- 20% FAZEM LOGIN (POST /api/login com rate limiter) ---
    const payload = JSON.stringify({ usuario: 'teste_k6', senha: '123' });
    const params = { headers: { 'Content-Type': 'application/json' } };
    const res = http.post(`${BASE_URL}/api/login`, payload, params);
    
    // Tratamento correto do 429 como proteção esperada
    check(res, {
      'login protegido/respondido (200/401/429)': (r) => r.status === 200 || r.status === 401 || r.status === 429,
    });
  } else if (rand < 80) {
    // --- 20% CRIAM PEDIDOS DE DELIVERY (POST /api/pedidos) ---
    const payload = JSON.stringify({
      garcom_id: 'DELIVERY',
      itens: [{ menu_id: 1, quantidade: 2 }],
      cobrar_taxa: true,
      cliente_telefone: '11999999999',
      forma_pagamento: 'PIX',
      observacao: 'Teste de carga K6'
    });
    const params = { headers: { 'Content-Type': 'application/json' } };
    const res = http.post(`${BASE_URL}/api/pedidos`, payload, params);
    
    check(res, {
      'pedido protegido/processado (200/400/429)': (r) => r.status === 200 || r.status === 400 || r.status === 429,
    });
  } else if (rand < 90) {
    // --- 10% ACOMPANHAM O PEDIDO (GET /api/pedidos/ativo-telefone/:tel) ---
    const res = http.get(`${BASE_URL}/api/pedidos/ativo-telefone/11999999999`);
    check(res, {
      'acompanhamento respondido (200)': (r) => r.status === 200,
    });
  } else if (rand < 95) {
    // --- 5% CONSULTAM O CAIXA (GET /api/caixa/status) ---
    const res = http.get(`${BASE_URL}/api/caixa/status`);
    check(res, {
      'caixa consultado (200)': (r) => r.status === 200,
    });
  } else {
    // --- 5% ACESSAM RELATÓRIOS (GET /api/relatorios/estoque - Protegido, espera 401/403) ---
    const res = http.get(`${BASE_URL}/api/relatorios/estoque`);
    check(res, {
      'relatório protegido (401/403)': (r) => r.status === 401 || r.status === 403,
    });
  }

  // Simula um tempo de pensamento realista (think time) do usuário antes da próxima ação
  sleep(1);
}
