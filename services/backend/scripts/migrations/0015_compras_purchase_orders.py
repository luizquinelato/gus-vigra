#!/usr/bin/env python3
"""
Migration 0015: Compras — Purchase Orders & Receipts
=====================================================
Project : Vigra
Module  : compras
Creates : purchase_orders, purchase_order_items,
          purchase_order_receipts, purchase_order_receipt_items
Alters  : supplier_ratings.purchase_order_id (adiciona FK)

Pedido de Compra (PO) com ciclo de vida:
  draft → pending_approval → approved → sent
                                       → partially_received → received
                                       └→ cancelled

Recibos rastreáveis (purchase_order_receipts) — uma PO pode ter N recibos
parciais. Cada recibo emite `purchase.received` via emit_reliable.

Depende de 0013 (suppliers/ratings), 0010 (warehouses), 0006 (products),
0014 (purchase_quotations).
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0015_compras_purchase_orders...")
    with conn.cursor() as cur:

        # 1. purchase_orders
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_orders (
                -- 1. ID
                id                     SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                po_number              VARCHAR(30)   NOT NULL,
                status                 VARCHAR(30)   NOT NULL DEFAULT 'draft',
                subtotal               NUMERIC(15,2) DEFAULT 0,
                discount_amount        NUMERIC(15,2) DEFAULT 0,
                shipping_amount        NUMERIC(15,2) DEFAULT 0,
                total_amount           NUMERIC(15,2) DEFAULT 0,
                payment_terms_days     INTEGER,
                expected_delivery_date DATE,
                notes                  TEXT,
                sent_at                TIMESTAMPTZ,
                cancelled_at           TIMESTAMPTZ,
                cancellation_reason    TEXT,
                approved_at            TIMESTAMPTZ,
                -- 3. FKs internas
                supplier_id            INTEGER       NOT NULL REFERENCES suppliers(id)           ON DELETE RESTRICT,
                warehouse_id           INTEGER       NOT NULL REFERENCES warehouses(id)          ON DELETE RESTRICT,
                quotation_id           INTEGER       REFERENCES purchase_quotations(id)          ON DELETE SET NULL,
                approved_by            INTEGER       REFERENCES users(id),
                created_by             INTEGER       REFERENCES users(id),
                -- 4. Campos herdados
                tenant_id              INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active                 BOOLEAN       DEFAULT TRUE,
                created_at             TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at        TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(tenant_id, po_number),
                CONSTRAINT purchase_orders_status_check
                    CHECK (status IN ('draft','pending_approval','approved','sent',
                                      'partially_received','received','cancelled'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders (tenant_id, supplier_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_orders_status   ON purchase_orders (tenant_id, status) WHERE active = TRUE;")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_orders_warehouse ON purchase_orders(warehouse_id);")

        # 2. purchase_order_items
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_order_items (
                -- 1. ID
                id                  SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                quantity_ordered    NUMERIC(15,3) NOT NULL,
                quantity_received   NUMERIC(15,3) NOT NULL DEFAULT 0,
                unit_cost           NUMERIC(15,4) NOT NULL,
                discount_pct        NUMERIC(5,2)  DEFAULT 0,
                total_cost          NUMERIC(15,2) NOT NULL,
                notes               TEXT,
                -- 3. FKs internas
                purchase_order_id   INTEGER       NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
                product_id          INTEGER       NOT NULL REFERENCES products(id)        ON DELETE RESTRICT,
                warehouse_id        INTEGER       REFERENCES warehouses(id)               ON DELETE RESTRICT,
                -- 4. Campos herdados
                tenant_id           INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active              BOOLEAN       DEFAULT TRUE,
                created_at          TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at     TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(purchase_order_id, product_id),
                CONSTRAINT purchase_order_items_qty_positive    CHECK (quantity_ordered > 0),
                CONSTRAINT purchase_order_items_received_nonneg CHECK (quantity_received >= 0),
                CONSTRAINT purchase_order_items_received_le_ordered
                    CHECK (quantity_received <= quantity_ordered)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id      ON purchase_order_items(purchase_order_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id ON purchase_order_items(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_order_items_tenant_id  ON purchase_order_items(tenant_id);")

        # 3. purchase_order_receipts (append-only — sem soft delete real)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_order_receipts (
                -- 1. ID
                id                SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                received_at       TIMESTAMPTZ   DEFAULT NOW(),
                invoice_number    VARCHAR(50),
                invoice_date      DATE,
                notes             TEXT,
                -- 3. FKs internas
                purchase_order_id INTEGER       NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
                received_by       INTEGER       REFERENCES users(id),
                -- 4. Campos herdados
                tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active            BOOLEAN       DEFAULT TRUE,
                created_at        TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at   TIMESTAMPTZ   DEFAULT NOW()
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_order_receipts_po        ON purchase_order_receipts (tenant_id, purchase_order_id);")

        # 4. purchase_order_receipt_items
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
                -- 1. ID
                id                       SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                quantity_received        NUMERIC(15,3) NOT NULL,
                unit_cost                NUMERIC(15,4) NOT NULL,
                discrepancy_notes        TEXT,
                -- 3. FKs internas
                receipt_id               INTEGER       NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
                purchase_order_item_id   INTEGER       NOT NULL REFERENCES purchase_order_items(id)    ON DELETE RESTRICT,
                product_id               INTEGER       NOT NULL REFERENCES products(id)                ON DELETE RESTRICT,
                warehouse_id             INTEGER       NOT NULL REFERENCES warehouses(id)              ON DELETE RESTRICT,
                -- 4. Campos herdados
                tenant_id                INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active                   BOOLEAN       DEFAULT TRUE,
                created_at               TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at          TIMESTAMPTZ   DEFAULT NOW(),
                CONSTRAINT receipt_items_qty_positive CHECK (quantity_received > 0)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON purchase_order_receipt_items(receipt_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_receipt_items_po_item_id ON purchase_order_receipt_items(purchase_order_item_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_receipt_items_tenant_id  ON purchase_order_receipt_items(tenant_id);")

        # 5. Adiciona FK de supplier_ratings.purchase_order_id (criada sem FK em 0013).
        cur.execute("""
            ALTER TABLE supplier_ratings
            ADD CONSTRAINT supplier_ratings_purchase_order_fk
            FOREIGN KEY (purchase_order_id)
            REFERENCES purchase_orders(id) ON DELETE SET NULL;
        """)

    logger.info("0015_compras_purchase_orders applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0015_compras_purchase_orders...")
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE supplier_ratings DROP CONSTRAINT IF EXISTS supplier_ratings_purchase_order_fk;")
        cur.execute("DROP TABLE IF EXISTS purchase_order_receipt_items CASCADE;")
        cur.execute("DROP TABLE IF EXISTS purchase_order_receipts      CASCADE;")
        cur.execute("DROP TABLE IF EXISTS purchase_order_items         CASCADE;")
        cur.execute("DROP TABLE IF EXISTS purchase_orders              CASCADE;")
    logger.info("0015_compras_purchase_orders rolled back.")
