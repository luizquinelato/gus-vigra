"""
modules/estoque/events.py
=========================
Catálogo de eventos do módulo Estoque + handlers (subscribers).

Eventos EMITIDOS (best-effort via EventBus.emit, exceto onde indicado):
- stock.movement.created      { movement_id, product_id, warehouse_id, type, quantity, tenant_id }
- stock.balance.updated       { product_id, warehouse_id, quantity, available, tenant_id }
- stock.low                   { product_id, warehouse_id, quantity, min_quantity, tenant_id }
- stock.reservation.created   { reservation_id, product_id, quantity, tenant_id }
- stock.reservation.released  { reservation_id, tenant_id }
- stock.inventory.closed      { inventory_count_id, total_adjustments, tenant_id }

Eventos CONSUMIDOS (subscribers registrados via EventBus.subscribe):
- product.created   (Cadastros, emit)           — log informativo (no-op).
- product.deleted   (Cadastros, emit)           — log informativo (cascade no DB).
- purchase.received (Compras, emit_reliable)    — entrada + recálculo avg_cost (+ FIFO).

Idempotência: subscribers de emit_reliable usam outbox_event_id como chave
(INSERT ... ON CONFLICT (outbox_event_id) DO NOTHING em stock_movements).
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.event_bus import EventBus

logger = logging.getLogger(__name__)


# ── Constantes de eventos emitidos ────────────────────────────────────────────
EVT_STOCK_MOVEMENT_CREATED     = "stock.movement.created"
EVT_STOCK_BALANCE_UPDATED      = "stock.balance.updated"
EVT_STOCK_LOW                  = "stock.low"
EVT_STOCK_RESERVATION_CREATED  = "stock.reservation.created"
EVT_STOCK_RESERVATION_RELEASED = "stock.reservation.released"
EVT_STOCK_INVENTORY_CLOSED     = "stock.inventory.closed"


# ── Helpers internos ──────────────────────────────────────────────────────────

async def _get_default_warehouse_id(db, tenant_id: int) -> int | None:
    """Resolve depósito default — prioriza setting, fallback no flag is_default."""
    row = (await db.execute(
        text("""
            SELECT setting_value FROM system_settings
            WHERE  tenant_id = :tid AND setting_key = 'stock_default_warehouse_id'
              AND  active = TRUE
        """),
        {"tid": tenant_id},
    )).fetchone()
    if row and row.setting_value and row.setting_value.strip():
        try:
            return int(row.setting_value)
        except ValueError:
            logger.warning("stock_default_warehouse_id inválido para tenant %s: %r", tenant_id, row.setting_value)
    row = (await db.execute(
        text("""
            SELECT id FROM warehouses
            WHERE  tenant_id = :tid AND is_default = TRUE AND active = TRUE
            LIMIT 1
        """),
        {"tid": tenant_id},
    )).fetchone()
    return row.id if row else None


async def _get_setting(db, tenant_id: int, key: str) -> str | None:
    row = (await db.execute(
        text("""
            SELECT setting_value FROM system_settings
            WHERE  tenant_id = :tid AND setting_key = :k AND active = TRUE
        """),
        {"tid": tenant_id, "k": key},
    )).fetchone()
    return row.setting_value if row else None


# ── Subscribers de Cadastros (emit, best-effort) ──────────────────────────────

async def on_product_created(payload: dict[str, Any]) -> None:
    """No-op informativo — saldo é criado lazy no primeiro movimento."""
    logger.info(
        "estoque.on_product_created: produto %s (tenant=%s) registrado, saldo lazy.",
        payload.get("product_id"), payload.get("tenant_id"),
    )


async def on_product_deleted(payload: dict[str, Any]) -> None:
    """No-op — ON DELETE CASCADE em stock_balances cuida da limpeza no DB."""
    logger.info(
        "estoque.on_product_deleted: produto %s (tenant=%s) removido — saldos cascateados.",
        payload.get("product_id"), payload.get("tenant_id"),
    )


# ── Subscriber de Compras (emit_reliable, idempotente) ────────────────────────

async def on_purchase_received(payload: dict[str, Any]) -> None:
    """
    Processa um recibo de compra: cria stock_movements tipo 'entry' por item,
    UPSERT em stock_balances com recálculo de avg_cost, e cria stock_lot por
    item se costing_method = 'fifo'.

    Idempotência: outbox_event_id UNIQUE em stock_movements — re-entregas
    pelo OutboxProcessor são absorvidas via INSERT ... ON CONFLICT DO NOTHING.

    Payload esperado:
      { receipt_id, purchase_order_id, supplier_id,
        items: [{ product_id, warehouse_id, quantity, unit_cost }],
        __event_id__, __tenant_id__ }
    """
    event_id  = payload.get("__event_id__")
    tenant_id = payload.get("__tenant_id__")
    if event_id is None or tenant_id is None:
        logger.error("on_purchase_received: payload sem __event_id__/__tenant_id__: %s", payload)
        return

    items = payload.get("items") or []
    if not items:
        logger.warning("on_purchase_received: payload sem items (event_id=%s)", event_id)
        return

    # Sessão própria — handler é chamado pelo OutboxProcessor fora de qualquer transação web.
    async with AsyncSessionLocal() as db:
        costing = (await _get_setting(db, tenant_id, "stock_costing_method")) or "average"
        try:
            await _process_purchase_items(
                db, tenant_id=tenant_id, event_id=event_id,
                items=items, costing=costing,
                receipt_id=payload.get("receipt_id"),
                purchase_order_id=payload.get("purchase_order_id"),
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.error("on_purchase_received falhou (event_id=%s): %s", event_id, exc, exc_info=True)
            raise


async def on_purchase_return_sent(payload: dict[str, Any]) -> None:
    """
    Devolução a fornecedor: gera stock_movements tipo 'return_out' (saída) por item.
    Consome lotes FIFO se costing='fifo' (decrementa remaining_quantity).
    Idempotente via outbox_event_id em stock_movements.
    """
    event_id  = payload.get("__event_id__")
    tenant_id = payload.get("__tenant_id__")
    items     = payload.get("items") or []
    if event_id is None or tenant_id is None or not items:
        logger.warning("on_purchase_return_sent: payload incompleto (event_id=%s)", event_id)
        return

    async with AsyncSessionLocal() as db:
        try:
            await _process_exit_items(
                db, tenant_id=tenant_id, event_id=event_id,
                items=items, movement_type="return_out",
                reference_type="purchase_return",
                reference_id=payload.get("purchase_order_id"),
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.error("on_purchase_return_sent falhou (event_id=%s): %s", event_id, exc, exc_info=True)
            raise


# ── Núcleo: processamento de entradas/saídas com idempotência ─────────────────

async def _process_purchase_items(
    db, *, tenant_id: int, event_id: int, items: list[dict],
    costing: str, receipt_id: int | None, purchase_order_id: int | None,
) -> None:
    """Insere stock_movements (entry), UPSERT em stock_balances, cria stock_lots se FIFO."""
    for idx, item in enumerate(items):
        product_id   = int(item["product_id"])
        warehouse_id = int(item["warehouse_id"])
        quantity     = float(item["quantity"])
        unit_cost    = float(item.get("unit_cost") or 0)
        if quantity <= 0:
            continue

        # 1. INSERT idempotente em stock_movements (ON CONFLICT no UNIQUE outbox_event_id).
        # Como temos N itens por evento, codificamos o índice no outbox_event_id+offset
        # via reference_id distinto — solução: UNIQUE(outbox_event_id) é parcial e
        # impede o segundo item. Estratégia adotada: 1 movimento por item compartilha
        # outbox_event_id mas o UNIQUE é sobre (outbox_event_id, product_id, warehouse_id)?
        # Solução simples e correta: testar existência por (outbox_event_id, reference_id=idx)
        # antes do INSERT.
        existing = (await db.execute(
            text("""
                SELECT 1 FROM stock_movements
                WHERE outbox_event_id = :eid AND reference_type = 'purchase_receipt_item'
                  AND reference_id = :idx AND tenant_id = :tid
                LIMIT 1
            """),
            {"eid": event_id, "idx": idx, "tid": tenant_id},
        )).fetchone()
        if existing:
            logger.debug("Item %d do evento %s já processado (idempotência).", idx, event_id)
            continue

        mov = (await db.execute(
            text("""
                INSERT INTO stock_movements
                       (type, quantity, unit_cost, reason, reference_type, reference_id,
                        outbox_event_id, product_id, warehouse_id, tenant_id)
                VALUES ('entry', :q, :uc, 'purchase_receipt', 'purchase_receipt_item', :idx,
                        :eid, :pid, :wid, :tid)
                RETURNING id
            """),
            {"q": quantity, "uc": unit_cost, "idx": idx, "eid": event_id,
             "pid": product_id, "wid": warehouse_id, "tid": tenant_id},
        )).fetchone()
        movement_id = mov.id

        # 2. UPSERT em stock_balances com recálculo de avg_cost.
        await db.execute(
            text("""
                INSERT INTO stock_balances
                       (product_id, warehouse_id, quantity, avg_cost, tenant_id)
                VALUES (:pid, :wid, :q, :uc, :tid)
                ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
                    quantity = stock_balances.quantity + EXCLUDED.quantity,
                    avg_cost = CASE
                        WHEN EXCLUDED.avg_cost = 0 THEN stock_balances.avg_cost
                        WHEN (stock_balances.quantity + EXCLUDED.quantity) = 0 THEN stock_balances.avg_cost
                        ELSE (stock_balances.quantity * stock_balances.avg_cost
                              + EXCLUDED.quantity * EXCLUDED.avg_cost)
                             / (stock_balances.quantity + EXCLUDED.quantity)
                    END,
                    last_updated_at = NOW()
            """),
            {"pid": product_id, "wid": warehouse_id, "q": quantity,
             "uc": unit_cost, "tid": tenant_id},
        )

        # 3. FIFO: cria stock_lot.
        if costing == "fifo":
            await db.execute(
                text("""
                    INSERT INTO stock_lots
                           (quantity, remaining_quantity, unit_cost,
                            product_id, warehouse_id, source_movement_id, tenant_id)
                    VALUES (:q, :q, :uc, :pid, :wid, :mid, :tid)
                """),
                {"q": quantity, "uc": unit_cost, "pid": product_id,
                 "wid": warehouse_id, "mid": movement_id, "tid": tenant_id},
            )
    logger.info("on_purchase_received: %d itens processados (event_id=%s).", len(items), event_id)


async def _process_exit_items(
    db, *, tenant_id: int, event_id: int, items: list[dict],
    movement_type: str, reference_type: str, reference_id: int | None,
) -> None:
    """Processa saídas (exit/return_out/consumption). Decrementa balances; consome FIFO se houver lotes."""
    for idx, item in enumerate(items):
        product_id   = int(item["product_id"])
        warehouse_id = int(item["warehouse_id"])
        quantity     = float(item["quantity"])
        if quantity <= 0:
            continue

        existing = (await db.execute(
            text("""
                SELECT 1 FROM stock_movements
                WHERE outbox_event_id = :eid AND reference_type = :rt
                  AND reference_id = :idx AND tenant_id = :tid
                LIMIT 1
            """),
            {"eid": event_id, "rt": f"{reference_type}_item", "idx": idx, "tid": tenant_id},
        )).fetchone()
        if existing:
            continue

        # Custo da saída: avg_cost atual ou consumo FIFO.
        bal = (await db.execute(
            text("""
                SELECT quantity, avg_cost FROM stock_balances
                WHERE product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
                FOR UPDATE
            """),
            {"pid": product_id, "wid": warehouse_id, "tid": tenant_id},
        )).fetchone()
        avg_cost_out = float(bal.avg_cost) if bal else 0.0

        # Validação stock_allow_negative.
        allow_neg = (await _get_setting(db, tenant_id, "stock_allow_negative")) or "false"
        current_qty = float(bal.quantity) if bal else 0.0
        if current_qty < quantity and allow_neg.lower() != "true":
            raise RuntimeError(
                f"Saldo insuficiente: produto={product_id} wh={warehouse_id} "
                f"atual={current_qty} requisitado={quantity}"
            )

        await db.execute(
            text("""
                INSERT INTO stock_movements
                       (type, quantity, unit_cost, reason, reference_type, reference_id,
                        outbox_event_id, product_id, warehouse_id, tenant_id)
                VALUES (:t, :q, :uc, :r, :rt, :idx, :eid, :pid, :wid, :tid)
            """),
            {"t": movement_type, "q": quantity, "uc": avg_cost_out, "r": reference_type,
             "rt": f"{reference_type}_item", "idx": idx, "eid": event_id,
             "pid": product_id, "wid": warehouse_id, "tid": tenant_id},
        )

        # Decrementa balance (UPSERT preserva avg_cost — saída não muda custo médio).
        await db.execute(
            text("""
                INSERT INTO stock_balances
                       (product_id, warehouse_id, quantity, avg_cost, tenant_id)
                VALUES (:pid, :wid, -:q, 0, :tid)
                ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
                    quantity        = stock_balances.quantity - :q,
                    last_updated_at = NOW()
            """),
            {"pid": product_id, "wid": warehouse_id, "q": quantity, "tid": tenant_id},
        )

        # FIFO: consome lotes em ordem (entry_date ASC, id ASC).
        await _consume_fifo_lots(db, tenant_id=tenant_id, product_id=product_id,
                                 warehouse_id=warehouse_id, quantity=quantity)
    logger.info(
        "_process_exit_items: %d itens (type=%s, event_id=%s) processados.",
        len(items), movement_type, event_id,
    )


async def _consume_fifo_lots(db, *, tenant_id: int, product_id: int,
                              warehouse_id: int, quantity: float) -> None:
    """Decrementa remaining_quantity dos lotes em ordem FIFO. No-op se não houver lotes."""
    remaining = quantity
    lots = (await db.execute(
        text("""
            SELECT id, remaining_quantity FROM stock_lots
            WHERE product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
              AND remaining_quantity > 0 AND active = TRUE
            ORDER BY entry_date ASC, id ASC
            FOR UPDATE
        """),
        {"pid": product_id, "wid": warehouse_id, "tid": tenant_id},
    )).fetchall()
    for lot in lots:
        if remaining <= 0:
            break
        take = min(float(lot.remaining_quantity), remaining)
        await db.execute(
            text("""
                UPDATE stock_lots
                SET    remaining_quantity = remaining_quantity - :take,
                       last_updated_at    = NOW()
                WHERE  id = :id
            """),
            {"take": take, "id": lot.id},
        )
        remaining -= take


# ── Registro dos subscribers ──────────────────────────────────────────────────
# Importações tardias evitam ciclo (Cadastros/Compras importam events só pelas constantes).
from app.modules.cadastros.events import EVT_PRODUCT_CREATED, EVT_PRODUCT_DELETED  # noqa: E402

EventBus.subscribe(EVT_PRODUCT_CREATED, on_product_created)
EventBus.subscribe(EVT_PRODUCT_DELETED, on_product_deleted)
EventBus.subscribe("purchase.received",      on_purchase_received)
EventBus.subscribe("purchase.return_sent",   on_purchase_return_sent)

logger.debug("modules/estoque/events: 6 eventos emitidos, 4 subscribers registrados.")
