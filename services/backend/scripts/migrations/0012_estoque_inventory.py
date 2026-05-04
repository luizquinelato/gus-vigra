#!/usr/bin/env python3
"""
Migration 0012: Estoque — Inventory Counts & Settings
=====================================================
Project : Vigra
Module  : estoque
Creates : inventory_counts, inventory_count_items
Seeds   : system_settings (estoque_*)

Inventário físico (snapshot + ajuste):
- inventory_counts        : sessão de contagem (status open → counting → closed/cancelled).
- inventory_count_items   : 1 row por (product_id, warehouse_id) listado.
                            expected_quantity é o snapshot na abertura;
                            counted_quantity é a contagem física;
                            adjustment_quantity = counted - expected (gerado no close).

Settings seedados (controlam comportamento de Estoque):
- stock_costing_method            : "average" | "fifo"
- stock_allow_negative            : "true" | "false"
- stock_default_warehouse_id      : id do warehouse default (sobrescreve is_default flag)
- stock_low_alert_enabled         : "true" | "false"

Depende de 0011 (stock_balances) e 0010 (warehouses).
"""
import logging

logger = logging.getLogger(__name__)

DEFAULT_SETTINGS = [
    ("stock_costing_method",       "average", "Método de custeio: 'average' (médio ponderado) ou 'fifo'."),
    ("stock_allow_negative",       "false",   "Se 'true', saídas sem saldo passam (saldo fica negativo)."),
    ("stock_default_warehouse_id", "",        "ID do depósito default (sobrescreve flag is_default). Vazio = usa is_default."),
    ("stock_low_alert_enabled",    "true",    "Liga/desliga emissão de stock.low quando quantity ≤ min_quantity."),
]


def apply(conn) -> None:
    logger.info("Applying 0012_estoque_inventory...")
    with conn.cursor() as cur:

        # 1. inventory_counts
        # Snapshot de saldos esperados na abertura; ajustes só ocorrem no close.
        # status: open → counting → closed (ou cancelled).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventory_counts (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                code            VARCHAR(30)  NOT NULL,
                description     TEXT,
                status          VARCHAR(20)  NOT NULL DEFAULT 'open',
                opened_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                closed_at       TIMESTAMPTZ,
                cancelled_at    TIMESTAMPTZ,
                -- 3. FKs internas
                warehouse_id    INTEGER      NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
                opened_by       INTEGER      REFERENCES users(id),
                closed_by       INTEGER      REFERENCES users(id),
                -- 4. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
                UNIQUE(tenant_id, code),
                CONSTRAINT inventory_counts_status_check
                    CHECK (status IN ('open','counting','closed','cancelled'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_counts_tenant_id    ON inventory_counts(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_counts_warehouse_id ON inventory_counts(warehouse_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_counts_status       ON inventory_counts(status);")

        # 2. inventory_count_items
        # 1 row por produto listado. expected_quantity é o congelado na abertura.
        # counted_quantity = NULL antes da contagem; preenchido pela UI.
        # adjustment_quantity é gerado no close (counted - expected).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventory_count_items (
                -- 1. ID
                id                  SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                expected_quantity   NUMERIC(15,3) NOT NULL,
                counted_quantity    NUMERIC(15,3),
                adjustment_quantity NUMERIC(15,3),
                notes               TEXT,
                -- 3. FKs internas
                inventory_count_id  INTEGER       NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
                product_id          INTEGER       NOT NULL REFERENCES products(id)         ON DELETE RESTRICT,
                -- 4. Campos herdados
                tenant_id           INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active              BOOLEAN       DEFAULT TRUE,
                created_at          TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at     TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(inventory_count_id, product_id)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count_id  ON inventory_count_items(inventory_count_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_count_items_product_id ON inventory_count_items(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_count_items_tenant_id ON inventory_count_items(tenant_id);")

        # 3. Seed: settings padrão por tenant (idempotente).
        cur.execute("SELECT id FROM tenants WHERE active = TRUE;")
        tenant_ids = [r["id"] for r in cur.fetchall()]
        for tid in tenant_ids:
            for key, val, desc in DEFAULT_SETTINGS:
                cur.execute(
                    """
                    INSERT INTO system_settings (setting_key, setting_value, description, tenant_id)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (tenant_id, setting_key) DO NOTHING;
                    """,
                    (key, val, desc, tid),
                )
        logger.info("  Settings de Estoque seedados para %d tenant(s).", len(tenant_ids))

    logger.info("0012_estoque_inventory applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0012_estoque_inventory...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS inventory_count_items CASCADE;")
        cur.execute("DROP TABLE IF EXISTS inventory_counts      CASCADE;")
        cur.execute(
            """
            DELETE FROM system_settings
            WHERE setting_key IN (
                'stock_costing_method',
                'stock_allow_negative',
                'stock_default_warehouse_id',
                'stock_low_alert_enabled'
            );
            """
        )
    logger.info("0012_estoque_inventory rolled back.")
