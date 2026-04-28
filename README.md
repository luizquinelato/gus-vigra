# Vigra — Projeto Base SaaS Multi-Tenant

Plataforma SaaS multi-tenant com autenticação JWT, sistema de cores dinâmico por tenant e arquitetura de microserviços.

---

## 🏗️ Arquitetura

| Serviço | Porta PROD | Porta DEV | Onde roda |
|---|---|---|---|
| Auth Service | 12100 | 12110 | Host (uvicorn) |
| Backend API | 12000 | 12010 | Host (uvicorn) |
| Frontend | 5181 | 5182 | Host (vite) |
| Frontend ETL | 3344 | 3345 | Host (vite) |
| PostgreSQL | 5452 | 5454 | Docker |
| Redis | 6388 | 6389 | Docker |
| RabbitMQ | 5675/15675 | 5674/15674 | Docker |
| Qdrant | 6345 | 6347 | Docker |

---

## ⚙️ Setup Inicial

```bash
# 1. Criar venvs Python
python scripts/setup_venvs.py

# 2. Instalar dependências do frontend
cd services/frontend && npm install && cd ../..
```

---

## 🐳 Infraestrutura (Docker)

```bash
# DEV
docker compose -f docker-compose.db.dev.yml up -d
docker compose -f docker-compose.db.dev.yml down

# PROD
docker compose -f docker-compose.db.yml up -d
docker compose -f docker-compose.db.yml down
```

---

## 🗄️ Banco de Dados (Migrations)

```bash
# Configurar DATABASE_URL (DEV)
$env:DATABASE_URL="postgresql://vigra:vigra@localhost:5454/vigra_dev"

# Aplicar todas as migrations
python services/backend/scripts/migration_runner.py --apply-all

# Status
python services/backend/scripts/migration_runner.py --status

# Reverter tudo (cuidado!)
python services/backend/scripts/migration_runner.py --rollback-to 0000 --confirm
```

---

## 🚀 Serviços (cada um em terminal separado)

```bash
# Auth Service — DEV (porta 12110)
cd services/auth
$env:APP_ENV="dev"
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 12110

# Backend — DEV (porta 12010)
cd services/backend
$env:APP_ENV="dev"
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 12010

# Frontend — DEV (porta 5182)
cd services/frontend
npm run dev
```

---

## 🔐 Credenciais Padrão (DEV)

- **Email**: `gustavoquinelato@gmail.com`
- **Senha**: `Gus@2026!`

> ⚠️ Troque as credenciais antes de usar em produção.

---

## 📁 Estrutura

```
/
├── backups/            # Dumps gerados por scripts/database/backup.py (gitignored)
├── docs/               # Documentação técnica
├── scripts/
│   ├── database/
│   │   ├── backup.py   # pg_dump via Docker → backups/{alias}_{env}_{timestamp}.backup
│   │   └── restore.py  # pg_restore interativo com lista de backups disponíveis
│   └── setup_venvs.py
├── services/
│   ├── auth/           # Serviço de autenticação (JWT)
│   ├── backend/        # API principal (FastAPI)
│   ├── frontend/       # SPA React (Vite + TypeScript)
│   └── frontend-etl/   # Painel ETL (Vite + TypeScript)
├── .env.dev            # Variáveis DEV (não commitar)
├── .env.prod           # Variáveis PROD (não commitar)
├── .env.example        # Template público
├── docker-compose.db.yml      # Infraestrutura PROD
└── docker-compose.db.dev.yml  # Infraestrutura DEV
```

---

by [Luiz Gustavo Quinelato (Gus)](https://www.linkedin.com/in/gustavoquinelato/)
