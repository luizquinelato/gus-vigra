#!/usr/bin/env python3
"""
Migration 0008: Cadastros — Promotions
======================================
Project : Vigra
Module  : cadastros
Creates : promotions

Promoções (descontos de preço) por tenant:
- type ∈ ('pct_off','fixed_off','buy_x_get_y','free_shipping')
- applies_to ∈ ('all','product','category') + target_ids INTEGER[]
- coupon_code opcional (NULL = promoção automática sem cupom)
- max_uses / uses_count / max_uses_per_client controlam limites
- starts_at / ends_at definem janela de validade (job diário desativa
  promoções com ends_at < NOW() — não modelado nesta migration)
- stackable controla se acumula com outras promoções

Diferente de price_tables, promotions é desconto de campanha/marketing,
não preço base por canal.

Runner registra esta migration em migration_history após apply() suceder.
NÃO registre dentro de apply() — o runner cuida disso.
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0008_cadastros_promotions...")
    with conn.cursor() as cur:

        cur.execute("""
            CREATE TABLE IF NOT EXISTS promotions (
                -- 1. ID
                id                   SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                name                 VARCHAR(200)  NOT NULL,
                type                 VARCHAR(30)   NOT NULL,
                value                NUMERIC(10,2),
                min_order_amount     NUMERIC(15,2),
                min_quantity         INTEGER,
                applies_to           VARCHAR(20)   DEFAULT 'all',
                target_ids           INTEGER[],
                coupon_code          VARCHAR(50),
                max_uses             INTEGER,
                uses_count           INTEGER       DEFAULT 0,
                max_uses_per_client  INTEGER       DEFAULT 1,
                stackable            BOOLEAN       DEFAULT FALSE,
                starts_at            TIMESTAMPTZ,
                ends_at              TIMESTAMPTZ,
                -- 3. Campos herdados
                tenant_id            INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active               BOOLEAN       DEFAULT TRUE,
                created_at           TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at      TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(tenant_id, coupon_code),
                CONSTRAINT promotions_type_check       CHECK (type       IN ('pct_off','fixed_off','buy_x_get_y','free_shipping')),
                CONSTRAINT promotions_applies_to_check CHECK (applies_to IN ('all','product','category'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_promotions_tenant_id   ON promotions(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_promotions_active      ON promotions(active);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_promotions_coupon_code ON promotions(coupon_code);")

        # Índice parcial — janela de validade só faz sentido para promoções ativas.
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_promotions_window
                ON promotions (tenant_id, starts_at, ends_at)
                WHERE active = TRUE;
        """)

    logger.info("0008_cadastros_promotions applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0008_cadastros_promotions...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS promotions CASCADE;")
    logger.info("0008_cadastros_promotions rolled back.")
