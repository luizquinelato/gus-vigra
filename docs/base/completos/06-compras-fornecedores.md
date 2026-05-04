<!-- blueprint: db_changes=true seed_data=false -->
# Módulo 06 — Compras & Fornecedores

Cadastro de fornecedores, cotações (RFQ), pedidos de compra (PO), recebimento de mercadoria, avaliação de fornecedor e importação de NF-e. Gera entradas no Estoque (via evento `purchase.received`) e contas a pagar no Financeiro (via evento `purchase.payable_due`).

> **Modelo flat alinhado a Cadastros.** Itens de compra apontam para `product_id` — não há `product_variation_id`.
>
> **Compras é módulo-fonte.** Não consome eventos de outros módulos. Toda mutação que precisa repercurtir em Estoque/Financeiro é emitida via `EventBus.emit_reliable()` (Outbox transacional), com latência típica ≤ 2s.

---

## 1. Fornecedores (`suppliers`)

- Pessoa Jurídica (CNPJ) ou Física (CPF — MEI prestador de serviço).
- `document` único por tenant (CHECK de formato — 11 ou 14 dígitos numéricos).
- Condições comerciais padrão: `payment_terms_days`, `discount_pct`, `default_warehouse_id` (depósito que recebe por padrão).
- Histórico calculado em runtime via `purchase_orders` (não armazenado).
- Múltiplos contatos por fornecedor em `supplier_contacts`.

```sql
CREATE TABLE suppliers (
    id                       SERIAL        PRIMARY KEY,
    type                     VARCHAR(2)    NOT NULL DEFAULT 'pj',
    name                     VARCHAR(200)  NOT NULL,
    trade_name               VARCHAR(200),
    document                 VARCHAR(18)   NOT NULL,
    email                    VARCHAR(200),
    phone                    VARCHAR(20),
    payment_terms_days       INTEGER       DEFAULT 30,
    discount_pct             NUMERIC(5,2)  DEFAULT 0,
    notes                    TEXT,
    default_warehouse_id     INTEGER       REFERENCES warehouses(id) ON DELETE SET NULL,
    tenant_id                INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active                   BOOLEAN       DEFAULT TRUE,
    created_at               TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at          TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(tenant_id, document),
    CONSTRAINT suppliers_type_check CHECK (type IN ('pf','pj'))
);

CREATE TABLE supplier_contacts (
    id              SERIAL       PRIMARY KEY,
    name            VARCHAR(100),
    role            VARCHAR(100),
    email           VARCHAR(200),
    phone           VARCHAR(20),
    is_primary      BOOLEAN      DEFAULT FALSE,
    supplier_id     INTEGER      NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_supplier_contacts_primary
    ON supplier_contacts (supplier_id) WHERE is_primary = TRUE AND active = TRUE;
```

---

## 2. Cotações — RFQ (`purchase_quotations`)

- Operador cria cotação com N itens (`product_id` + `requested_quantity`).
- Envia para M fornecedores (canal: e-mail ou WhatsApp — fora de escopo desta tabela; integração futura).
- Cada fornecedor responde com `unit_price`, `delivery_days`, `payment_terms`, `notes`.
- Aprovação de uma resposta gera 1 PO automaticamente (`POST /purchase-quotations/{id}/approve { response_id }`).
- `status ∈ ('open','responded','approved','cancelled')`.

```sql
CREATE TABLE purchase_quotations (
    id              SERIAL       PRIMARY KEY,
    status          VARCHAR(20)  NOT NULL DEFAULT 'open',
    notes           TEXT,
    expires_at      TIMESTAMPTZ,
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by      INTEGER      REFERENCES users(id),
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
    CONSTRAINT purchase_quotations_status_check
        CHECK (status IN ('open','responded','approved','cancelled'))
);

CREATE TABLE purchase_quotation_items (
    id                 SERIAL        PRIMARY KEY,
    requested_quantity NUMERIC(15,3) NOT NULL,
    notes              TEXT,
    quotation_id       INTEGER       NOT NULL REFERENCES purchase_quotations(id) ON DELETE CASCADE,
    product_id         INTEGER       NOT NULL REFERENCES products(id)            ON DELETE RESTRICT,
    tenant_id          INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active             BOOLEAN       DEFAULT TRUE,
    created_at         TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at    TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(quotation_id, product_id),
    CONSTRAINT purchase_quotation_items_qty_positive CHECK (requested_quantity > 0)
);

CREATE TABLE purchase_quotation_responses (
    id              SERIAL        PRIMARY KEY,
    unit_price      NUMERIC(15,4),
    delivery_days   INTEGER,
    payment_terms   TEXT,
    notes           TEXT,
    responded_at    TIMESTAMPTZ   DEFAULT NOW(),
    quotation_id    INTEGER       NOT NULL REFERENCES purchase_quotations(id) ON DELETE CASCADE,
    supplier_id     INTEGER       NOT NULL REFERENCES suppliers(id)           ON DELETE RESTRICT,
    tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN       DEFAULT TRUE,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(quotation_id, supplier_id)
);
```

---

## 3. Pedido de Compra — PO (`purchase_orders`)

### Ciclo de vida (status enum)

```
draft → pending_approval → approved → sent → partially_received → received
                                                              └→ cancelled
```

- `po_number` único por tenant — formato `PO-YYYY-NNNNNN`, gerado pelo backend ao sair de `draft`.
- Aprovação por valor configurável em `system_settings.purchase_approval_threshold` (default `0` = toda PO requer aprovação). Acima do limite só `admin` pode aprovar.
- `subtotal`, `discount_amount`, `shipping_amount` e `total_amount` recalculados sempre que itens mudam (camada de service).
- `warehouse_id` na PO é o **default** dos itens; cada `purchase_order_item` pode sobrescrever (compra rateada entre depósitos).
- Edição só permitida em `draft` e `pending_approval`. Em `sent` em diante, qualquer mudança exige cancelar e recriar.

```sql
CREATE TABLE purchase_orders (
    id                     SERIAL        PRIMARY KEY,
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
    supplier_id            INTEGER       NOT NULL REFERENCES suppliers(id)  ON DELETE RESTRICT,
    warehouse_id           INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    quotation_id           INTEGER       REFERENCES purchase_quotations(id) ON DELETE SET NULL,
    approved_by            INTEGER       REFERENCES users(id),
    approved_at            TIMESTAMPTZ,
    tenant_id              INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by             INTEGER       REFERENCES users(id),
    active                 BOOLEAN       DEFAULT TRUE,
    created_at             TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at        TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(tenant_id, po_number),
    CONSTRAINT purchase_orders_status_check
        CHECK (status IN ('draft','pending_approval','approved','sent',
                          'partially_received','received','cancelled'))
);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders (tenant_id, supplier_id);
CREATE INDEX idx_purchase_orders_status   ON purchase_orders (tenant_id, status) WHERE active = TRUE;

CREATE TABLE purchase_order_items (
    id                  SERIAL        PRIMARY KEY,
    quantity_ordered    NUMERIC(15,3) NOT NULL,
    quantity_received   NUMERIC(15,3) NOT NULL DEFAULT 0,
    unit_cost           NUMERIC(15,4) NOT NULL,
    discount_pct        NUMERIC(5,2)  DEFAULT 0,
    total_cost          NUMERIC(15,2) NOT NULL,
    notes               TEXT,
    purchase_order_id   INTEGER       NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id          INTEGER       NOT NULL REFERENCES products(id)        ON DELETE RESTRICT,
    warehouse_id        INTEGER       REFERENCES warehouses(id)               ON DELETE RESTRICT,
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
```

---

## 4. Recebimento (`purchase_order_receipts`)

Recibos são **rastreáveis e separados** — uma PO pode ter N recibos parciais. Cada recibo:

1. Insere `purchase_order_receipts` + `purchase_order_receipt_items`.
2. Atualiza `purchase_order_items.quantity_received` (soma).
3. Atualiza `purchase_orders.status` para `partially_received` ou `received` conforme o total.
4. Emite `purchase.received` via `emit_reliable` na mesma transação → Estoque processa entrada (ver § 7).
5. Emite `purchase.payable_due` via `emit_reliable` quando a PO chega em `received` → Financeiro cria conta a pagar com vencimento `received_at + supplier.payment_terms_days`.

Divergências (qtd menor que pedida, produto danificado) são registradas em `purchase_order_receipt_items.discrepancy_notes` — não bloqueiam o recibo, apenas alertam.

```sql
CREATE TABLE purchase_order_receipts (
    id                SERIAL        PRIMARY KEY,
    received_at       TIMESTAMPTZ   DEFAULT NOW(),
    invoice_number    VARCHAR(50),
    invoice_date      DATE,
    notes             TEXT,
    purchase_order_id INTEGER       NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    received_by       INTEGER       REFERENCES users(id),
    tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active            BOOLEAN       DEFAULT TRUE,
    created_at        TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at   TIMESTAMPTZ   DEFAULT NOW()
);
CREATE INDEX idx_purchase_order_receipts_po ON purchase_order_receipts (tenant_id, purchase_order_id);

CREATE TABLE purchase_order_receipt_items (
    id                       SERIAL        PRIMARY KEY,
    quantity_received        NUMERIC(15,3) NOT NULL,
    unit_cost                NUMERIC(15,4) NOT NULL,
    discrepancy_notes        TEXT,
    receipt_id               INTEGER       NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
    purchase_order_item_id   INTEGER       NOT NULL REFERENCES purchase_order_items(id)    ON DELETE RESTRICT,
    product_id               INTEGER       NOT NULL REFERENCES products(id)                ON DELETE RESTRICT,
    warehouse_id             INTEGER       NOT NULL REFERENCES warehouses(id)              ON DELETE RESTRICT,
    tenant_id                INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active                   BOOLEAN       DEFAULT TRUE,
    created_at               TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at          TIMESTAMPTZ   DEFAULT NOW(),
    CONSTRAINT receipt_items_qty_positive CHECK (quantity_received > 0)
);
```

---

## 5. Avaliação de Fornecedor (`supplier_ratings`)

- Operador avalia um fornecedor por PO recebida (1-5 estrelas em `delivery`, `quality`, `price`).
- Campo computado em runtime: `supplier.avg_rating = AVG((delivery + quality + price) / 3)`.
- Influencia ranking de fornecedores nas cotações (UI mostra estrelas).

```sql
CREATE TABLE supplier_ratings (
    id                SERIAL       PRIMARY KEY,
    delivery_rating   SMALLINT,
    quality_rating    SMALLINT,
    price_rating      SMALLINT,
    notes             TEXT,
    supplier_id       INTEGER      NOT NULL REFERENCES suppliers(id)       ON DELETE CASCADE,
    purchase_order_id INTEGER      REFERENCES purchase_orders(id)          ON DELETE SET NULL,
    tenant_id         INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rated_by          INTEGER      REFERENCES users(id),
    active            BOOLEAN      DEFAULT TRUE,
    created_at        TIMESTAMPTZ  DEFAULT NOW(),
    CONSTRAINT supplier_ratings_delivery_range CHECK (delivery_rating BETWEEN 1 AND 5),
    CONSTRAINT supplier_ratings_quality_range  CHECK (quality_rating  BETWEEN 1 AND 5),
    CONSTRAINT supplier_ratings_price_range    CHECK (price_rating    BETWEEN 1 AND 5),
    UNIQUE(supplier_id, purchase_order_id)
);
```

---

## 6. Importação de NF-e (`nfe_imports`)

Forma mais rápida de dar entrada em compras: upload do **XML da NF-e** do fornecedor. Elimina digitação manual e garante precisão fiscal.

### Fluxo
1. Upload do XML (padrão SEFAZ) → `POST /purchases/nfe-imports`.
2. Parser extrai cabeçalho (chave de 44 dígitos, número, série, emissão, CNPJ emitente, total) e itens (código, descrição, NCM, EAN, qtd, unitário).
3. **De-para automático** por `barcode` (`products.ean_code`) e fallback por `ncm`. Itens sem correspondência ficam `mapped_product_id IS NULL` e o status do import vira `pending_mapping`.
4. Operador faz de-para manual em `PATCH /purchases/nfe-imports/{id}/items/{item_id} { product_id }` ou cria produto novo via Cadastros.
5. Fornecedor é auto-criado se `supplier_cnpj` não existir (status `imported_only`, com `name = razão social do XML`).
6. `POST /purchases/nfe-imports/{id}/confirm` gera em **uma transação**: `purchase_order` (status `received`), `purchase_order_items`, `purchase_order_receipts` + `_items` (com `received_at = issue_date`), e emite `purchase.received` + `purchase.payable_due` via Outbox.

```sql
CREATE TABLE nfe_imports (
    id                  SERIAL        PRIMARY KEY,
    nfe_key             VARCHAR(44)   NOT NULL,
    nfe_number          VARCHAR(20),
    nfe_series          VARCHAR(5),
    issue_date          DATE,
    supplier_cnpj       VARCHAR(18)   NOT NULL,
    total_amount        NUMERIC(15,2),
    xml_content         TEXT          NOT NULL,
    status              VARCHAR(20)   NOT NULL DEFAULT 'pending',
    error_message       TEXT,
    supplier_id         INTEGER       REFERENCES suppliers(id)        ON DELETE SET NULL,
    purchase_order_id   INTEGER       REFERENCES purchase_orders(id)  ON DELETE SET NULL,
    tenant_id           INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by          INTEGER       REFERENCES users(id),
    active              BOOLEAN       DEFAULT TRUE,
    created_at          TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at     TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(tenant_id, nfe_key),
    CONSTRAINT nfe_imports_status_check
        CHECK (status IN ('pending','pending_mapping','mapped','imported','cancelled','error'))
);

CREATE TABLE nfe_import_items (
    id                       SERIAL        PRIMARY KEY,
    nfe_item_number          INTEGER       NOT NULL,
    nfe_product_code         VARCHAR(60),
    nfe_product_description  TEXT          NOT NULL,
    ncm                      VARCHAR(10),
    barcode                  VARCHAR(50),
    quantity                 NUMERIC(15,3) NOT NULL,
    unit                     VARCHAR(20),
    unit_price               NUMERIC(15,4) NOT NULL,
    total_price              NUMERIC(15,2) NOT NULL,
    nfe_import_id            INTEGER       NOT NULL REFERENCES nfe_imports(id) ON DELETE CASCADE,
    mapped_product_id        INTEGER       REFERENCES products(id) ON DELETE SET NULL,
    tenant_id                INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active                   BOOLEAN       DEFAULT TRUE,
    created_at               TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at          TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(nfe_import_id, nfe_item_number)
);
```

---

## 7. Settings (`system_settings`)

| Chave | Default | Efeito |
|---|---|---|
| `purchase_approval_threshold` | `"0"` | Valor (R$) acima do qual a PO requer aprovação por `admin`. `0` = toda PO requer aprovação. |
| `purchase_po_number_prefix` | `"PO"` | Prefixo do `po_number`. Formato final: `{prefix}-{YYYY}-{NNNNNN}`. |
| `purchase_auto_create_supplier_from_nfe` | `"true"` | Se `"true"`, NF-e de CNPJ desconhecido cria fornecedor stub automaticamente. |
| `purchase_default_payment_terms_days` | `"30"` | Usado quando fornecedor não tem `payment_terms_days` definido. |

---

## 8. Eventos emitidos

Todos via `EventBus.emit_reliable()` (Outbox transacional) — idempotência garantida pelo consumidor via `outbox_event_id`.

| Evento | Payload | Disparo | Consumidores |
|---|---|---|---|
| `purchase.received` | `{ receipt_id, purchase_order_id, supplier_id, items: [{ product_id, warehouse_id, quantity, unit_cost }], tenant_id }` | Após gravar `purchase_order_receipts` (parcial ou total) | Estoque (entrada + recálculo `avg_cost` + lote FIFO). |
| `purchase.return_sent` | `{ purchase_order_id, supplier_id, items: [{ product_id, warehouse_id, quantity }], tenant_id }` | Devolução a fornecedor (POST `/purchases/{id}/returns`) | Estoque (saída tipo `exit`). |
| `purchase.payable_due` | `{ purchase_order_id, supplier_id, total_amount, due_date, tenant_id }` | PO atinge status `received` | Financeiro (cria conta a pagar). |
| `purchase.order.approved` | `{ purchase_order_id, supplier_id, total_amount, approved_by, tenant_id }` | Status `pending_approval` → `approved` | IA (analytics), notificações. |
| `purchase.order.cancelled` | `{ purchase_order_id, supplier_id, reason, tenant_id }` | Status → `cancelled` | Financeiro (cancelar payable se existia), IA. |
| `purchase.nfe.imported` | `{ nfe_import_id, purchase_order_id, supplier_id, total_amount, tenant_id }` | NF-e confirmada com sucesso | IA (auditoria fiscal), dashboards. |

Compras **não consome eventos**.

---

## 9. Service público (`ComprasService`)

Read-only (regra 11.4 do `modular-monolith.md`). Mutação cross-module sempre via evento.

| Método | Retorno | Uso |
|---|---|---|
| `get_supplier(db, supplier_id, tenant_id)` | `dict \| None` | Financeiro/IA exibindo dados do credor. |
| `list_open_purchase_orders(db, tenant_id, supplier_id=None)` | `list[dict]` | Dashboard de compras abertas. |
| `get_last_purchase_cost(db, product_id, tenant_id)` | `dict \| None` (`unit_cost`, `supplier_id`, `received_at`) | Vendas/IA sugerindo preço de venda; Cadastros calculando margem. |
| `get_supplier_payment_terms(db, supplier_id, tenant_id)` | `int` | Financeiro calculando vencimento. |
| `list_pending_receipts(db, tenant_id, warehouse_id=None)` | `list[dict]` | Logística/Estoque preparando recebimento. |

---

## 10. Regras de Negócio

- `document` (CNPJ/CPF) único por tenant; CHECK de formato (11 ou 14 dígitos numéricos após strip).
- Apenas um `supplier_contacts.is_primary = TRUE` por fornecedor ativo (índice parcial único).
- PO sai de `draft` → `pending_approval` ao primeiro item adicionado; `po_number` é gerado neste momento.
- Aprovação obrigatória se `total_amount > purchase_approval_threshold`. Acima, exige role `admin`.
- Edição de itens só permitida em `draft` e `pending_approval`. `sent` em diante exige cancelar e recriar.
- Recibo nunca pode ultrapassar `quantity_ordered` (CHECK em `purchase_order_items`).
- Status da PO transiciona para `received` automaticamente quando `SUM(quantity_received) = SUM(quantity_ordered)` para todos os itens; `partially_received` se algum item tiver recebido > 0 e total < pedido.
- Conta a pagar (Financeiro) tem vencimento = `received_at + supplier.payment_terms_days` (ou `purchase_default_payment_terms_days` se ausente).
- Cancelamento de PO em `received` é proibido (já gerou estoque + financeiro). Use devolução.
- Devolução a fornecedor (`POST /purchases/{id}/returns`) cria registro próprio + emite `purchase.return_sent` (Estoque processa saída) + `purchase.payable_due` negativo (Financeiro abate).
- Avaliação (`supplier_ratings`) é opcional, 1 por PO (UNIQUE), influencia ranking.
- NF-e duplicada (mesma `nfe_key` no tenant) → HTTP 409.
- XML é armazenado integralmente em `nfe_imports.xml_content` para auditoria fiscal (retenção mínima 5 anos).
- Soft delete em tudo exceto `purchase_order_receipts*` (append-only, igual a `stock_movements`).
