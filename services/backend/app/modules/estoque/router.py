"""
modules/estoque/router.py
=========================
Endpoints REST do módulo Estoque.

Convenções
----------
- Prefixo (ModuleRegistry): /api/v1/modules/estoque
- Auth: todas as rotas exigem autenticação (require_authentication).
- Tenant é SEMPRE inferido do JWT — nunca aceito no payload.
- Mutações registradas via stock_movements + UPSERT em stock_balances na
  mesma transação. Eventos best-effort emitidos APÓS commit.

Estrutura
---------
  /warehouses                       GET POST          lista, cria
  /warehouses/{id}                  GET PATCH         detalhe, atualiza/soft-delete
  /balances                         GET               saldos paginados (filtros)
  /balances/{product_id}            GET               saldo agregado ou por wh
  /balances/{product_id}/{wh_id}    PATCH             atualiza min/max
  /movements                        GET POST          lista; cria ajuste manual
  /transfers                        POST              transferência entre depósitos
  /reservations                     GET POST          lista; cria reserva manual
  /reservations/{id}/release        POST              libera reserva ativa
  /reservations/{id}/consume        POST              consome reserva (vira saída)
  /inventory-counts                 GET POST          lista; abre contagem (snapshot)
  /inventory-counts/{id}            GET PATCH         detalhe; atualiza status
  /inventory-counts/{id}/items      GET POST          itens; adiciona produto
  /inventory-count-items/{id}       PATCH             registra contagem física
  /inventory-counts/{id}/close      POST              fecha contagem; gera ajustes
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.event_bus import EventBus
from app.dependencies.auth import require_authentication
from app.modules.estoque import events as evt
from app.modules.estoque.schemas import (
    InventoryCountCreate, InventoryCountItemCreate, InventoryCountItemOut,
    InventoryCountItemUpdate, InventoryCountOut, InventoryCountUpdate,
    StockAdjustmentCreate, StockBalanceLimitsUpdate, StockBalanceOut,
    StockMovementOut, StockReservationCreate, StockReservationOut,
    StockTransferCreate, WarehouseCreate, WarehouseOut, WarehouseUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_set_clause(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    cols = [f"{k} = :{k}" for k in payload.keys()]
    cols.append("last_updated_at = NOW()")
    return ", ".join(cols), payload


async def _fetch_one(db: AsyncSession, sql: str, params: dict) -> dict | None:
    row = (await db.execute(text(sql), params)).fetchone()
    return dict(row._mapping) if row else None


async def _fetch_all(db: AsyncSession, sql: str, params: dict) -> list[dict]:
    rows = (await db.execute(text(sql), params)).fetchall()
    return [dict(r._mapping) for r in rows]


# ── Warehouses ────────────────────────────────────────────────────────────────

@router.get("/warehouses", response_model=list[WarehouseOut])
async def list_warehouses(
    only_active: bool = Query(default=True),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM warehouses
        WHERE  tenant_id = :tid
          AND  (:active_only = FALSE OR active = TRUE)
        ORDER  BY is_default DESC, name
        """,
        {"tid": user["tenant_id"], "active_only": only_active},
    )


@router.post("/warehouses", response_model=WarehouseOut, status_code=status.HTTP_201_CREATED)
async def create_warehouse(
    body: WarehouseCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump()
    try:
        # is_default=TRUE precisa derrubar o default anterior do tenant antes do INSERT
        # (UNIQUE partial index uq_warehouses_default_per_tenant impede duplicata).
        if payload.get("is_default"):
            await db.execute(
                text("UPDATE warehouses SET is_default = FALSE WHERE tenant_id = :tid AND is_default = TRUE"),
                {"tid": user["tenant_id"]},
            )
        row = await _fetch_one(db,
            """
            INSERT INTO warehouses (code, name, type, address_line, city, state,
                                    zip_code, is_default, notes, tenant_id)
            VALUES (:code, :name, :type, :address_line, :city, :state,
                    :zip_code, :is_default, :notes, :tid)
            RETURNING *
            """,
            {**payload, "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Código de depósito duplicado: {exc.orig}")


@router.get("/warehouses/{warehouse_id}", response_model=WarehouseOut)
async def get_warehouse(
    warehouse_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM warehouses WHERE id = :id AND tenant_id = :tid",
        {"id": warehouse_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Depósito não encontrado.")
    return row


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseOut)
async def update_warehouse(
    warehouse_id: int,
    body: WarehouseUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    if payload.get("is_default") is True:
        await db.execute(
            text("""
                UPDATE warehouses SET is_default = FALSE
                WHERE  tenant_id = :tid AND is_default = TRUE AND id != :id
            """),
            {"tid": user["tenant_id"], "id": warehouse_id},
        )
    set_clause, params = _build_set_clause(payload)
    params.update({"id": warehouse_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE warehouses SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Depósito não encontrado.")
    await db.commit()
    return row


# ── Balances ──────────────────────────────────────────────────────────────────

@router.get("/balances", response_model=list[StockBalanceOut])
async def list_balances(
    warehouse_id: Optional[int] = Query(default=None),
    product_id:   Optional[int] = Query(default=None),
    low_only:     bool = Query(default=False, description="Apenas produtos abaixo do mínimo"),
    limit:        int  = Query(default=100, ge=1, le=500),
    offset:       int  = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT id, product_id, warehouse_id, quantity, reserved_quantity,
               (quantity - reserved_quantity) AS available,
               avg_cost, min_quantity, max_quantity, tenant_id, last_updated_at
        FROM   stock_balances
        WHERE  tenant_id = :tid
          AND  (CAST(:wid AS INT) IS NULL OR warehouse_id = CAST(:wid AS INT))
          AND  (CAST(:pid AS INT) IS NULL OR product_id   = CAST(:pid AS INT))
          AND  (CAST(:low AS BOOLEAN) = FALSE OR (min_quantity > 0 AND quantity <= min_quantity))
        ORDER  BY product_id
        LIMIT  :lim OFFSET :off
        """,
        {"tid": user["tenant_id"], "wid": warehouse_id, "pid": product_id,
         "low": low_only, "lim": limit, "off": offset},
    )


@router.get("/balances/{product_id}", response_model=StockBalanceOut)
async def get_balance(
    product_id: int,
    warehouse_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    from app.modules.estoque.service import EstoqueService
    bal = await EstoqueService.get_balance(db, product_id, user["tenant_id"], warehouse_id)
    if not bal:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sem saldo registrado para este produto.")
    bal.setdefault("id", 0)
    return bal


@router.patch("/balances/{product_id}/{warehouse_id}", response_model=StockBalanceOut)
async def update_balance_limits(
    product_id: int,
    warehouse_id: int,
    body: StockBalanceLimitsUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"pid": product_id, "wid": warehouse_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"""
        UPDATE stock_balances SET {set_clause}
        WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
        RETURNING id, product_id, warehouse_id, quantity, reserved_quantity,
                  (quantity - reserved_quantity) AS available,
                  avg_cost, min_quantity, max_quantity, tenant_id, last_updated_at
        """,
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saldo não encontrado.")
    await db.commit()
    return row


# ── Movements (lista + ajuste manual) ─────────────────────────────────────────

@router.get("/movements", response_model=list[StockMovementOut])
async def list_movements(
    product_id:   Optional[int] = Query(default=None),
    warehouse_id: Optional[int] = Query(default=None),
    limit:        int  = Query(default=50, ge=1, le=500),
    offset:       int  = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    from app.modules.estoque.service import EstoqueService
    return await EstoqueService.list_movements(
        db, user["tenant_id"],
        product_id=product_id, warehouse_id=warehouse_id,
        limit=limit, offset=offset,
    )


@router.post("/movements", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
async def create_adjustment(
    body: StockAdjustmentCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Ajuste manual: registra movimento e atualiza saldo na mesma transação."""
    tid = user["tenant_id"]
    sign = 1 if body.type in ("entry", "adjustment") else -1
    if body.type == "adjustment" and body.quantity == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Quantidade do ajuste não pode ser zero.")
    try:
        mov = await _fetch_one(db,
            """
            INSERT INTO stock_movements (type, quantity, unit_cost, reason, notes,
                                         product_id, warehouse_id, created_by, tenant_id)
            VALUES (:type, :qty, :uc, :reason, :notes, :pid, :wid, :uid, :tid)
            RETURNING *
            """,
            {"type": body.type, "qty": body.quantity, "uc": body.unit_cost,
             "reason": body.reason or "manual", "notes": body.notes,
             "pid": body.product_id, "wid": body.warehouse_id,
             "uid": user.get("user_id"), "tid": tid},
        )
        delta = body.quantity * sign
        # UPSERT do balance — recalcula avg_cost só em entradas com unit_cost > 0.
        await db.execute(
            text("""
                INSERT INTO stock_balances (product_id, warehouse_id, quantity, avg_cost, tenant_id)
                VALUES (:pid, :wid, :delta, :uc, :tid)
                ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
                    quantity = stock_balances.quantity + :delta,
                    avg_cost = CASE
                        WHEN :delta > 0 AND :uc > 0 AND (stock_balances.quantity + :delta) > 0
                            THEN (stock_balances.quantity * stock_balances.avg_cost
                                  + :delta * :uc) / (stock_balances.quantity + :delta)
                        ELSE stock_balances.avg_cost
                    END,
                    last_updated_at = NOW()
            """),
            {"pid": body.product_id, "wid": body.warehouse_id,
             "delta": delta, "uc": body.unit_cost, "tid": tid},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Erro ao registrar ajuste: {exc.orig}")
    await EventBus.emit(evt.EVT_STOCK_MOVEMENT_CREATED, {
        "movement_id": mov["id"], "product_id": body.product_id,
        "warehouse_id": body.warehouse_id, "type": body.type,
        "quantity": float(body.quantity), "tenant_id": tid,
    })
    return mov



# ── Transferências ────────────────────────────────────────────────────────────

@router.post("/transfers", status_code=status.HTTP_201_CREATED)
async def create_transfer(
    body: StockTransferCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Transferência entre depósitos: gera par transfer_out + transfer_in."""
    if body.source_warehouse_id == body.target_warehouse_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Origem e destino devem ser diferentes.")
    tid = user["tenant_id"]
    try:
        # Custo da saída = avg_cost atual do source (preserva valor monetário).
        bal = (await db.execute(
            text("""
                SELECT quantity, avg_cost FROM stock_balances
                WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
                FOR UPDATE
            """),
            {"pid": body.product_id, "wid": body.source_warehouse_id, "tid": tid},
        )).fetchone()
        if not bal or bal.quantity < body.quantity:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Saldo insuficiente no depósito de origem.")
        unit_cost = bal.avg_cost

        # OUT
        await db.execute(
            text("""
                INSERT INTO stock_movements (type, quantity, unit_cost, reason, notes,
                                             product_id, warehouse_id, created_by, tenant_id)
                VALUES ('transfer_out', :q, :uc, 'transfer', :n, :pid, :wid, :uid, :tid)
            """),
            {"q": body.quantity, "uc": unit_cost, "n": body.notes,
             "pid": body.product_id, "wid": body.source_warehouse_id,
             "uid": user.get("user_id"), "tid": tid},
        )
        await db.execute(
            text("""
                UPDATE stock_balances SET quantity = quantity - :q, last_updated_at = NOW()
                WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
            """),
            {"q": body.quantity, "pid": body.product_id,
             "wid": body.source_warehouse_id, "tid": tid},
        )
        # IN
        await db.execute(
            text("""
                INSERT INTO stock_movements (type, quantity, unit_cost, reason, notes,
                                             product_id, warehouse_id, created_by, tenant_id)
                VALUES ('transfer_in', :q, :uc, 'transfer', :n, :pid, :wid, :uid, :tid)
            """),
            {"q": body.quantity, "uc": unit_cost, "n": body.notes,
             "pid": body.product_id, "wid": body.target_warehouse_id,
             "uid": user.get("user_id"), "tid": tid},
        )
        await db.execute(
            text("""
                INSERT INTO stock_balances (product_id, warehouse_id, quantity, avg_cost, tenant_id)
                VALUES (:pid, :wid, :q, :uc, :tid)
                ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
                    quantity = stock_balances.quantity + :q,
                    avg_cost = CASE
                        WHEN (stock_balances.quantity + :q) = 0 THEN stock_balances.avg_cost
                        ELSE (stock_balances.quantity * stock_balances.avg_cost
                              + :q * :uc) / (stock_balances.quantity + :q)
                    END,
                    last_updated_at = NOW()
            """),
            {"pid": body.product_id, "wid": body.target_warehouse_id,
             "q": body.quantity, "uc": unit_cost, "tid": tid},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Erro na transferência: {exc.orig}")
    return {"status": "ok", "product_id": body.product_id, "quantity": body.quantity,
            "source_warehouse_id": body.source_warehouse_id,
            "target_warehouse_id": body.target_warehouse_id}


# ── Reservations ──────────────────────────────────────────────────────────────

@router.get("/reservations", response_model=list[StockReservationOut])
async def list_reservations(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    product_id:    Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM stock_reservations
        WHERE  tenant_id = :tid
          AND  (CAST(:st  AS TEXT) IS NULL OR status     = CAST(:st AS TEXT))
          AND  (CAST(:pid AS INT)  IS NULL OR product_id = CAST(:pid AS INT))
        ORDER  BY created_at DESC
        LIMIT  200
        """,
        {"tid": user["tenant_id"], "st": status_filter, "pid": product_id},
    )


@router.post("/reservations", response_model=StockReservationOut, status_code=status.HTTP_201_CREATED)
async def create_reservation(
    body: StockReservationCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    tid = user["tenant_id"]
    # Valida disponível antes de reservar.
    bal = (await db.execute(
        text("""
            SELECT (quantity - reserved_quantity) AS available FROM stock_balances
            WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
            FOR UPDATE
        """),
        {"pid": body.product_id, "wid": body.warehouse_id, "tid": tid},
    )).fetchone()
    available = Decimal(str(bal.available)) if bal else Decimal("0")
    if available < body.quantity:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Disponível insuficiente: {available} < {body.quantity}.")
    res = await _fetch_one(db,
        """
        INSERT INTO stock_reservations (quantity, expires_at, reference_type, reference_id,
                                        product_id, warehouse_id, tenant_id)
        VALUES (:q, :exp, :rt, :rid, :pid, :wid, :tid)
        RETURNING *
        """,
        {"q": body.quantity, "exp": body.expires_at, "rt": body.reference_type,
         "rid": body.reference_id, "pid": body.product_id,
         "wid": body.warehouse_id, "tid": tid},
    )
    await db.execute(
        text("""
            UPDATE stock_balances SET reserved_quantity = reserved_quantity + :q,
                                      last_updated_at  = NOW()
            WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
        """),
        {"q": body.quantity, "pid": body.product_id,
         "wid": body.warehouse_id, "tid": tid},
    )
    await db.commit()
    await EventBus.emit(evt.EVT_STOCK_RESERVATION_CREATED, {
        "reservation_id": res["id"], "product_id": body.product_id,
        "quantity": float(body.quantity), "tenant_id": tid,
    })
    return res



@router.post("/reservations/{reservation_id}/release", response_model=StockReservationOut)
async def release_reservation(
    reservation_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    tid = user["tenant_id"]
    res = await _fetch_one(db,
        """
        UPDATE stock_reservations
        SET    status = 'released', released_at = NOW(), last_updated_at = NOW()
        WHERE  id = :id AND tenant_id = :tid AND status = 'active'
        RETURNING *
        """,
        {"id": reservation_id, "tid": tid},
    )
    if not res:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reserva ativa não encontrada.")
    await db.execute(
        text("""
            UPDATE stock_balances SET reserved_quantity = reserved_quantity - :q,
                                      last_updated_at  = NOW()
            WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
        """),
        {"q": res["quantity"], "pid": res["product_id"],
         "wid": res["warehouse_id"], "tid": tid},
    )
    await db.commit()
    await EventBus.emit(evt.EVT_STOCK_RESERVATION_RELEASED,
                        {"reservation_id": reservation_id, "tenant_id": tid})
    return res


@router.post("/reservations/{reservation_id}/consume", response_model=StockReservationOut)
async def consume_reservation(
    reservation_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Consome reserva: marca consumed_at e gera stock_movement tipo 'consumption'.
    Decrementa quantity (saída efetiva) e reserved_quantity simultaneamente."""
    tid = user["tenant_id"]
    res = await _fetch_one(db,
        """
        UPDATE stock_reservations
        SET    status = 'consumed', consumed_at = NOW(), last_updated_at = NOW()
        WHERE  id = :id AND tenant_id = :tid AND status = 'active'
        RETURNING *
        """,
        {"id": reservation_id, "tid": tid},
    )
    if not res:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reserva ativa não encontrada.")
    bal = (await db.execute(
        text("SELECT avg_cost FROM stock_balances WHERE product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid"),
        {"pid": res["product_id"], "wid": res["warehouse_id"], "tid": tid},
    )).fetchone()
    avg_cost = bal.avg_cost if bal else 0
    await db.execute(
        text("""
            INSERT INTO stock_movements (type, quantity, unit_cost, reason,
                                         reference_type, reference_id,
                                         product_id, warehouse_id, created_by, tenant_id)
            VALUES ('consumption', :q, :uc, 'reservation_consumed',
                    'stock_reservation', :rid,
                    :pid, :wid, :uid, :tid)
        """),
        {"q": res["quantity"], "uc": avg_cost, "rid": reservation_id,
         "pid": res["product_id"], "wid": res["warehouse_id"],
         "uid": user.get("user_id"), "tid": tid},
    )
    await db.execute(
        text("""
            UPDATE stock_balances
            SET    quantity          = quantity          - :q,
                   reserved_quantity = reserved_quantity - :q,
                   last_updated_at   = NOW()
            WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
        """),
        {"q": res["quantity"], "pid": res["product_id"],
         "wid": res["warehouse_id"], "tid": tid},
    )
    await db.commit()
    return res


# ── Inventory Counts ──────────────────────────────────────────────────────────

@router.get("/inventory-counts", response_model=list[InventoryCountOut])
async def list_inventory_counts(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM inventory_counts
        WHERE  tenant_id = :tid AND (CAST(:st AS TEXT) IS NULL OR status = CAST(:st AS TEXT))
        ORDER  BY opened_at DESC
        """,
        {"tid": user["tenant_id"], "st": status_filter},
    )


@router.post("/inventory-counts", response_model=InventoryCountOut, status_code=status.HTTP_201_CREATED)
async def create_inventory_count(
    body: InventoryCountCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Abre contagem física e snapshot de saldos esperados (todos os produtos com balance no warehouse)."""
    tid = user["tenant_id"]
    try:
        cnt = await _fetch_one(db,
            """
            INSERT INTO inventory_counts (code, description, warehouse_id, opened_by, tenant_id)
            VALUES (:code, :desc, :wid, :uid, :tid)
            RETURNING *
            """,
            {"code": body.code, "desc": body.description, "wid": body.warehouse_id,
             "uid": user.get("user_id"), "tid": tid},
        )
        # Snapshot: cria 1 row por produto com saldo no warehouse.
        await db.execute(
            text("""
                INSERT INTO inventory_count_items
                       (inventory_count_id, product_id, expected_quantity, tenant_id)
                SELECT :cid, product_id, quantity, :tid
                FROM   stock_balances
                WHERE  warehouse_id = :wid AND tenant_id = :tid
            """),
            {"cid": cnt["id"], "wid": body.warehouse_id, "tid": tid},
        )
        await db.commit()
        return cnt
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Código de contagem duplicado: {exc.orig}")



@router.get("/inventory-counts/{count_id}", response_model=InventoryCountOut)
async def get_inventory_count(
    count_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM inventory_counts WHERE id = :id AND tenant_id = :tid",
        {"id": count_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contagem não encontrada.")
    return row


@router.patch("/inventory-counts/{count_id}", response_model=InventoryCountOut)
async def update_inventory_count(
    count_id: int,
    body: InventoryCountUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": count_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE inventory_counts SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contagem não encontrada.")
    await db.commit()
    return row


@router.get("/inventory-counts/{count_id}/items", response_model=list[InventoryCountItemOut])
async def list_inventory_items(
    count_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM inventory_count_items
        WHERE  inventory_count_id = :cid AND tenant_id = :tid
        ORDER  BY id
        """,
        {"cid": count_id, "tid": user["tenant_id"]},
    )


@router.post("/inventory-counts/{count_id}/items", response_model=InventoryCountItemOut,
             status_code=status.HTTP_201_CREATED)
async def add_inventory_item(
    count_id: int,
    body: InventoryCountItemCreate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """Adiciona produto fora do snapshot inicial (ex.: produto sem balance prévio)."""
    tid = user["tenant_id"]
    cnt = await _fetch_one(db,
        "SELECT warehouse_id, status FROM inventory_counts WHERE id = :id AND tenant_id = :tid",
        {"id": count_id, "tid": tid},
    )
    if not cnt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contagem não encontrada.")
    if cnt["status"] not in ("open", "counting"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contagem não está aberta para edição.")
    bal = (await db.execute(
        text("""
            SELECT quantity FROM stock_balances
            WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
        """),
        {"pid": body.product_id, "wid": cnt["warehouse_id"], "tid": tid},
    )).fetchone()
    expected = bal.quantity if bal else 0
    try:
        item = await _fetch_one(db,
            """
            INSERT INTO inventory_count_items
                   (inventory_count_id, product_id, expected_quantity, notes, tenant_id)
            VALUES (:cid, :pid, :exp, :notes, :tid)
            RETURNING *
            """,
            {"cid": count_id, "pid": body.product_id, "exp": expected,
             "notes": body.notes, "tid": tid},
        )
        await db.commit()
        return item
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Produto já listado: {exc.orig}")


@router.patch("/inventory-count-items/{item_id}", response_model=InventoryCountItemOut)
async def update_inventory_item(
    item_id: int,
    body: InventoryCountItemUpdate,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": item_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE inventory_count_items SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item de contagem não encontrado.")
    await db.commit()
    return row


@router.post("/inventory-counts/{count_id}/close", response_model=InventoryCountOut)
async def close_inventory_count(
    count_id: int,
    db: AsyncSession = Depends(get_db_session),
    user: dict = Depends(require_authentication),
):
    """
    Fecha contagem: calcula adjustment_quantity (counted - expected) por item,
    gera 1 stock_movement tipo 'adjustment' por divergência, atualiza balances
    e marca a contagem como 'closed'. Itens sem counted_quantity são ignorados.
    """
    tid = user["tenant_id"]
    cnt = await _fetch_one(db,
        "SELECT * FROM inventory_counts WHERE id = :id AND tenant_id = :tid FOR UPDATE",
        {"id": count_id, "tid": tid},
    )
    if not cnt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contagem não encontrada.")
    if cnt["status"] == "closed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contagem já está fechada.")
    items = await _fetch_all(db,
        """
        SELECT id, product_id, expected_quantity, counted_quantity
        FROM   inventory_count_items
        WHERE  inventory_count_id = :cid AND tenant_id = :tid
          AND  counted_quantity IS NOT NULL
        FOR UPDATE
        """,
        {"cid": count_id, "tid": tid},
    )
    total_adjustments = 0
    for it in items:
        adj = it["counted_quantity"] - it["expected_quantity"]
        await db.execute(
            text("""
                UPDATE inventory_count_items SET adjustment_quantity = :adj, last_updated_at = NOW()
                WHERE  id = :id
            """),
            {"adj": adj, "id": it["id"]},
        )
        if adj == 0:
            continue
        total_adjustments += 1
        mov_type = "adjustment"
        await db.execute(
            text("""
                INSERT INTO stock_movements (type, quantity, unit_cost, reason,
                                             reference_type, reference_id,
                                             product_id, warehouse_id, created_by, tenant_id)
                VALUES (:t, :q, 0, 'inventory_count', 'inventory_count', :cid,
                        :pid, :wid, :uid, :tid)
            """),
            {"t": mov_type, "q": abs(adj), "cid": count_id,
             "pid": it["product_id"], "wid": cnt["warehouse_id"],
             "uid": user.get("user_id"), "tid": tid},
        )
        await db.execute(
            text("""
                INSERT INTO stock_balances (product_id, warehouse_id, quantity, avg_cost, tenant_id)
                VALUES (:pid, :wid, :adj, 0, :tid)
                ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
                    quantity        = stock_balances.quantity + :adj,
                    last_updated_at = NOW()
            """),
            {"pid": it["product_id"], "wid": cnt["warehouse_id"],
             "adj": adj, "tid": tid},
        )
    closed = await _fetch_one(db,
        """
        UPDATE inventory_counts
        SET    status = 'closed', closed_at = NOW(), closed_by = :uid, last_updated_at = NOW()
        WHERE  id = :id AND tenant_id = :tid
        RETURNING *
        """,
        {"id": count_id, "uid": user.get("user_id"), "tid": tid},
    )
    await db.commit()
    await EventBus.emit(evt.EVT_STOCK_INVENTORY_CLOSED, {
        "inventory_count_id": count_id, "total_adjustments": total_adjustments,
        "tenant_id": tid,
    })
    return closed
