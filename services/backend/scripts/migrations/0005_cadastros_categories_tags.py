#!/usr/bin/env python3
"""
Migration 0005: Cadastros — Categories & Tags
=============================================
Project : Vigra
Module  : cadastros
Creates : product_categories, product_tags

Tabelas raízes do módulo Cadastros (sem dependências internas).
- product_categories: árvore (auto-referencial via parent_id) por tenant.
- product_tags: marcadores livres reutilizáveis entre produtos.

Faixa do módulo Cadastros: 0005–0009. Próximas migrations alteram
estas tabelas ou adicionam colunas — não renumerar.

Runner registra esta migration em migration_history após apply() suceder.
NÃO registre dentro de apply() — o runner cuida disso.
"""
import logging

logger = logging.getLogger(__name__)


def apply(conn) -> None:
    logger.info("Applying 0005_cadastros_categories_tags...")
    with conn.cursor() as cur:

        # 1. product_categories
        # Árvore por tenant; parent_id auto-referencial (NULL = raiz).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_categories (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                name            VARCHAR(100) NOT NULL,
                slug            VARCHAR(120) NOT NULL,
                icon            VARCHAR(50),
                -- 3. FKs internas
                parent_id       INTEGER      REFERENCES product_categories(id) ON DELETE SET NULL,
                -- 4. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
                UNIQUE(tenant_id, slug)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_categories_tenant_id ON product_categories(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_categories_parent_id ON product_categories(parent_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_categories_active    ON product_categories(active);")

        # 2. product_tags
        # Marcadores livres por tenant; usados para coleções dinâmicas na loja.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_tags (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                name            VARCHAR(100) NOT NULL,
                slug            VARCHAR(120) NOT NULL,
                -- 3. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
                UNIQUE(tenant_id, slug)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_tags_tenant_id ON product_tags(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_tags_active    ON product_tags(active);")

    logger.info("0005_cadastros_categories_tags applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0005_cadastros_categories_tags...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS product_tags        CASCADE;")
        cur.execute("DROP TABLE IF EXISTS product_categories  CASCADE;")
    logger.info("0005_cadastros_categories_tags rolled back.")
