#!/usr/bin/env python3
"""
Migration 0013: Compras — Suppliers, Contacts & Ratings
========================================================
Project : Vigra
Module  : compras
Creates : suppliers, supplier_contacts, supplier_ratings

Cadastro de fornecedores (PF/PJ) e contatos. Avaliação opcional por PO.

`document` (CNPJ/CPF) único por tenant — CHECK garante 11 ou 14 dígitos numéricos.
`is_primary` único por fornecedor ativo via partial index.
Avaliação 1-5 por PO recebida (UNIQUE supplier_id+purchase_order_id),
agregada em runtime para `supplier.avg_rating`.

Faixa do módulo Compras: 0013–0019.
Depende de 0010 (warehouses).
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0013_compras_suppliers...")
    with conn.cursor() as cur:

        # 1. suppliers
        cur.execute("""
            CREATE TABLE IF NOT EXISTS suppliers (
                -- 1. ID
                id                       SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                type                     VARCHAR(2)    NOT NULL DEFAULT 'pj',
                name                     VARCHAR(200)  NOT NULL,
                trade_name               VARCHAR(200),
                document                 VARCHAR(18)   NOT NULL,
                email                    VARCHAR(200),
                phone                    VARCHAR(20),
                payment_terms_days       INTEGER       DEFAULT 30,
                discount_pct             NUMERIC(5,2)  DEFAULT 0,
                notes                    TEXT,
                -- 3. FKs internas
                default_warehouse_id     INTEGER       REFERENCES warehouses(id) ON DELETE SET NULL,
                -- 4. Campos herdados
                tenant_id                INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active                   BOOLEAN       DEFAULT TRUE,
                created_at               TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at          TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(tenant_id, document),
                CONSTRAINT suppliers_type_check CHECK (type IN ('pf','pj')),
                CONSTRAINT suppliers_document_format CHECK (
                    document ~ '^[0-9]{11}$' OR document ~ '^[0-9]{14}$'
                )
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_id ON suppliers(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_suppliers_active    ON suppliers(active);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_suppliers_name      ON suppliers(name);")

        # 2. supplier_contacts
        cur.execute("""
            CREATE TABLE IF NOT EXISTS supplier_contacts (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                name            VARCHAR(100),
                role            VARCHAR(100),
                email           VARCHAR(200),
                phone           VARCHAR(20),
                is_primary      BOOLEAN      DEFAULT FALSE,
                -- 3. FKs internas
                supplier_id     INTEGER      NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
                -- 4. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW()
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier_id ON supplier_contacts(supplier_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_supplier_contacts_tenant_id   ON supplier_contacts(tenant_id);")
        # Único contato primário por fornecedor ativo.
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_contacts_primary
                ON supplier_contacts (supplier_id)
                WHERE is_primary = TRUE AND active = TRUE;
        """)

        # 3. supplier_ratings (1 por PO recebida)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS supplier_ratings (
                -- 1. ID
                id                SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                delivery_rating   SMALLINT,
                quality_rating    SMALLINT,
                price_rating      SMALLINT,
                notes             TEXT,
                -- 3. FKs internas (purchase_orders ainda não existe — coluna sem FK até 0015)
                supplier_id       INTEGER      NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
                purchase_order_id INTEGER,
                rated_by          INTEGER      REFERENCES users(id),
                -- 4. Campos herdados
                tenant_id         INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active            BOOLEAN      DEFAULT TRUE,
                created_at        TIMESTAMPTZ  DEFAULT NOW(),
                CONSTRAINT supplier_ratings_delivery_range CHECK (delivery_rating BETWEEN 1 AND 5),
                CONSTRAINT supplier_ratings_quality_range  CHECK (quality_rating  BETWEEN 1 AND 5),
                CONSTRAINT supplier_ratings_price_range    CHECK (price_rating    BETWEEN 1 AND 5),
                UNIQUE(supplier_id, purchase_order_id)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_supplier_ratings_tenant_id ON supplier_ratings(tenant_id);")

    logger.info("0013_compras_suppliers applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0013_compras_suppliers...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS supplier_ratings  CASCADE;")
        cur.execute("DROP TABLE IF EXISTS supplier_contacts CASCADE;")
        cur.execute("DROP TABLE IF EXISTS suppliers         CASCADE;")
    logger.info("0013_compras_suppliers rolled back.")
