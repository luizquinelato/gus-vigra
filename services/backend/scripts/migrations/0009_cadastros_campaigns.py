#!/usr/bin/env python3
"""
Migration 0009: Cadastros — Marketing Campaigns
===============================================
Project : Vigra
Module  : cadastros
Creates : campaigns

Campanha de marketing (ação de comunicação) por tenant:
- type ∈ ('launch','sale','reactivation','seasonal')
- channel ∈ ('whatsapp','email','marketplace','store')
- promotion_id opcional — campanha pode ativar promoção automaticamente
- segment_id é INTEGER NULL sem FK; aguarda módulo 04 (CRM) criar a tabela
  client_segments. Migration futura adicionará a constraint.
- status ∈ ('draft','scheduled','running','done','cancelled')
- created_by_agent=TRUE quando gerada por agente de IA (módulo 09)

Métricas (reach/conversion/revenue) são alimentadas em runtime pela camada
de execução de canal — não há FKs aqui para mantê-la independente.

Depende de 0008 (promotions).

Runner registra esta migration em migration_history após apply() suceder.
NÃO registre dentro de apply() — o runner cuida disso.
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0009_cadastros_campaigns...")
    with conn.cursor() as cur:

        cur.execute("""
            CREATE TABLE IF NOT EXISTS campaigns (
                -- 1. ID
                id                  SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                name                VARCHAR(200)  NOT NULL,
                type                VARCHAR(30)   NOT NULL,
                channel             VARCHAR(30)   NOT NULL,
                status              VARCHAR(20)   DEFAULT 'draft',
                scheduled_at        TIMESTAMPTZ,
                executed_at         TIMESTAMPTZ,
                reach_count         INTEGER       DEFAULT 0,
                conversion_count    INTEGER       DEFAULT 0,
                revenue_generated   NUMERIC(15,2) DEFAULT 0,
                created_by_agent    BOOLEAN       DEFAULT FALSE,
                -- 3. FKs internas
                promotion_id        INTEGER       REFERENCES promotions(id) ON DELETE SET NULL,
                segment_id          INTEGER,
                -- 4. Campos herdados
                tenant_id           INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active              BOOLEAN       DEFAULT TRUE,
                created_at          TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at     TIMESTAMPTZ   DEFAULT NOW(),
                CONSTRAINT campaigns_type_check    CHECK (type    IN ('launch','sale','reactivation','seasonal')),
                CONSTRAINT campaigns_channel_check CHECK (channel IN ('whatsapp','email','marketplace','store')),
                CONSTRAINT campaigns_status_check  CHECK (status  IN ('draft','scheduled','running','done','cancelled'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_id    ON campaigns(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_campaigns_promotion_id ON campaigns(promotion_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_campaigns_segment_id   ON campaigns(segment_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_campaigns_status       ON campaigns(status);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_campaigns_active       ON campaigns(active);")

        # Índice parcial — agendamento só importa para campanhas ainda não executadas.
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled
                ON campaigns (tenant_id, scheduled_at)
                WHERE executed_at IS NULL AND active = TRUE;
        """)

    logger.info("0009_cadastros_campaigns applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0009_cadastros_campaigns...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS campaigns CASCADE;")
    logger.info("0009_cadastros_campaigns rolled back.")
