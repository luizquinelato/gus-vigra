#!/usr/bin/env python3
"""
Migration 0011: Estoque — Balances, Movements, Lots & Reservations
==================================================================
Project : Vigra
Module  : estoque
Creates : stock_balances, stock_movements, stock_lots, stock_reservations

Núcleo do módulo Estoque (modelo flat — saldo por (product_id, warehouse_id)):

- stock_balances : saldo corrente — UPSERT lazy ao primeiro movimento.
                   Mantém quantity, reserved_quantity, avg_cost, min_quantity.
- stock_movements: append-only (log de auditoria). Toda mutação passa por aqui.
                   `outbox_event_id UNIQUE` é a chave de idempotência para
                   subscribers de Compras/Vendas (INSERT ... ON CONFLICT DO NOTHING).
- stock_lots     : lotes FIFO (opcional, controlado por system_settings).
                   Cada entrada cria 1 lote; saídas consomem em ordem
                   `entry_date ASC, id ASC` decrementando remaining_quantity.
- stock_reservations: pré-saídas (Vendas) — reserva saldo ao confirmar pedido,
                   consome ao pagar, libera ao cancelar/expirar.

Depende de 0010 (warehouses) e 0006 (products).
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0011_estoque_movements...")
    with conn.cursor() as cur:

        # 1. stock_balances
        # UNIQUE (product_id, warehouse_id) — saldo por par. Criado lazy.
        # avg_cost mantido em paralelo mesmo em FIFO (relatórios agregados).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_balances (
                -- 1. ID
                id                 SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                quantity           NUMERIC(15,3) NOT NULL DEFAULT 0,
                reserved_quantity  NUMERIC(15,3) NOT NULL DEFAULT 0,
                avg_cost           NUMERIC(15,4) NOT NULL DEFAULT 0,
                min_quantity       NUMERIC(15,3) NOT NULL DEFAULT 0,
                max_quantity       NUMERIC(15,3),
                -- 3. FKs internas
                product_id         INTEGER       NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
                warehouse_id       INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
                -- 4. Campos herdados
                tenant_id          INTEGER       NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
                active             BOOLEAN       DEFAULT TRUE,
                created_at         TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at    TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(product_id, warehouse_id),
                CONSTRAINT stock_balances_qty_nonneg
                    CHECK (quantity >= 0 OR quantity < 0),
                CONSTRAINT stock_balances_reserved_nonneg
                    CHECK (reserved_quantity >= 0)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_balances_product_id   ON stock_balances(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_balances_warehouse_id ON stock_balances(warehouse_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_balances_tenant_id    ON stock_balances(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_balances_low ON stock_balances(tenant_id) WHERE quantity <= min_quantity;")

        # 2. stock_movements (append-only)
        # quantity SEMPRE positiva; sinal vem do `type`.
        # outbox_event_id UNIQUE: idempotência para subscribers de eventos
        # confiáveis (purchase.received, order.paid, etc.).
        # reference_type/reference_id: link informativo para o documento de
        # origem (purchase_order_id, sales_order_id, inventory_count_id, etc.).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_movements (
                -- 1. ID
                id                BIGSERIAL     PRIMARY KEY,
                -- 2. Campos próprios
                type              VARCHAR(20)   NOT NULL,
                quantity          NUMERIC(15,3) NOT NULL,
                unit_cost         NUMERIC(15,4) NOT NULL DEFAULT 0,
                reason            VARCHAR(50),
                notes             TEXT,
                reference_type    VARCHAR(40),
                reference_id      INTEGER,
                outbox_event_id   BIGINT,
                -- 3. FKs internas
                product_id        INTEGER       NOT NULL REFERENCES products(id)   ON DELETE RESTRICT,
                warehouse_id      INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
                created_by        INTEGER       REFERENCES users(id),
                -- 4. Campos herdados
                tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_at        TIMESTAMPTZ   DEFAULT NOW(),
                CONSTRAINT stock_movements_qty_positive CHECK (quantity > 0),
                CONSTRAINT stock_movements_type_check CHECK (type IN (
                    'entry','exit','adjustment','transfer_in','transfer_out',
                    'reservation','release','consumption','return_in','return_out'
                ))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id   ON stock_movements(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse_id ON stock_movements(warehouse_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id    ON stock_movements(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_reference    ON stock_movements(reference_type, reference_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at   ON stock_movements(created_at DESC);")
        # Idempotência: composta por (outbox_event_id, reference_type, reference_id).
        # Permite N movimentos por evento (1 por item de recibo) mas garante que
        # re-entregas do OutboxProcessor não duplicam movimentos.
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_outbox
                ON stock_movements(outbox_event_id, reference_type, reference_id)
                WHERE outbox_event_id IS NOT NULL;
        """)

        # 3. stock_lots (FIFO opcional)
        # Cada entrada cria 1 lote com unit_cost e remaining_quantity.
        # Saídas consomem em ordem entry_date ASC, id ASC.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_lots (
                -- 1. ID
                id                 BIGSERIAL     PRIMARY KEY,
                -- 2. Campos próprios
                lot_code           VARCHAR(50),
                quantity           NUMERIC(15,3) NOT NULL,
                remaining_quantity NUMERIC(15,3) NOT NULL,
                unit_cost          NUMERIC(15,4) NOT NULL,
                entry_date         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
                expiration_date    DATE,
                -- 3. FKs internas
                product_id         INTEGER       NOT NULL REFERENCES products(id)         ON DELETE RESTRICT,
                warehouse_id       INTEGER       NOT NULL REFERENCES warehouses(id)       ON DELETE RESTRICT,
                source_movement_id BIGINT        REFERENCES stock_movements(id)           ON DELETE SET NULL,
                -- 4. Campos herdados
                tenant_id          INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active             BOOLEAN       DEFAULT TRUE,
                created_at         TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at    TIMESTAMPTZ   DEFAULT NOW(),
                CONSTRAINT stock_lots_qty_positive CHECK (quantity > 0),
                CONSTRAINT stock_lots_remaining_nonneg CHECK (remaining_quantity >= 0),
                CONSTRAINT stock_lots_remaining_le_qty CHECK (remaining_quantity <= quantity)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_lots_product_id   ON stock_lots(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_lots_warehouse_id ON stock_lots(warehouse_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_lots_tenant_id    ON stock_lots(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_lots_fifo ON stock_lots(product_id, warehouse_id, entry_date, id) WHERE remaining_quantity > 0;")

        # 4. stock_reservations
        # Reserva de saldo durante o ciclo de venda (Vendas).
        # status ∈ ('active','consumed','released','expired').
        # consumed_at preenchido em order.paid; released_at em order.cancelled
        # ou expiração via job background.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_reservations (
                -- 1. ID
                id                BIGSERIAL     PRIMARY KEY,
                -- 2. Campos próprios
                quantity          NUMERIC(15,3) NOT NULL,
                status            VARCHAR(20)   NOT NULL DEFAULT 'active',
                expires_at        TIMESTAMPTZ,
                consumed_at       TIMESTAMPTZ,
                released_at       TIMESTAMPTZ,
                reference_type    VARCHAR(40),
                reference_id      INTEGER,
                outbox_event_id   BIGINT,
                -- 3. FKs internas
                product_id        INTEGER       NOT NULL REFERENCES products(id)   ON DELETE RESTRICT,
                warehouse_id      INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
                -- 4. Campos herdados
                tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_at        TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at   TIMESTAMPTZ   DEFAULT NOW(),
                CONSTRAINT stock_reservations_qty_positive CHECK (quantity > 0),
                CONSTRAINT stock_reservations_status_check
                    CHECK (status IN ('active','consumed','released','expired'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_reservations_product_id   ON stock_reservations(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_reservations_warehouse_id ON stock_reservations(warehouse_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_reservations_tenant_id    ON stock_reservations(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_reservations_active ON stock_reservations(product_id, warehouse_id) WHERE status = 'active';")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_reservations_reference    ON stock_reservations(reference_type, reference_id);")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_reservations_outbox ON stock_reservations(outbox_event_id) WHERE outbox_event_id IS NOT NULL;")

    logger.info("0011_estoque_movements applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0011_estoque_movements...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS stock_reservations CASCADE;")
        cur.execute("DROP TABLE IF EXISTS stock_lots         CASCADE;")
        cur.execute("DROP TABLE IF EXISTS stock_movements    CASCADE;")
        cur.execute("DROP TABLE IF EXISTS stock_balances     CASCADE;")
    logger.info("0011_estoque_movements rolled back.")
