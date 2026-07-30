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
    http_req_failed: ['rate<0.01'],   // Taxa de erro menor que 1%
    http_req_duration: ['p(95)<200'], // 95% das requisições devem responder em menos de 200ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // Cenário 1: Cliente acessando o cardápio (GET)
  const menuRes = http.get(`${BASE_URL}/api/menu`);
  check(menuRes, {
    'status do cardápio é 200': (r) => r.status === 200,
    'tempo de resposta do cardápio < 180ms': (r) => r.timings.duration < 180,
  });
  sleep(1);

  // Cenário 2: Verificação de status do caixa (GET)
  const caixaRes = http.get(`${BASE_URL}/api/caixa/status`);
  check(caixaRes, {
    'status do caixa é 200': (r) => r.status === 200,
  });
  sleep(1);

  // Cenário 3: Tentativa de login simulada (POST)
  const loginPayload = JSON.stringify({
    usuario: 'teste_k6_virtual',
    senha: 'senha_invalida_k6',
  });
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  const loginRes = http.post(`${BASE_URL}/api/login`, loginPayload, params);
  check(loginRes, {
    'resposta do login é 401 ou 200': (r) => r.status === 401 || r.status === 200,
  });
  sleep(2);
}
