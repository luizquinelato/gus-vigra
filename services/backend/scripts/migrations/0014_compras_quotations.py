#!/usr/bin/env python3
"""
Migration 0014: Compras — Purchase Quotations (RFQ)
====================================================
Project : Vigra
Module  : compras
Creates : purchase_quotations, purchase_quotation_items, purchase_quotation_responses

Cotações (RFQ) — operador cria com N itens e envia para M fornecedores.
Cada fornecedor responde com unit_price, delivery_days, payment_terms.
Aprovação de uma resposta gera 1 PO (lógica no service, não no DB).

status enum: ('open','responded','approved','cancelled').

Depende de 0013 (suppliers) e 0006 (products).
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0014_compras_quotations...")
    with conn.cursor() as cur:

        # 1. purchase_quotations
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_quotations (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                status          VARCHAR(20)  NOT NULL DEFAULT 'open',
                notes           TEXT,
                expires_at      TIMESTAMPTZ,
                -- 3. FKs internas
                created_by      INTEGER      REFERENCES users(id),
                -- 4. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
                CONSTRAINT purchase_quotations_status_check
                    CHECK (status IN ('open','responded','approved','cancelled'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_quotations_tenant_id ON purchase_quotations(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_quotations_status    ON purchase_quotations(status);")

        # 2. purchase_quotation_items
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_quotation_items (
                -- 1. ID
                id                 SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                requested_quantity NUMERIC(15,3) NOT NULL,
                notes              TEXT,
                -- 3. FKs internas
                quotation_id       INTEGER       NOT NULL REFERENCES purchase_quotations(id) ON DELETE CASCADE,
                product_id         INTEGER       NOT NULL REFERENCES products(id)            ON DELETE RESTRICT,
                -- 4. Campos herdados
                tenant_id          INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active             BOOLEAN       DEFAULT TRUE,
                created_at         TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at    TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(quotation_id, product_id),
                CONSTRAINT purchase_quotation_items_qty_positive CHECK (requested_quantity > 0)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_quotation_items_quotation_id ON purchase_quotation_items(quotation_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_quotation_items_tenant_id    ON purchase_quotation_items(tenant_id);")

        # 3. purchase_quotation_responses
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_quotation_responses (
                -- 1. ID
                id              SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                unit_price      NUMERIC(15,4),
                delivery_days   INTEGER,
                payment_terms   TEXT,
                notes           TEXT,
                responded_at    TIMESTAMPTZ   DEFAULT NOW(),
                -- 3. FKs internas
                quotation_id    INTEGER       NOT NULL REFERENCES purchase_quotations(id) ON DELETE CASCADE,
                supplier_id     INTEGER       NOT NULL REFERENCES suppliers(id)           ON DELETE RESTRICT,
                -- 4. Campos herdados
                tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN       DEFAULT TRUE,
                created_at      TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(quotation_id, supplier_id)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_quotation_responses_quotation ON purchase_quotation_responses(quotation_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_quotation_responses_supplier  ON purchase_quotation_responses(supplier_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_quotation_responses_tenant_id ON purchase_quotation_responses(tenant_id);")

    logger.info("0014_compras_quotations applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0014_compras_quotations...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS purchase_quotation_responses CASCADE;")
        cur.execute("DROP TABLE IF EXISTS purchase_quotation_items     CASCADE;")
        cur.execute("DROP TABLE IF EXISTS purchase_quotations          CASCADE;")
    logger.info("0014_compras_quotations rolled back.")
