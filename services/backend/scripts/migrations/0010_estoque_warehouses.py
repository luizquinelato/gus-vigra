#!/usr/bin/env python3
"""
Migration 0010: Estoque — Warehouses
====================================
Project : Vigra
Module  : estoque
Creates : warehouses

Depósitos físicos/virtuais por tenant. Pode ser uma loja, um galpão, uma
caixa-mãe ou um marketplace (ex.: "Estoque Mercado Livre").

`is_default` marca o depósito padrão do tenant — único via partial unique
index. Estoque consultado sem `warehouse_id` cai neste default (lido pelo
service `get_balance` ou pelos subscribers de eventos).

Faixa do módulo Estoque: 0010–0019.

Runner registra esta migration em migration_history após apply() suceder.
NÃO registre dentro de apply() — o runner cuida disso.
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0010_estoque_warehouses...")
    with conn.cursor() as cur:

        # 1. warehouses
        # Depósitos físicos/virtuais por tenant. is_default único por tenant
        # via partial unique index — só uma row pode ter is_default=TRUE
        # entre as ativas.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS warehouses (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                code            VARCHAR(20)  NOT NULL,
                name            VARCHAR(100) NOT NULL,
                type            VARCHAR(20)  NOT NULL DEFAULT 'physical',
                address_line    VARCHAR(200),
                city            VARCHAR(100),
                state           VARCHAR(2),
                zip_code        VARCHAR(10),
                is_default      BOOLEAN      NOT NULL DEFAULT FALSE,
                notes           TEXT,
                -- 3. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
                UNIQUE(tenant_id, code),
                CONSTRAINT warehouses_type_check
                    CHECK (type IN ('physical','virtual','marketplace','consignment'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_id ON warehouses(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_warehouses_active    ON warehouses(active);")
        # Partial unique index: somente uma row ativa pode ser is_default por tenant.
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_default_per_tenant
                ON warehouses (tenant_id)
                WHERE is_default = TRUE AND active = TRUE;
        """)

        # 2. Seed: 1 warehouse default por tenant ativo (idempotente).
        # Garante que entradas/saídas de estoque sempre tenham um destino.
        cur.execute("SELECT id FROM tenants WHERE active = TRUE;")
        tenant_ids = [r["id"] for r in cur.fetchall()]
        for tid in tenant_ids:
            cur.execute(
                """
                INSERT INTO warehouses (code, name, type, is_default, tenant_id)
                VALUES ('PRINCIPAL', 'Depósito Principal', 'physical', TRUE, %s)
                ON CONFLICT (tenant_id, code) DO NOTHING;
                """,
                (tid,),
            )
        logger.info("  Depósito padrão seedado para %d tenant(s).", len(tenant_ids))

    logger.info("0010_estoque_warehouses applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0010_estoque_warehouses...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS warehouses CASCADE;")
    logger.info("0010_estoque_warehouses rolled back.")
