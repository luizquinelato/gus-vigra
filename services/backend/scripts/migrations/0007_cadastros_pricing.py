#!/usr/bin/env python3
"""
Migration 0007: Cadastros — Pricing Tables
==========================================
Project : Vigra
Module  : cadastros
Creates : price_tables, price_table_items

Tabelas de preço por canal/grupo/período:
- price_tables: definição da tabela (Varejo, Atacado, VIP) com estratégia
  ('fixed' = preço por item; 'percentage_off' = % sobre products.price).
- price_table_items: preço fixo por produto dentro de uma tabela.

Prioridade aplicada em runtime: promoção ativa > tabela de preço do
cliente > tabela padrão (is_default=TRUE) > products.price.

Depende de 0006 (products).

Runner registra esta migration em migration_history após apply() suceder.
NÃO registre dentro de apply() — o runner cuida disso.
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0007_cadastros_pricing...")
    with conn.cursor() as cur:

        # 1. price_tables
        # type ∈ ('fixed','percentage_off'). is_default=TRUE marca a tabela
        # padrão do tenant — unicidade garantida pelo partial unique index abaixo.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS price_tables (
                -- 1. ID
                id              SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                name            VARCHAR(100)  NOT NULL,
                type            VARCHAR(20)   DEFAULT 'fixed',
                discount_pct    NUMERIC(5,2)  DEFAULT 0,
                is_default      BOOLEAN       DEFAULT FALSE,
                -- 3. Campos herdados
                tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN       DEFAULT TRUE,
                created_at      TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
                CONSTRAINT price_tables_type_check CHECK (type IN ('fixed','percentage_off'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_tables_tenant_id  ON price_tables(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_tables_active     ON price_tables(active);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_tables_is_default ON price_tables(is_default);")
        # Garante apenas uma tabela padrão ativa por tenant (invariante no banco).
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_price_tables_default_per_tenant
            ON price_tables (tenant_id)
            WHERE is_default = TRUE AND active = TRUE;
        """)

        # 2. price_table_items
        # Sem tenant_id direto — isolamento cascateia via price_table_id
        # e product_id.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS price_table_items (
                -- 1. ID
                id              SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                price           NUMERIC(15,2) NOT NULL,
                -- 3. FKs internas
                price_table_id  INTEGER       NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
                product_id      INTEGER       NOT NULL REFERENCES products(id)     ON DELETE CASCADE,
                -- 4. Campos herdados (sem tenant_id — herda via FKs)
                active          BOOLEAN       DEFAULT TRUE,
                created_at      TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(price_table_id, product_id)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_table_items_table_id   ON price_table_items(price_table_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_table_items_product_id ON price_table_items(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_table_items_active     ON price_table_items(active);")

    logger.info("0007_cadastros_pricing applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0007_cadastros_pricing...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS price_table_items CASCADE;")
        cur.execute("DROP TABLE IF EXISTS price_tables      CASCADE;")
    logger.info("0007_cadastros_pricing rolled back.")
