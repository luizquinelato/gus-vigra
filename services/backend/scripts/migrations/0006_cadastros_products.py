#!/usr/bin/env python3
"""
Migration 0006: Cadastros — Families, Characteristics, Products, Kits & Images
==============================================================================
Project : Vigra
Module  : cadastros
Creates : product_families, product_characteristics,
          product_characteristic_values, products, product_kit_items,
          product_images, product_characteristic_links, product_tag_links

Modelo flat: cada linha de `products` é um item vendável (SKU). Sem
hierarquia pai/filho. O agrupamento opcional via `family_id` (FK para
product_families) liga "irmãos" da mesma família para UI/relatórios/promoções.

- product_families: catálogo de famílias por tenant (entidade própria,
  substitui o antigo VARCHAR `family` em products/images).
  Inclui `defaults` (JSONB) com valores padrão herdáveis dos produtos da
  família — as chaves são colunas de products gerenciadas no nível de família
  (ex.: brand, category_id, unit, description). Inclui `characteristic_ids`
  (INTEGER[]) listando quais características esta família varia (ex.:
  ["Cor","Tamanho"] = produtos da família terão valores próprios para cada).
- product_characteristics: dimensões reutilizáveis (Cor, Tamanho, Voltagem)
  com `type` ∈ ('text','color','number') que destrava UI/storage específico.
- product_characteristic_values: valores de uma characteristic. Para
  type='color' grava `hex_color`; para type='number' grava `numeric_value`
  + `unit` opcional. Para type='text' apenas `value`.
- products: entidade vendável; type ∈ ('simple','kit'). Sem JSONB de
  attributes — características vivem em product_characteristic_links.
- product_kit_items: composição quando type='kit' (kit_id → component_id).
- product_images: imagens do produto. `family_id` opcional permite
  compartilhar a mesma URL entre todos os produtos de uma família.
- product_characteristic_links: M:N produto ↔ valor de characteristic.
  UNIQUE(product_id, characteristic_id) — 1 valor por characteristic por
  produto (ex.: "Cor primária" e "Cor secundária" devem ser characteristics
  distintas).
- product_tag_links: M:N entre products e product_tags (tabela 0005).

Depende de 0005 (product_categories, product_tags).

Runner registra esta migration em migration_history após apply() suceder.
NÃO registre dentro de apply() — o runner cuida disso.
"""
import logging

logger = logging.getLogger(__name__)


# Conjunto mínimo de características reaproveitáveis por MEI/MPE.
# Formato: (name, type, [(value, hex_color, numeric_value, unit), ...])
DEFAULT_CHARACTERISTICS = [
    ("Cor", "color", [
        ("Preto",    "#000000", None, None),
        ("Branco",   "#FFFFFF", None, None),
        ("Cinza",    "#808080", None, None),
        ("Vermelho", "#E53935", None, None),
        ("Azul",     "#1E88E5", None, None),
        ("Verde",    "#43A047", None, None),
        ("Amarelo",  "#FDD835", None, None),
        ("Rosa",     "#EC407A", None, None),
        ("Marrom",   "#6D4C41", None, None),
        ("Bege",     "#D7CCC8", None, None),
    ]),
    ("Tamanho", "text", [
        ("PP", None, None, None),
        ("P",  None, None, None),
        ("M",  None, None, None),
        ("G",  None, None, None),
        ("GG", None, None, None),
        ("XG", None, None, None),
    ]),
    ("Voltagem", "text", [
        ("110V",   None, None, None),
        ("220V",   None, None, None),
        ("Bivolt", None, None, None),
    ]),
]


def apply(conn) -> None:
    logger.info("Applying 0006_cadastros_products...")
    with conn.cursor() as cur:

        # 1. product_families
        # Catálogo de famílias por tenant (substitui o antigo VARCHAR `family`).
        # defaults: JSONB com chaves = colunas de products gerenciadas em nível
        #   de família (brand, category_id, unit, description, ncm, ...). O
        #   valor é propagado a todos os produtos via POST /apply-defaults.
        # characteristic_ids: lista de characteristic IDs que esta família
        #   varia (ex.: [Cor, Tamanho]). Cada produto da família escolhe seu
        #   próprio valor para cada characteristic listada.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_families (
                -- 1. ID
                id                 SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                name               VARCHAR(80)  NOT NULL,
                defaults           JSONB        NOT NULL DEFAULT '{}'::jsonb,
                characteristic_ids INTEGER[]    NOT NULL DEFAULT '{}'::int[],
                -- 3. Campos herdados
                tenant_id          INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active             BOOLEAN      DEFAULT TRUE,
                created_at         TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at    TIMESTAMPTZ  DEFAULT NOW(),
                UNIQUE(tenant_id, name)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_families_tenant_id ON product_families(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_families_active    ON product_families(active);")

        # 2. product_characteristics
        # Dimensões reutilizáveis (Cor, Tamanho, Voltagem). type imutável
        # após criação — para mudar é necessário deletar e recriar.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_characteristics (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                name            VARCHAR(50)  NOT NULL,
                type            VARCHAR(10)  NOT NULL DEFAULT 'text',
                -- 3. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
                UNIQUE(tenant_id, name),
                CONSTRAINT product_characteristics_type_check CHECK (type IN ('text','color','number'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_characteristics_tenant_id ON product_characteristics(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_characteristics_active    ON product_characteristics(active);")

        # 3. product_characteristic_values
        # Por tipo do parent: text → só `value`; color → `value`+`hex_color`;
        # number → `value`+`numeric_value`+`unit?`. Validação refinada no router.
        # tenant_id denormalizado para filtros rápidos sem JOIN com characteristic.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_characteristic_values (
                -- 1. ID
                id                SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                value             VARCHAR(100)  NOT NULL,
                hex_color         VARCHAR(7),
                numeric_value     NUMERIC(14,4),
                unit              VARCHAR(20),
                -- 3. FKs internas
                characteristic_id INTEGER       NOT NULL REFERENCES product_characteristics(id) ON DELETE CASCADE,
                -- 4. Campos herdados
                tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active            BOOLEAN       DEFAULT TRUE,
                created_at        TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at   TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(characteristic_id, value),
                CONSTRAINT product_characteristic_values_hex_format
                    CHECK (hex_color IS NULL OR hex_color ~ '^#[0-9A-Fa-f]{6}$')
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_characteristic_values_characteristic_id ON product_characteristic_values(characteristic_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_characteristic_values_tenant_id        ON product_characteristic_values(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_characteristic_values_active            ON product_characteristic_values(active);")

        # 4. products  (modelo flat)
        # code: identificador único humano por tenant (substitui SKU).
        # family_id: FK opcional para product_families (agrupa irmãos).
        # type ∈ ('simple','kit'); unit ∈ ('un','kg','m',...).
        # Características vivem em product_characteristic_links (ver tabela 7).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS products (
                -- 1. ID
                id                SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                code              VARCHAR(50)   NOT NULL,
                name              VARCHAR(200)  NOT NULL,
                barcode           VARCHAR(50),
                price             NUMERIC(15,2) NOT NULL DEFAULT 0,
                cost              NUMERIC(15,4) DEFAULT 0,
                unit              VARCHAR(20)   NOT NULL DEFAULT 'un',
                type              VARCHAR(10)   NOT NULL DEFAULT 'simple',
                brand             VARCHAR(100),
                slug              VARCHAR(250)  NOT NULL,
                description       TEXT,
                short_description TEXT,
                ncm               VARCHAR(10),
                weight_kg         NUMERIC(10,3),
                height_cm         NUMERIC(10,2),
                width_cm          NUMERIC(10,2),
                depth_cm          NUMERIC(10,2),
                meta_title        VARCHAR(200),
                meta_description  VARCHAR(500),
                -- 3. FKs internas
                family_id         INTEGER       REFERENCES product_families(id)   ON DELETE SET NULL,
                category_id       INTEGER       REFERENCES product_categories(id) ON DELETE SET NULL,
                -- 4. Campos herdados
                tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active            BOOLEAN       DEFAULT TRUE,
                created_at        TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at   TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(tenant_id, code),
                UNIQUE(tenant_id, slug),
                CONSTRAINT products_type_check CHECK (type IN ('simple','kit'))
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_products_tenant_id   ON products(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_products_family_id   ON products(family_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_products_active      ON products(active);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_products_brand       ON products(brand);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_products_code        ON products(code);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_products_barcode     ON products(barcode);")

        # 4. product_kit_items  (composição quando type='kit')
        # tenant_id denormalizado para filtros rápidos sem JOIN com products.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_kit_items (
                -- 1. ID
                id              SERIAL        PRIMARY KEY,
                -- 2. Campos próprios
                quantity        NUMERIC(15,3) NOT NULL DEFAULT 1,
                -- 3. FKs internas
                kit_id          INTEGER       NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                component_id    INTEGER       NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                -- 4. Campos herdados
                tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN       DEFAULT TRUE,
                created_at      TIMESTAMPTZ   DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
                UNIQUE(kit_id, component_id),
                CONSTRAINT product_kit_items_no_self CHECK (kit_id <> component_id)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_kit_items_kit_id       ON product_kit_items(kit_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_kit_items_component_id ON product_kit_items(component_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_kit_items_tenant_id    ON product_kit_items(tenant_id);")

        # 6. product_images
        # url: caminho público (/static/products/{tenant_id}/{filename}).
        # family_id: opcional — se preenchido, a imagem é compartilhada por
        #   todos os produtos da família (herança no GET /products/{id}/images).
        # sort_order: ordem de exibição (capa = menor).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_images (
                -- 1. ID
                id              SERIAL       PRIMARY KEY,
                -- 2. Campos próprios
                url             VARCHAR(500) NOT NULL,
                alt_text        VARCHAR(200),
                sort_order      INTEGER      NOT NULL DEFAULT 0,
                -- 3. FKs internas
                product_id      INTEGER      REFERENCES products(id)         ON DELETE CASCADE,
                family_id       INTEGER      REFERENCES product_families(id) ON DELETE CASCADE,
                -- 4. Campos herdados
                tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN      DEFAULT TRUE,
                created_at      TIMESTAMPTZ  DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
                CONSTRAINT product_images_scope_check CHECK (product_id IS NOT NULL OR family_id IS NOT NULL)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_images_tenant_id  ON product_images(tenant_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_images_family_id  ON product_images(family_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_images_active     ON product_images(active);")

        # 7. product_characteristic_links (M:N produto ↔ valor de characteristic)
        # UNIQUE(product_id, characteristic_id): 1 valor por characteristic
        # por produto (ex.: "Cor primária" e "Cor secundária" devem ser
        # characteristics distintas). tenant_id denormalizado para filtros
        # rápidos sem JOIN. characteristic_id também denormalizado a partir
        # de value_id por simetria com a UNIQUE acima.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_characteristic_links (
                -- 1. ID
                id                SERIAL      PRIMARY KEY,
                -- 2. FKs internas
                product_id        INTEGER     NOT NULL REFERENCES products(id)                       ON DELETE CASCADE,
                characteristic_id INTEGER     NOT NULL REFERENCES product_characteristics(id)        ON DELETE CASCADE,
                value_id          INTEGER     NOT NULL REFERENCES product_characteristic_values(id)  ON DELETE CASCADE,
                -- 3. Campos herdados
                tenant_id         INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active            BOOLEAN     DEFAULT TRUE,
                created_at        TIMESTAMPTZ DEFAULT NOW(),
                last_updated_at   TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(product_id, characteristic_id)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pcl_product_id        ON product_characteristic_links(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pcl_characteristic_id ON product_characteristic_links(characteristic_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pcl_value_id          ON product_characteristic_links(value_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pcl_tenant_id         ON product_characteristic_links(tenant_id);")

        # 8. product_tag_links (M:N)
        # tenant_id denormalizado para filtros rápidos sem JOIN com products/tags.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS product_tag_links (
                -- 1. ID
                id              SERIAL      PRIMARY KEY,
                -- 2. FKs internas
                product_id      INTEGER     NOT NULL REFERENCES products(id)     ON DELETE CASCADE,
                tag_id          INTEGER     NOT NULL REFERENCES product_tags(id) ON DELETE CASCADE,
                -- 3. Campos herdados
                tenant_id       INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                active          BOOLEAN     DEFAULT TRUE,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                last_updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(product_id, tag_id)
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_tag_links_product_id ON product_tag_links(product_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_tag_links_tag_id     ON product_tag_links(tag_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_product_tag_links_tenant_id  ON product_tag_links(tenant_id);")

        # 9. Seed: características padrão por tenant
        # Conjunto mínimo (Cor, Tamanho, Voltagem) editável/deletável pela UI.
        # ON CONFLICT garante idempotência ao re-rodar a migration.
        cur.execute("SELECT id FROM tenants WHERE active = TRUE;")
        tenant_ids = [r["id"] for r in cur.fetchall()]
        for tid in tenant_ids:
            for name, ctype, values in DEFAULT_CHARACTERISTICS:
                cur.execute(
                    """
                    INSERT INTO product_characteristics (name, type, tenant_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (tenant_id, name) DO NOTHING
                    RETURNING id;
                    """,
                    (name, ctype, tid),
                )
                row = cur.fetchone()
                if row is None:
                    cur.execute(
                        "SELECT id FROM product_characteristics WHERE tenant_id = %s AND name = %s;",
                        (tid, name),
                    )
                    row = cur.fetchone()
                cid = row["id"]
                for v, hex_color, num, unit in values:
                    cur.execute(
                        """
                        INSERT INTO product_characteristic_values
                               (value, hex_color, numeric_value, unit, characteristic_id, tenant_id)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (characteristic_id, value) DO NOTHING;
                        """,
                        (v, hex_color, num, unit, cid, tid),
                    )
        logger.info(f"  Características padrão seedadas para {len(tenant_ids)} tenant(s).")

    logger.info("0006_cadastros_products applied.")


def rollback(conn) -> None:
    logger.info("Rolling back 0006_cadastros_products...")
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS product_tag_links              CASCADE;")
        cur.execute("DROP TABLE IF EXISTS product_characteristic_links   CASCADE;")
        cur.execute("DROP TABLE IF EXISTS product_images                 CASCADE;")
        cur.execute("DROP TABLE IF EXISTS product_kit_items              CASCADE;")
        cur.execute("DROP TABLE IF EXISTS products                       CASCADE;")
        cur.execute("DROP TABLE IF EXISTS product_characteristic_values  CASCADE;")
        cur.execute("DROP TABLE IF EXISTS product_characteristics        CASCADE;")
        cur.execute("DROP TABLE IF EXISTS product_families               CASCADE;")
    logger.info("0006_cadastros_products rolled back.")
