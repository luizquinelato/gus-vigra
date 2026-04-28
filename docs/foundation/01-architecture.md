<!-- vigra: db_changes=false seed_data=false -->
# 01. Arquitetura e Estrutura de Diretórios

Este documento define a arquitetura base do SaaS e a estrutura de diretórios obrigatória.

## 🏗️ Arquitetura de Serviços

A plataforma é dividida em microserviços para garantir escalabilidade e isolamento de responsabilidades:

1. **Frontend Application**: SPA em React (Vite + TypeScript + Tailwind).
2. **Backend Service**: API principal em FastAPI (Python 3.11). Responsável pelas regras de negócio.
3. **Auth Service**: Serviço isolado em FastAPI para gestão de identidade e tokens JWT.
4. **Data Layer**: PostgreSQL 18 (com pgvector se `{{ DB_ENABLE_ML }}` = true).
5. **Cache & Queue**: Redis e RabbitMQ (se `{{ ENABLE_ETL }}` = true).

## 📁 Estrutura de Diretórios

A raiz do projeto deve seguir estritamente esta estrutura:

```text
/
├── docs/                   # Documentação técnica e arquitetural
├── plans/                  # Roadmap, backlog e ADRs (Architecture Decision Records)
├── services/
│   ├── auth-service/       # Serviço de Autenticação (Porta {{ AUTH_PORT }})
│   │   ├── app/
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── backend/            # API Principal (Porta {{ BACKEND_PORT }})
│   │   ├── app/
│   │   │   ├── ai/         # (Se {{ ENABLE_AI_LAYER }} = true)
│   │   │   ├── etl/        # (Se {{ ENABLE_ETL }} = true)
│   │   │   ├── core/
│   │   │   ├── models/
│   │   │   ├── routers/
│   │   │   ├── schemas/
│   │   │   └── services/
│   │   ├── scripts/        # Migration runner e scripts de manutenção
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   └── frontend/           # SPA React (Porta {{ FRONTEND_PORT }})
│       ├── src/
│       │   ├── components/
│       │   ├── contexts/
│       │   ├── hooks/
│       │   ├── pages/
│       │   └── services/
│       ├── Dockerfile
│       └── package.json
├── docker-compose.dev.yml  # Ambiente de desenvolvimento
├── docker-compose.prod.yml # Ambiente de produção
├── .env.example            # Template de variáveis de ambiente
└── README.md
```

## 📜 Regras de Organização

1. **Isolamento de Dependências**: Cada serviço dentro de `/services/` deve ter seu próprio `requirements.txt` ou `package.json` e seu próprio `Dockerfile`.
2. **Sem Código na Raiz**: A raiz do projeto deve conter apenas arquivos de configuração global (Docker Compose, `.env`, `.gitignore`, `README.md`).
3. **Documentação Viva**: Qualquer decisão arquitetural deve ser registrada em `/plans/`.
4. **Módulos Condicionais**: As pastas `ai/` e `etl/` só devem existir dentro de `/services/backend/app/` se as respectivas variáveis estiverem ativas.
