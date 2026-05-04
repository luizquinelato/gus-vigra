<!-- blueprint: db_changes=true seed_data=true -->
# Módulo 05 — Cadastros (Master Data)

Centraliza todos os dados mestres do sistema: produtos, famílias, características, kits, imagens, categorias, tags, tabelas de preço, promoções e campanhas. É a fonte da verdade que alimenta Estoque, Vendas, E-Commerce e Marketplaces.

> **Modelo adotado: produto flat.** Cada linha de `products` é um item vendável (um SKU) — não há tabela `product_variations`. Quando um conjunto de produtos é "irmão" (mesma camiseta em cores e tamanhos diferentes), o agrupamento é declarativo via `family_id` apontando para `product_families`. Características (Cor, Tamanho, Voltagem…) são entidades reutilizáveis ligadas a produto via uma M:N tipada — não JSONB livre na variação.

---

## 1. Produtos

- Identificador humano por tenant: `code` (substitui o conceito de SKU). Pode ser livre ou regulado por *Code Template* (seção 10).
- `slug` único por tenant — gerado automaticamente do nome (com normalização de acentos).
- `type` ∈ (`simple`, `kit`). Não há tipo `variable` — variabilidade é capturada pela família + características.
- `family_id` opcional: agrupa "irmãos" para UI / promoções / relatórios. Produto avulso fica sem família.
- `barcode` (EAN/GTIN) opcional, com índice próprio.
- `ncm` (código fiscal) — necessário para futura emissão de NF.
- Peso e dimensões (`weight_kg`, `height_cm`, `width_cm`, `depth_cm`) — usados pelo módulo Logística.
- SEO: `meta_title` e `meta_description`. Quando ausentes, a UI usa `name` e `short_description` como default visual.
- Preço único na entidade (`price`); o preço efetivo final passa por `price_tables` e `promotions` em runtime (seções 7 e 8).

```sql
CREATE TABLE products (
    id                SERIAL        PRIMARY KEY,
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
    family_id         INTEGER       REFERENCES product_families(id)   ON DELETE SET NULL,
    category_id       INTEGER       REFERENCES product_categories(id) ON DELETE SET NULL,
    tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active            BOOLEAN       DEFAULT TRUE,
    created_at        TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at   TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(tenant_id, code),
    UNIQUE(tenant_id, slug),
    CONSTRAINT products_type_check CHECK (type IN ('simple','kit'))
);
```

---

## 2. Famílias de Produtos

Família é um catálogo (`product_families`) que agrupa produtos "irmãos" e centraliza dois conjuntos de informação:

- **`defaults` (JSONB)** — valores padrão herdáveis em campos genéricos. Apenas chaves do *allow-list* são aceitas. O endpoint `POST /product-families/{id}/apply-defaults` propaga (overwrite) esses valores para todos os produtos da família.
- **`characteristic_ids` (INTEGER[])** — quais características a família varia (ex.: `[Cor, Tamanho]`). Cada produto da família escolhe seu próprio valor para cada característica listada via `product_characteristic_links`.

Allow-list de campos gerenciáveis em nível de família (exposto em `GET /product-families/managed-fields-options`):

| Chave | Tipo lógico (UI) |
|---|---|
| `brand` | string |
| `category_id` | category |
| `unit` | string |
| `price` | currency |
| `cost` | currency |
| `description` | html |
| `short_description` | text |
| `ncm` | string |
| `weight_kg`, `height_cm`, `width_cm`, `depth_cm` | decimal |
| `meta_title`, `meta_description` | text |
| `type` | string |

```sql
CREATE TABLE product_families (
    id                 SERIAL       PRIMARY KEY,
    name               VARCHAR(80)  NOT NULL,
    defaults           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    characteristic_ids INTEGER[]    NOT NULL DEFAULT '{}'::int[],
    tenant_id          INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active             BOOLEAN      DEFAULT TRUE,
    created_at         TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at    TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);
```

---

## 3. Características e Valores

Substituem o conceito de "atributos" — passam a ser entidades tipadas e reutilizáveis.

- `product_characteristics`: dimensão (Cor, Tamanho, Voltagem). `type` ∈ (`text`, `color`, `number`). **`type` é imutável após criação** — para mudar é necessário deletar e recriar.
- `product_characteristic_values`: valores possíveis. Por tipo:
  - `text` → apenas `value` (ex.: P, M, G, GG)
  - `color` → `value` + `hex_color` (`#RRGGBB`, validado por CHECK regex)
  - `number` → `value` + `numeric_value` + `unit` opcional (ex.: 110V, 220V)
- `product_characteristic_links`: M:N entre produto e valor. **`UNIQUE(product_id, characteristic_id)`** — apenas um valor por característica por produto. Para "Cor primária" e "Cor secundária" são modeladas como duas características distintas.

### Seed automático por tenant

Toda nova `tenant` recebe um conjunto mínimo de características reutilizáveis (idempotente via `ON CONFLICT`):

| Característica | Tipo | Valores seedados |
|---|---|---|
| Cor | `color` | Preto, Branco, Cinza, Vermelho, Azul, Verde, Amarelo, Rosa, Marrom, Bege |
| Tamanho | `text` | PP, P, M, G, GG, XG |
| Voltagem | `text` | 110V, 220V, Bivolt |

Editáveis e deletáveis pela UI — o seed é apenas um ponto de partida.

```sql
CREATE TABLE product_characteristics (
    id              SERIAL       PRIMARY KEY,
    name            VARCHAR(50)  NOT NULL,
    type            VARCHAR(10)  NOT NULL DEFAULT 'text',
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(tenant_id, name),
    CONSTRAINT product_characteristics_type_check CHECK (type IN ('text','color','number'))
);

CREATE TABLE product_characteristic_values (
    id                SERIAL        PRIMARY KEY,
    value             VARCHAR(100)  NOT NULL,
    hex_color         VARCHAR(7),
    numeric_value     NUMERIC(14,4),
    unit              VARCHAR(20),
    characteristic_id INTEGER       NOT NULL REFERENCES product_characteristics(id) ON DELETE CASCADE,
    tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active            BOOLEAN       DEFAULT TRUE,
    created_at        TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at   TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(characteristic_id, value),
    CONSTRAINT product_characteristic_values_hex_format
        CHECK (hex_color IS NULL OR hex_color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE product_characteristic_links (
    id                SERIAL      PRIMARY KEY,
    product_id        INTEGER     NOT NULL REFERENCES products(id)                       ON DELETE CASCADE,
    characteristic_id INTEGER     NOT NULL REFERENCES product_characteristics(id)        ON DELETE CASCADE,
    value_id          INTEGER     NOT NULL REFERENCES product_characteristic_values(id)  ON DELETE CASCADE,
    tenant_id         INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active            BOOLEAN     DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(product_id, characteristic_id)
);
```

---

## 4. Kits (Composição)

Quando `products.type = 'kit'`, a composição vive em `product_kit_items`. A venda de 1 kit expande em N saídas de estoque dos componentes (responsabilidade do módulo Estoque ao consumir o evento).

- `quantity` aceita decimal (`NUMERIC(15,3)`) — permite kits com fracionários (ex.: `1.5 kg de açúcar`).
- `kit_id <> component_id` (CHECK) — proíbe auto-referência.
- Componente referenciado com `ON DELETE RESTRICT` — não dá para deletar um produto que ainda é componente de algum kit ativo.
- Custo do kit = `Σ(componente.cost × quantity)` — derivado em runtime; `products.cost` do kit não é editado manualmente.

```sql
CREATE TABLE product_kit_items (
    id              SERIAL        PRIMARY KEY,
    quantity        NUMERIC(15,3) NOT NULL DEFAULT 1,
    kit_id          INTEGER       NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    component_id    INTEGER       NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN       DEFAULT TRUE,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(kit_id, component_id),
    CONSTRAINT product_kit_items_no_self CHECK (kit_id <> component_id)
);
```

---

## 5. Imagens

`product_images` armazena as URLs (caminho público em `/static/products/{tenant_id}/{filename}`). O endpoint `POST /products/upload-image` faz o upload (multipart) e devolve a URL para então ser registrada via `POST /products/{id}/images`.

- **Imagem de produto**: `product_id` preenchido, `family_id` NULL.
- **Imagem de família**: `family_id` preenchido, `product_id` NULL — a imagem é exibida em todos os produtos daquela família (herança no `GET /products/{id}/images`).
- CHECK garante que ao menos uma das duas FKs esteja preenchida.
- `sort_order` define ordem de exibição (capa = menor).

```sql
CREATE TABLE product_images (
    id              SERIAL       PRIMARY KEY,
    url             VARCHAR(500) NOT NULL,
    alt_text        VARCHAR(200),
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    product_id      INTEGER      REFERENCES products(id)         ON DELETE CASCADE,
    family_id       INTEGER      REFERENCES product_families(id) ON DELETE CASCADE,
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
    CONSTRAINT product_images_scope_check CHECK (product_id IS NOT NULL OR family_id IS NOT NULL)
);
```

---

## 6. Categorias e Tags

- `product_categories`: árvore por tenant (auto-referencial via `parent_id`). Suporta `icon` (nome do Phosphor) para renderização. `slug` único por tenant.
- `product_tags`: marcadores livres (ex.: "Dia das Mães", "Lançamentos"). `slug` único por tenant. Reutilizáveis entre produtos via `product_tag_links` (M:N) — base para coleções dinâmicas na loja virtual.

```sql
CREATE TABLE product_categories (
    id              SERIAL       PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(120) NOT NULL,
    icon            VARCHAR(50),
    parent_id       INTEGER      REFERENCES product_categories(id) ON DELETE SET NULL,
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

CREATE TABLE product_tags (
    id              SERIAL       PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(120) NOT NULL,
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

CREATE TABLE product_tag_links (
    id              SERIAL      PRIMARY KEY,
    product_id      INTEGER     NOT NULL REFERENCES products(id)     ON DELETE CASCADE,
    tag_id          INTEGER     NOT NULL REFERENCES product_tags(id) ON DELETE CASCADE,
    tenant_id       INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN     DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(product_id, tag_id)
);
```

---

## 7. Tabelas de Preço

- `price_tables.type` ∈ (`fixed`, `percentage_off`).
  - `fixed` → preço por item em `price_table_items.price`.
  - `percentage_off` → desconto único de `discount_pct` aplicado sobre `products.price`.
- `is_default` marca a tabela padrão do tenant. **Garantia de unicidade no banco** via partial unique index (`WHERE is_default = TRUE AND active = TRUE`).
- Itens da tabela apontam para `product_id` (modelo flat — não há `product_variation_id`).

### Prioridade de resolução de preço (runtime)

```
1. promoção ativa elegível        (módulo Vendas resolve via list_active_promotions)
2. tabela de preço do cliente     (passada pelo chamador)
3. tabela padrão do tenant        (is_default = TRUE)
4. products.price                 (fallback)
```

A função `CadastrosService.get_product_price(db, product_id, tenant_id, price_table_id=None)` cobre os passos 2–4. Promoções (passo 1) são responsabilidade do módulo consumidor.

```sql
CREATE TABLE price_tables (
    id              SERIAL        PRIMARY KEY,
    name            VARCHAR(100)  NOT NULL,
    type            VARCHAR(20)   DEFAULT 'fixed',
    discount_pct    NUMERIC(5,2)  DEFAULT 0,
    is_default      BOOLEAN       DEFAULT FALSE,
    tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN       DEFAULT TRUE,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
    CONSTRAINT price_tables_type_check CHECK (type IN ('fixed','percentage_off'))
);
CREATE UNIQUE INDEX uq_price_tables_default_per_tenant
    ON price_tables (tenant_id) WHERE is_default = TRUE AND active = TRUE;

CREATE TABLE price_table_items (
    id              SERIAL        PRIMARY KEY,
    price           NUMERIC(15,2) NOT NULL,
    price_table_id  INTEGER       NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
    product_id      INTEGER       NOT NULL REFERENCES products(id)     ON DELETE CASCADE,
    tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN       DEFAULT TRUE,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(price_table_id, product_id)
);
```

---

## 8. Promoções

- `type` ∈ (`pct_off`, `fixed_off`, `buy_x_get_y`, `free_shipping`).
- `applies_to` ∈ (`all`, `product`, `category`) + `target_ids INTEGER[]`.
- `coupon_code` opcional (NULL = promoção automática). UNIQUE por tenant.
- Condições: `min_order_amount`, `min_quantity`.
- Limites: `max_uses` (total), `max_uses_per_client`, `uses_count` (contador).
- Janela: `starts_at` / `ends_at`. Índice parcial `idx_promotions_window` cobre apenas promoções ativas.
- `stackable` controla acúmulo com outras promoções no checkout.

```sql
CREATE TABLE promotions (
    id                   SERIAL        PRIMARY KEY,
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
    tenant_id            INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active               BOOLEAN       DEFAULT TRUE,
    created_at           TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at      TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(tenant_id, coupon_code),
    CONSTRAINT promotions_type_check       CHECK (type       IN ('pct_off','fixed_off','buy_x_get_y','free_shipping')),
    CONSTRAINT promotions_applies_to_check CHECK (applies_to IN ('all','product','category'))
);
```

---

## 9. Campanhas de Marketing

Diferente de promoção (desconto de preço), campanha é uma ação de **comunicação** com objetivo de vendas.

- `type` ∈ (`launch`, `sale`, `reactivation`, `seasonal`).
- `channel` ∈ (`whatsapp`, `email`, `marketplace`, `store`).
- `status` ∈ (`draft`, `scheduled`, `running`, `done`, `cancelled`).
- `promotion_id` opcional — campanha pode ativar uma promoção automaticamente.
- `segment_id` é INTEGER **sem FK** nesta migration; a constraint para `client_segments` é adicionada em migration futura quando o módulo CRM (04) criar a tabela.
- Métricas (`reach_count`, `conversion_count`, `revenue_generated`) são atualizadas em runtime pela camada de execução do canal.
- `created_by_agent = TRUE` quando gerada pelo módulo IA.

```sql
CREATE TABLE campaigns (
    id                  SERIAL        PRIMARY KEY,
    name                VARCHAR(200)  NOT NULL,
    type                VARCHAR(30)   NOT NULL,
    channel             VARCHAR(30)   NOT NULL,
    status              VARCHAR(20)   DEFAULT 'draft',
    scheduled_at        TIMESTAMPTZ,
    executed_at         TIMESTAMPTZ,
    reach_count         INTEGER       DEFAULT 0,
    conversion_count    INTEGER       DEFAULT 0,
    revenue_generated   NUMERIC(15,2) DEFAULT 0,
    created_by_agent    BOOLEAN       DEFAULT FALSE,
    promotion_id        INTEGER       REFERENCES promotions(id) ON DELETE SET NULL,
    segment_id          INTEGER,
    tenant_id           INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active              BOOLEAN       DEFAULT TRUE,
    created_at          TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at     TIMESTAMPTZ   DEFAULT NOW(),
    CONSTRAINT campaigns_type_check    CHECK (type    IN ('launch','sale','reactivation','seasonal')),
    CONSTRAINT campaigns_channel_check CHECK (channel IN ('whatsapp','email','marketplace','store')),
    CONSTRAINT campaigns_status_check  CHECK (status  IN ('draft','scheduled','running','done','cancelled'))
);
```

---

## 10. Code Templates (máscara de código de produto)

DSL mínima implementada em `app/modules/cadastros/code_template.py`. Configuração persistida em `system_settings` (chaves abaixo). O endpoint `GET /code-templates` devolve a configuração atual; alteração via `PATCH /settings/{key}` (admin).

| Chave em `system_settings` | Conteúdo |
|---|---|
| `product_code_template` | Máscara (ex.: `AAA-9999`). Vazio = sem enforcement. |
| `product_code_family_separator` | 1 caractere literal (ex.: `_`) usado entre prefixo e variação quando `family_id IS NOT NULL`. |
| `product_code_allow_legacy` | `true` (default) → divergências passam (warning na UI). `false` → 400. |

### Tokens da DSL

| Token | Significado |
|---|---|
| `A` | Letra A-Z (auto-MAIÚSCULA) |
| `a` | Letra a-z (auto-minúscula) |
| `9` | Dígito 0-9 |
| `*` | Letra ou dígito |
| outros | Literais (separadores) |

### Comportamento (`_enforce_code_template` em `router.py`)

- Produto **sem família** → `code` deve casar com `template` exatamente.
- Produto **com família** → `code = <prefixo casando com template><sep><sufixo livre>`. Apenas o prefixo é validado/formatado.
- Aplicado em `POST /products`, `PATCH /products/{id}` e em `POST /products/bulk`.

---

## 11. Eventos emitidos

Cadastros é módulo-fonte: **emite, não consome**. Constantes públicas em `app/modules/cadastros/events.py`.

| Constante | Tópico | Disparado em |
|---|---|---|
| `EVT_PRODUCT_CREATED` | `product.created` | `POST /products` |
| `EVT_PRODUCT_UPDATED` | `product.updated` | `PATCH /products/{id}` |
| `EVT_PRODUCT_DELETED` | `product.deleted` | `DELETE /products/{id}` (soft) |
| `EVT_PRODUCT_BULK_CREATED` | `product.bulk_created` | `POST /products/bulk` |
| `EVT_PROMOTION_CREATED` | `promotion.created` | `POST /promotions` |
| `EVT_PROMOTION_ACTIVATED` | `promotion.activated` | `PATCH /promotions/{id}` (active=true) |
| `EVT_PROMOTION_DEACTIVATED` | `promotion.deactivated` | `PATCH /promotions/{id}` (active=false) |
| `EVT_CAMPAIGN_CREATED` | `campaign.created` | `POST /campaigns` |
| `EVT_CAMPAIGN_SCHEDULED` | `campaign.scheduled` | `PATCH /campaigns/{id}` (status=scheduled) |

Outros módulos consomem via `EventBus.subscribe(...)` em seu próprio `events.py`. Emissão é best-effort, in-process, sem retry.

---

## 12. Service público (cross-module)

Único ponto de entrada permitido para outros módulos lerem dados de Cadastros: `app/modules/cadastros/service.py::CadastrosService` (read-only, exige `tenant_id`).

| Método | Retorno | Uso típico |
|---|---|---|
| `get_product_summary(db, product_id, tenant_id)` | `dict \| None` (id, code, name, family_id, slug, type, unit, price, brand, active) | Estoque/Vendas resolvendo nome/preço sem carregar a entidade |
| `is_active_product(db, product_id, tenant_id)` | `bool` | Validação de FK lógica em outros módulos |
| `get_product_price(db, product_id, tenant_id, price_table_id=None)` | `dict \| None` (`product_id`, `base_price`, `effective_price`, `source`) | Vendas/E-Commerce resolvendo preço de tabela (sem promoção) |
| `list_active_promotions(db, tenant_id, when=None)` | `list[dict]` | Vendas resolvendo descontos no carrinho |
| `get_promotion_by_coupon(db, coupon_code, tenant_id)` | `dict \| None` | Aplicação de cupom no checkout |

> Mutação (criar/editar/deletar) é **sempre** via HTTP no router, atrás de `require_authentication`. Não há método de escrita exposto cross-module.

---

## 13. Regras de Negócio

- `code` único por tenant; quando há template configurado, é validado/formatado em `POST` e `PATCH`.
- `slug` único por tenant; gerado automaticamente do nome (normalização de acentos).
- `type ∈ ('simple','kit')` — sem `variable`. Variabilidade vive em `product_families` + características.
- Característica `type` (`text`/`color`/`number`) é **imutável** após criação; alteração exige deletar e recriar.
- `UNIQUE(product_id, characteristic_id)` em `product_characteristic_links` — um valor por característica por produto.
- Imagem deve ter **ou** `product_id` **ou** `family_id` (CHECK). Imagens de família são herdadas por todos os filhos.
- `product_kit_items.kit_id <> component_id` (CHECK) e `component_id` com `ON DELETE RESTRICT`.
- Custo de kit (`type='kit'`) é derivado em runtime; `products.cost` do kit não é editado manualmente.
- Apenas **uma** `price_tables` por tenant pode ter `is_default = TRUE AND active = TRUE` (partial unique index).
- `coupon_code` é único por tenant em `promotions`; promoções sem cupom são automáticas (aplicadas pela elegibilidade).
- Promoções inativas/expiradas são filtradas por `list_active_promotions` em runtime — não há job de desativação.
- Soft delete: `active = FALSE` preserva histórico em `order_items`, `stock_movements`, `price_table_items` etc.
- `defaults` de família só aceita chaves do allow-list `FAMILY_MANAGED_FIELD_OPTIONS` (validado no `POST/PATCH /product-families`).
- `apply-defaults` faz **overwrite** em todos os produtos da família para os campos presentes em `defaults` — operação destrutiva, exposta apenas no admin.
