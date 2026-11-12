# 🍽️ GarçonnExpress — Sistema Completo de Automação para Bares e Restaurantes

**GarçonnExpress** é um ecossistema comercial full-stack de alta performance projetado para gerenciar todas as operações de atendimento, cozinha, bar, churrasqueira, caixa, cardápio digital e delivery em tempo real.

---

## 🌟 Principais Recursos do Ecossistema

* **📱 Garçom Móvel (PWA + APK Nativo):** Anotação rápida de pedidos por mesa ou comanda, divisão de itens, observações personalizadas, cálculo automático de 10% de taxa de serviço e feedback por vibração.
* **🍳 Cozinha KDS (Kitchen Display System):** Fila de pedidos em tempo real com separação automática de pratos quentes e frios, alertas visuais de tempo de espera e notificações sonoras.
* **🥩 Churrasqueira (Módulo Especializado):** Fila dedicada para carnes, espetos e grelhados com controle individual de ponto e despacho sincronizado.
* **🛵 Delivery & Motoboy:** Painel de expedição de pedidos para entrega com despacho para entregadores, rotas e atualização de status em tempo real.
* **📋 Cardápio Digital (QR Code Auto-Atendimento):** Cardápio online responsivo para visualização dos clientes na mesa via QR Code.
* **💻 Painel Administrativo / PDV:** Controle total de fluxo de caixa, sangrias, suprimentos, histórico de pagamentos, relatórios de vendas, cadastro de itens e controle de estoque por Ficha Técnica.
* **📡 Comunicação em Tempo Real:** Atualizações instantâneas via **Pusher** (em ambiente Serverless/Vercel) e **Socket.IO** (em ambiente local/servidor).
* **💬 Integração com WhatsApp:** Envio automatizado de confirmação e atualizações de pedidos diretamente aos clientes.

---

## 🏗️ Arquitetura do Sistema

```
garconnexpress/
├── frontend/                     # Aplicações Web (PWAs)
│   ├── admin/                    # Painel Administrativo / PDV
│   ├── garcom/                   # App do Garçom
│   ├── cozinha/                  # Display da Cozinha (KDS)
│   ├── churrasqueiro/            # Display da Churrasqueira
│   ├── delivery/                 # Módulo de Entregas
│   ├── motoboy/                  # App do Entregador
│   └── cardapio/                 # Cardápio Digital QR Code
├── garcom-app-nativo/            # App Android Nativo (Capacitor)
├── cozinha-app-nativo/           # App Android Nativo (Capacitor)
├── churrasqueiro-app-nativo/     # App Android Nativo (Capacitor)
├── motoboy-app-nativo/           # App Android Nativo (Capacitor)
├── routes/                       # Controladores de Rotas da API Express
│   ├── auth.js                   # Autenticação JWT e QR Code de Acesso
│   ├── pedidos.js                # Lógica Central de Pedidos e Comandas
│   ├── mesas.js                  # Gestão de Mesas e Fechamento
│   ├── caixa.js                  # Abertura, Sangria e Fechamento de Caixa
│   ├── menu.js                   # Catálogo de Produtos e Categorias
│   ├── estoque.js                # Movimentações e Ficha Técnica
│   ├── garcons.js                # Gestão da Equipe de Salão
│   ├── notificacoes.js           # Push Notifications (WebPush + FCM)
│   ├── configs.js                # Parâmetros Gerais do Sistema
│   └── whatsapp.js               # Disparos e Webhook WhatsApp
├── scripts/                      # Utilitários de migração e manutenção
├── server.js                     # Servidor Core Express + Engine Híbrida de Banco
└── vercel.json                   # Configuração de Deploy e Rotas Serverless
```

---

## 🗄️ Camada de Banco de Dados Híbrida

O sistema conta com um adaptador poliglota que opera automaticamente em dois ambientes:

| Ambiente | Banco Ativo | Driver | Vantagem |
| :--- | :--- | :--- | :--- |
| **Produção / Vercel** | **PostgreSQL** | `pg.Pool` | Suporta nuvem serverless com retries automáticos de rede. |
| **Local / Offline** | **SQLite** | `better-sqlite3` | Zero configuração, execução local instantânea e leve. |

---

## 🚀 Como Executar Localmente

### Pré-requisitos
* Node.js v18 ou superior (recomendado v20+).
* NPM ou Yarn.

### Instalação
```bash
# 1. Clonar ou acessar o diretório do projeto
cd /home/carlosrikelinux/garconnexpress

# 2. Instalar as dependências
npm install

# 3. Iniciar o servidor em desenvolvimento
npm start
```

O servidor iniciará em `http://localhost:3000` (ou na porta configurada em `PORT`).

---

## 🌐 Endpoints Principais da API

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `GET` | `/api/health` | **Healthcheck** (status do banco, versão, uptime e timestamp) |
| `POST` | `/api/admin/login` | Login administrativo protegido por JWT e rate-limit |
| `POST` | `/api/login` | Login dos garçons por código de acesso ou PIN |
| `GET` | `/api/mesas` | Listagem das mesas, comandas e status de ocupação |
| `POST` | `/api/pedidos` | Criação de novo pedido com baixa em estoque |
| `GET` | `/api/pedidos/cozinha` | Fila de pedidos em preparo para a Cozinha |
| `GET` | `/api/pedidos/churrasco`| Fila de pedidos de carnes para a Churrasqueira |
| `GET` | `/api/caixa/status` | Saldo e movimentações do turno atual do caixa |

---

## 🛡️ Segurança Aplicada

* **JWT (JSON Web Tokens):** Assinatura criptográfica HMAC-SHA256 para todas as rotas privadas.
* **Rate Limiting:** Proteção ativa contra ataques de força bruta no login e spam de pedidos via `express-rate-limit`.
* **Proteção HTTP:** Cabeçalhos de segurança implementados via `helmet`.
* **Sanitização XSS:** Validação de textos livres com `sanitize-html`.
* **Graceful Shutdown:** Encerramento seguro de conexões ativas do banco de dados ao receber sinais `SIGTERM` e `SIGINT`.

---

## 📱 Compilação dos Aplicativos Android (Capacitor)

Cada aplicativo nativo possui seu próprio sub-projeto Capacitor:

```bash
# Exemplo para o app do Garçom:
cd garcom-app-nativo
npm install
npx cap sync android
npx cap open android
```
*(Abra no Android Studio e gere o APK de Release assinado).*

---

## 📄 Licença
Desenvolvido por **Carlos Domínio**. Todos os direitos reservados.
