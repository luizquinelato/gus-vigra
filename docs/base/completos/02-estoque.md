<!-- blueprint: db_changes=true seed_data=false -->
# Módulo 02 — Estoque

Controle do ciclo de vida físico dos produtos: depósitos, saldos, movimentos (entradas, saídas, ajustes, transferências), reservas, lotes (FIFO opcional) e inventário físico. Consome eventos de Cadastros, Compras e Vendas; emite eventos próprios para Vendas, Financeiro e IA.

> **Modelo flat alinhado a Cadastros.** Saldo é por `(product_id, warehouse_id)` — não há `product_variation_id`. Cada `products.id` é um SKU vendável.
>
> **Cross-module write via Outbox.** Toda mutação de estoque originada em outro módulo (entrada por compra, saída por venda, reserva por pedido) chega via `EventBus.emit_reliable()` e é processada por subscribers idempotentes (`stock_movements.outbox_event_id UNIQUE`). Há latência típica de até 2s entre o fato (recibo de compra, confirmação de pedido) e a atualização do saldo. Veja seção 10.

---

## 1. Depósitos (`warehouses`)

- Cada tenant pode ter N depósitos (Depósito Principal, Loja Física, Showroom).
- Apenas **um** pode ser `is_default = TRUE` por tenant (partial unique index).
- O default é populado em `system_settings.stock_default_warehouse_id` para uso por subscribers (Compras, Vendas) sem precisar de query extra.

```sql
CREATE TABLE warehouses (
    id              SERIAL       PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    address         TEXT,
    is_default      BOOLEAN      DEFAULT FALSE,
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);
CREATE UNIQUE INDEX uq_warehouses_default_per_tenant
    ON warehouses (tenant_id) WHERE is_default = TRUE AND active = TRUE;
```

---

## 2. Saldos (`stock_balances`)

- Linha agregada por `(product_id, warehouse_id)`.
- **Criação lazy**: a row só nasce no primeiro `stock_movement` envolvendo aquele par. `GET /stock/balances` faz `LEFT JOIN products` — produto sem balance aparece com `quantity = 0`. Isso evita produzir 5.000 × 3 rows zerados em tenants grandes.
- `reserved_quantity` é **denormalizado** (soma das reservas ativas em `stock_reservations`) — leitura rápida do "disponível real = `quantity - reserved_quantity`". A consistência é mantida pelo service ao criar/cancelar reservas (sem trigger; explícito e testável).
- `avg_cost` é o custo médio ponderado pós-última entrada. Só é alterado em entradas; saídas/reservas não mexem em custo.
- `min_quantity` e `safety_quantity` são alvos configuráveis por (produto × depósito) — base para o alerta `stock.low`.

```sql
CREATE TABLE stock_balances (
    id                SERIAL        PRIMARY KEY,
    quantity          NUMERIC(15,3) NOT NULL DEFAULT 0,
    reserved_quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
    min_quantity      NUMERIC(15,3) DEFAULT 0,
    safety_quantity   NUMERIC(15,3) DEFAULT 0,
    avg_cost          NUMERIC(15,4) DEFAULT 0,
    product_id        INTEGER       NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
    warehouse_id      INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active            BOOLEAN       DEFAULT TRUE,
    created_at        TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at   TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(product_id, warehouse_id),
    CONSTRAINT stock_balances_qty_nonneg CHECK (quantity >= 0 OR quantity IS NULL),
    CONSTRAINT stock_balances_reserved_nonneg CHECK (reserved_quantity >= 0)
);
```

> A constraint `quantity >= 0` é **default**. Tenants que setam `system_settings.stock_allow_negative = "true"` têm a constraint relaxada na camada de service (a constraint do schema continua, mas o service permite saldo negativo só se vier do mesmo pipeline — impossível por construção, então a constraint é segura como está).

---

## 3. Movimentos (`stock_movements`)

- **Append-only** — nunca é editado nem deletado. Toda divergência vira novo movimento (estorno).
- `type ∈ ('entry', 'exit', 'adjustment', 'transfer_out', 'transfer_in')`.
- `outbox_event_id BIGINT UNIQUE NULL` — chave de idempotência dos subscribers (regra 11.3 do `modular-monolith.md`). Movimentos manuais (ajuste pelo operador via UI) ficam com `outbox_event_id = NULL`.
- `reference_type` + `reference_id` apontam ao fato originador (`'purchase_receipt'`, `'order'`, `'inventory_count'`, `'transfer'`, `'manual'`).
- `unit_cost` preenchido apenas em `entry` (define o custo de aquisição da camada/lote). `avg_cost_after` registra o custo médio resultante para auditoria.

```sql
CREATE TABLE stock_movements (
    id                SERIAL        PRIMARY KEY,
    type              VARCHAR(20)   NOT NULL,
    quantity          NUMERIC(15,3) NOT NULL,
    unit_cost         NUMERIC(15,4),
    avg_cost_after    NUMERIC(15,4),
    reference_type    VARCHAR(30),
    reference_id      INTEGER,
    notes             TEXT,
    outbox_event_id   BIGINT,
    product_id        INTEGER       NOT NULL REFERENCES products(id)   ON DELETE RESTRICT,
    warehouse_id      INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    created_by        INTEGER       REFERENCES users(id),
    tenant_id         INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ   DEFAULT NOW(),
    CONSTRAINT stock_movements_type_check
        CHECK (type IN ('entry','exit','adjustment','transfer_out','transfer_in')),
    CONSTRAINT stock_movements_qty_positive CHECK (quantity > 0)
);
CREATE UNIQUE INDEX uq_stock_movements_outbox
    ON stock_movements (outbox_event_id) WHERE outbox_event_id IS NOT NULL;
CREATE INDEX idx_stock_movements_product_wh
    ON stock_movements (tenant_id, product_id, warehouse_id, created_at DESC);
CREATE INDEX idx_stock_movements_reference
    ON stock_movements (tenant_id, reference_type, reference_id);
```

> `quantity` é **sempre positiva** (CHECK). O sinal é dado por `type`: `entry`/`transfer_in` somam, `exit`/`transfer_out` subtraem, `adjustment` aplica delta cuja direção é registrada em `notes` ou inferida do contexto (UI envia `delta` + motivo; o service decide entry vs exit).

---

## 4. Lotes FIFO (`stock_lots`)

Opcional — só populado quando `system_settings.stock_costing_method = "fifo"`. Caso contrário, custeio é apenas médio (seção 8).

- Cada `entry` cria 1 lote com `initial_quantity = remaining_quantity` e o `unit_cost` da entrada.
- Cada `exit`/`transfer_out` consome lotes em ordem FIFO (`entry_date ASC, id ASC`), decrementando `remaining_quantity`. Lotes com `remaining_quantity = 0` ficam para histórico.
- `reference_origin` aponta ao movimento de entrada que originou o lote (auditoria).
- `expires_at` opcional — permite alertas de validade (módulo IA).

```sql
CREATE TABLE stock_lots (
    id                 SERIAL        PRIMARY KEY,
    entry_date         DATE          NOT NULL,
    initial_quantity   NUMERIC(15,3) NOT NULL,
    remaining_quantity NUMERIC(15,3) NOT NULL,
    unit_cost          NUMERIC(15,4) NOT NULL,
    expires_at         DATE,
    product_id         INTEGER       NOT NULL REFERENCES products(id)         ON DELETE RESTRICT,
    warehouse_id       INTEGER       NOT NULL REFERENCES warehouses(id)       ON DELETE RESTRICT,
    origin_movement_id INTEGER       NOT NULL REFERENCES stock_movements(id)  ON DELETE RESTRICT,
    tenant_id          INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active             BOOLEAN       DEFAULT TRUE,
    created_at         TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at    TIMESTAMPTZ   DEFAULT NOW(),
    CONSTRAINT stock_lots_remaining_nonneg CHECK (remaining_quantity >= 0),
    CONSTRAINT stock_lots_remaining_le_initial CHECK (remaining_quantity <= initial_quantity)
);
CREATE INDEX idx_stock_lots_fifo
    ON stock_lots (tenant_id, product_id, warehouse_id, entry_date, id)
    WHERE remaining_quantity > 0 AND active = TRUE;
```

---

## 5. Reservas (`stock_reservations`)

Rastreabilidade do `reserved_quantity` denormalizado em `stock_balances`. Toda reserva tem origem (pedido, cotação) e pode ser cancelada nominalmente.

- Criadas via subscriber de `order.confirmed` (Vendas).
- Liberadas (`released_at`) via subscriber de `order.cancelled` ou `order.expired`.
- **Consumidas** (`consumed_at`) via subscriber de `order.paid` — momento em que o saldo de fato sai (`stock_movements` tipo `exit`).
- `outbox_event_id UNIQUE` garante idempotência.

```sql
CREATE TABLE stock_reservations (
    id              SERIAL        PRIMARY KEY,
    quantity        NUMERIC(15,3) NOT NULL,
    reference_type  VARCHAR(30)   NOT NULL,     -- 'order' | 'quotation' | 'manual'
    reference_id    INTEGER       NOT NULL,
    reserved_at     TIMESTAMPTZ   DEFAULT NOW(),
    released_at     TIMESTAMPTZ,
    consumed_at     TIMESTAMPTZ,
    outbox_event_id BIGINT,
    product_id      INTEGER       NOT NULL REFERENCES products(id)   ON DELETE RESTRICT,
    warehouse_id    INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN       DEFAULT TRUE,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ   DEFAULT NOW(),
    CONSTRAINT stock_reservations_qty_positive CHECK (quantity > 0),
    CONSTRAINT stock_reservations_lifecycle
        CHECK (NOT (released_at IS NOT NULL AND consumed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_stock_reservations_outbox
    ON stock_reservations (outbox_event_id) WHERE outbox_event_id IS NOT NULL;
CREATE INDEX idx_stock_reservations_active
    ON stock_reservations (tenant_id, product_id, warehouse_id)
    WHERE released_at IS NULL AND consumed_at IS NULL AND active = TRUE;
```

`stock_balances.reserved_quantity` = `SUM(stock_reservations.quantity WHERE released_at IS NULL AND consumed_at IS NULL AND active = TRUE)`. O service mantém esse valor em sincronia em cada criação/liberação/consumo (UPDATE explícito, sem trigger).

---

## 6. Inventário Físico (`inventory_counts`)

- Operador abre uma contagem para um depósito → status `open`.
- Sistema **congela** os saldos atuais como `expected_quantity` (snapshot no momento da abertura).
- Operador informa `counted_quantity` por produto.
- Ao fechar (`status = 'closed'`), o sistema gera 1 `stock_movement` tipo `adjustment` por linha com `difference != 0`, com `reference_type = 'inventory_count'` e `reference_id = inventory_count_id`.

```sql
CREATE TABLE inventory_counts (
    id              SERIAL       PRIMARY KEY,
    status          VARCHAR(20)  NOT NULL DEFAULT 'open',
    started_at      TIMESTAMPTZ  DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    notes           TEXT,
    warehouse_id    INTEGER      NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    created_by      INTEGER      REFERENCES users(id),
    tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ  DEFAULT NOW(),
    CONSTRAINT inventory_counts_status_check
        CHECK (status IN ('open','in_progress','closed','cancelled'))
);

CREATE TABLE inventory_count_items (
    id                 SERIAL        PRIMARY KEY,
    expected_quantity  NUMERIC(15,3) NOT NULL,
    counted_quantity   NUMERIC(15,3),
    difference         NUMERIC(15,3) GENERATED ALWAYS AS
                       (COALESCE(counted_quantity, 0) - expected_quantity) STORED,
    notes              TEXT,
    inventory_count_id INTEGER       NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
    product_id         INTEGER       NOT NULL REFERENCES products(id)         ON DELETE RESTRICT,
    tenant_id          INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    active             BOOLEAN       DEFAULT TRUE,
    created_at         TIMESTAMPTZ   DEFAULT NOW(),
    last_updated_at    TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE(inventory_count_id, product_id)
);
```

---

## 7. Kits (referência cruzada a Cadastros)

Estoque **não tem tabela própria de kit** — `product_kit_items` vive em Cadastros.

- Saldo de produto `type = 'kit'` é **derivado em runtime**: `MIN(stock_balances.quantity_componente / product_kit_items.quantity)` para todos os componentes ativos. Não é persistido.
- Saída de kit: o subscriber de `order.paid` (módulo Estoque) chama `CadastrosService.get_kit_components(kit_product_id, tenant_id)` (read-only) e gera N `stock_movements` tipo `exit` — um por componente.
- Inventário físico **só lista produtos `type = 'simple'`** — kits são excluídos do snapshot.
- Custo de kit = `SUM(componente.avg_cost × product_kit_items.quantity)` — calculado em runtime, exposto pelo `GET /stock/kits/{id}/cost`.

---

## 8. Custeio

### 8.1. Médio Ponderado (default — `system_settings.stock_costing_method = "average"`)

Recalculado a cada **entrada** (não muda em saídas):

```
saldo_apos       = quantity_atual + quantity_entrada
custo_apos       = (quantity_atual × avg_cost_atual + quantity_entrada × unit_cost_entrada) / saldo_apos
```

- Se `unit_cost_entrada = 0` (entrada sem custo informado — ex.: bonificação), o `avg_cost` **não muda** (mantém o anterior). Não força custo zero em estoque ativo.
- Saídas usam `avg_cost` corrente como CMV (consumido pelo módulo Contabilidade no DRE).

### 8.2. FIFO (opcional — `stock_costing_method = "fifo"`)

- Cada entrada cria 1 lote (`stock_lots`) com seu `unit_cost`.
- Cada saída consome lotes em ordem `entry_date ASC, id ASC` decrementando `remaining_quantity`. Pode atravessar múltiplos lotes em uma saída.
- CMV da saída = `SUM(quantity_consumida_no_lote × lote.unit_cost)` para todos os lotes tocados.
- `stock_balances.avg_cost` continua sendo mantido em paralelo (média ponderada) — usado por relatórios que não querem detalhe lote-a-lote.

### 8.3. Mudança de método

A troca de `stock_costing_method` em runtime **não recomputa histórico**. Vale para movimentos futuros. Mudança é registrada em `system_settings.last_updated_at` para auditoria.

---

## 9. Settings (`system_settings`)

| Chave | Default | Efeito |
|---|---|---|
| `stock_costing_method` | `"average"` | `"average"` ou `"fifo"`. Habilita/desabilita uso de `stock_lots`. |
| `stock_allow_negative` | `"false"` | Se `"true"`, saída sem saldo passa (saldo fica negativo). Se `"false"`, gera HTTP 422. |
| `stock_default_warehouse_id` | NULL | ID do depósito default. Lido pelos subscribers quando o evento de origem (compra/venda) não especifica `warehouse_id`. |
| `stock_low_alert_enabled` | `"true"` | Liga/desliga emissão de `stock.low` quando `quantity ≤ min_quantity`. |

---

## 10. Eventos consumidos (subscribers)

Todos os subscribers usam `outbox_event_id` como chave de idempotência (regra 11.3).

| Evento | Origem | Modo | Ação no Estoque |
|---|---|---|---|
| `product.created` | Cadastros | `emit` | No-op com log (futuro: pré-criar saldo zero em `default_warehouse`). |
| `product.deleted` | Cadastros | `emit` | No-op com log (saldos órfãos viram histórico — `ON DELETE CASCADE` em balances). |
| `purchase.received` | Compras | `emit_reliable` | Cria `stock_movement` tipo `entry` + UPSERT em `stock_balances` (saldo + recalc `avg_cost`) + cria `stock_lot` se FIFO. |
| `purchase.return_sent` | Compras | `emit_reliable` | Cria `stock_movement` tipo `exit` (devolução a fornecedor). Consome lotes FIFO. |
| `order.confirmed` | Vendas | `emit_reliable` | Cria 1 `stock_reservation` por item + UPDATE `stock_balances.reserved_quantity`. |
| `order.cancelled` | Vendas | `emit_reliable` | Marca reservas como `released_at = NOW()` + UPDATE `reserved_quantity`. |
| `order.paid` | Vendas | `emit_reliable` | Marca reservas como `consumed_at = NOW()` + cria `stock_movement` tipo `exit` (kit expandido em N saídas via `CadastrosService.get_kit_components`). |
| `order.return_received` | Vendas | `emit_reliable` | Cria `stock_movement` tipo `entry` (devolução de cliente) com `unit_cost = avg_cost_atual`. |

> Subscribers ficam em `app/modules/estoque/events.py` e são registrados no `__init__.py` do módulo via `EventBus.subscribe(...)`.

---

## 11. Eventos emitidos

| Evento | Modo | Payload | Consumidores típicos |
|---|---|---|---|
| `stock.movement.created` | `emit` | `{ movement_id, product_id, warehouse_id, type, quantity, tenant_id }` | IA (analytics em tempo real), dashboards. |
| `stock.balance.updated` | `emit` | `{ product_id, warehouse_id, quantity, available, tenant_id }` | E-commerce (atualiza disponibilidade na vitrine), cache. |
| `stock.low` | `emit` | `{ product_id, warehouse_id, quantity, min_quantity, tenant_id }` | IA (sugere reposição), notificações push. |
| `stock.reservation.created` | `emit` | `{ reservation_id, order_id, product_id, quantity, tenant_id }` | Vendas (confirma que reserva foi feita), analytics. |
| `stock.reservation.released` | `emit` | `{ reservation_id, order_id, tenant_id }` | Vendas, analytics. |
| `stock.inventory.closed` | `emit` | `{ inventory_count_id, total_adjustments, tenant_id }` | Contabilidade (registra ajustes contábeis), IA. |

> Eventos de Estoque são `emit` (best-effort). A confiabilidade da mutação foi garantida pelo Outbox **na entrada** (subscriber processou um evento `emit_reliable`); o evento de saída é informativo. Para o caso raro em que outro módulo financeiro precise garantia, usar `emit_reliable` adicionalmente.

---

## 12. Service público (`EstoqueService`)

Read-only (regra 11.4). Mutação cross-module **sempre via evento**.

| Método | Retorno | Uso |
|---|---|---|
| `get_balance(db, product_id, warehouse_id, tenant_id)` | `dict \| None` (`quantity`, `reserved_quantity`, `available`, `avg_cost`) | Vendas/E-commerce conferindo saldo antes de aceitar pedido. |
| `get_available_aggregated(db, product_id, tenant_id)` | `dict` (`total_quantity`, `total_reserved`, `total_available`) | Vitrine somando todos os depósitos. |
| `list_balances_by_warehouse(db, warehouse_id, tenant_id, only_with_stock=False)` | `list[dict]` | Tela de inventário. |
| `list_movements(db, product_id, tenant_id, since=None, limit=100)` | `list[dict]` | Histórico/auditoria. |
| `get_kit_available(db, kit_product_id, tenant_id)` | `int` (saldo derivado) | Vitrine para produto `type='kit'`. Internamente chama `CadastrosService.get_kit_components`. |
| `is_in_stock(db, product_id, tenant_id, quantity=1)` | `bool` | Validação rápida. |

---

## 13. Regras de Negócio

- Saldo nunca negativo por padrão; `stock_allow_negative` controla.
- `quantity` em `stock_movements` é **sempre positiva**; o sinal vem do `type`.
- Toda mutação cross-module passa por `emit_reliable` + subscriber idempotente — entrada de estoque tem latência típica ≤ 2s após o fato originador.
- `stock_balances` é criado **lazy** (UPSERT no primeiro movimento). Produtos sem movimento não têm row.
- `reserved_quantity` é sempre `SUM(reservas ativas)` — invariante mantido pelo service.
- Transferência entre depósitos = 1 `stock_movement` tipo `transfer_out` no origem + 1 `transfer_in` no destino, ambos com mesmo `reference_id` (transferência) — atômica na mesma transação.
- Custo médio só muda em **entrada**. Entrada com custo zero não zera o `avg_cost` (mantém o anterior).
- FIFO: lote com `remaining_quantity = 0` permanece para histórico (não é deletado).
- Inventário físico congela `expected_quantity` na abertura; ajuste só é gerado no `close`.
- Kit (`products.type = 'kit'`) **não tem `stock_balances`**; saldo é derivado via `MIN(componente / kit_qty)`.
- Soft delete em todas as tabelas exceto `stock_movements` (append-only, auditoria histórica).
- Embalagens de envio (`packaging_boxes`) **não pertencem a este módulo** — vivem em Logística (`08-logistica.md`).
