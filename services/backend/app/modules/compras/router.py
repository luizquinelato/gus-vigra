"""
modules/compras/router.py
=========================
Endpoints REST do módulo Compras.

Convenções
----------
- Prefixo (ModuleRegistry): /api/v1/modules/compras
- Auth: todas as rotas exigem autenticação (require_authentication).
- Tenant é SEMPRE inferido do JWT — nunca aceito no payload.
- Eventos transacionais (purchase.received, purchase.return_sent,
  purchase.payable_due) usam emit_reliable na MESMA transação.
- Eventos informativos (purchase.order.approved/cancelled) usam emit
  best-effort APÓS commit.

Estrutura
---------
  /suppliers                              GET POST          lista, cria
  /suppliers/{id}                         GET PATCH         detalhe, atualiza/soft-delete
  /suppliers/{id}/contacts                GET POST          contatos
  /supplier-contacts/{id}                 PATCH             atualiza contato
  /suppliers/{id}/ratings                 GET POST          avaliações por PO
  /quotations                             GET POST          lista; cria RFQ + itens
  /quotations/{id}                        GET PATCH         detalhe; atualiza/cancela
  /quotations/{id}/responses              GET POST          respostas dos fornecedores
  /quotations/{id}/approve                POST              aprova resposta → cria PO
  /purchase-orders                        GET POST          lista; cria PO + itens
  /purchase-orders/{id}                   GET PATCH         detalhe; atualiza
  /purchase-orders/{id}/approve           POST              transição → approved
  /purchase-orders/{id}/send              POST              transição → sent
  /purchase-orders/{id}/cancel            POST              transição → cancelled
  /purchase-orders/{id}/receipts          GET POST          lista; cria recibo (emit_reliable)
  /quick-entry                            POST              MEI: PO + recibo em 1 transação (emit_reliable)
"""
from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.event_bus import EventBus
from app.dependencies.auth import require_authentication
from app.modules.compras import events as evt
from app.modules.compras.schemas import (
    PurchaseOrderCancel, PurchaseOrderCreate, PurchaseOrderItemOut,
    PurchaseOrderOut, PurchaseOrderUpdate,
    PurchaseReceiptCreate, PurchaseReceiptItemOut, PurchaseReceiptOut,
    QuickEntryCreate, QuickEntryOut,
    QuotationCreate, QuotationItemOut, QuotationOut,
    QuotationResponseCreate, QuotationResponseOut,
    SupplierContactCreate, SupplierContactOut, SupplierContactUpdate,
    SupplierCreate, SupplierOut, SupplierRatingCreate, SupplierRatingOut,
    SupplierUpdate,
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


async def _next_po_number(db: AsyncSession, tenant_id: int) -> str:
    """Gera po_number sequencial: {prefix}-{YYYY}-{NNNNNN}."""
    prefix_row = (await db.execute(
        text("""
            SELECT setting_value FROM system_settings
            WHERE  tenant_id = :tid AND setting_key = 'purchase_po_number_prefix' AND active = TRUE
        """),
        {"tid": tenant_id},
    )).fetchone()
    prefix = (prefix_row.setting_value if prefix_row and prefix_row.setting_value else "PO").strip() or "PO"
    year = datetime.utcnow().year
    seq_row = (await db.execute(
        text("""
            SELECT COUNT(*) AS n FROM purchase_orders
            WHERE  tenant_id = :tid
              AND  po_number LIKE :prefix_like
        """),
        {"tid": tenant_id, "prefix_like": f"{prefix}-{year}-%"},
    )).fetchone()
    n = (seq_row.n if seq_row else 0) + 1
    return f"{prefix}-{year}-{n:06d}"


def _calc_po_totals(items: list[dict], discount: Decimal, shipping: Decimal) -> tuple[Decimal, Decimal]:
    subtotal = Decimal("0")
    for it in items:
        qty       = Decimal(str(it["quantity_ordered"]))
        unit_cost = Decimal(str(it["unit_cost"]))
        disc_pct  = Decimal(str(it.get("discount_pct") or 0))
        line_total = (qty * unit_cost) * (Decimal("1") - disc_pct / Decimal("100"))
        subtotal += line_total
        it["total_cost"] = line_total.quantize(Decimal("0.01"))
    total = subtotal - discount + shipping
    return subtotal.quantize(Decimal("0.01")), total.quantize(Decimal("0.01"))


async def _get_setting(db: AsyncSession, tenant_id: int, key: str) -> str | None:
    row = (await db.execute(
        text("""
            SELECT setting_value FROM system_settings
            WHERE  tenant_id = :tid AND setting_key = :k AND active = TRUE
        """),
        {"tid": tenant_id, "k": key},
    )).fetchone()
    return row.setting_value if row else None


async def _should_auto_approve(db: AsyncSession, tenant_id: int, total: Decimal) -> bool:
    """
    Lê purchase_approval_threshold (R$). Regra MEI-friendly:
    - threshold ausente OU == 0  → toda PO nasce 'approved' (perfil micro).
    - total <= threshold         → 'approved'.
    - total >  threshold         → 'draft' (requer aprovação manual).
    """
    raw = await _get_setting(db, tenant_id, "purchase_approval_threshold")
    if raw is None:
        return True
    try:
        threshold = Decimal(str(raw).strip())
    except Exception:
        logger.warning("purchase_approval_threshold inválido (%r) — assumindo 0.", raw)
        return True
    if threshold <= 0:
        return True
    return total <= threshold



# ── Suppliers ────────────────────────────────────────────────────────────────

@router.get("/suppliers", response_model=list[SupplierOut])
async def list_suppliers(
    only_active: bool = Query(default=True),
    search:      Optional[str] = Query(default=None),
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    sql = """
        SELECT * FROM suppliers
        WHERE  tenant_id = :tid
          AND  (CAST(:active_only AS BOOLEAN) = FALSE OR active = TRUE)
          AND  (CAST(:search AS TEXT) IS NULL OR name ILIKE CAST(:like AS TEXT) OR document LIKE CAST(:like AS TEXT))
        ORDER  BY name
    """
    like = f"%{search}%" if search else None
    return await _fetch_all(db, sql,
        {"tid": user["tenant_id"], "active_only": only_active, "search": search, "like": like})


@router.post("/suppliers", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    body: SupplierCreate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO suppliers (type, name, trade_name, document, email, phone,
                                   payment_terms_days, discount_pct, notes,
                                   default_warehouse_id, tenant_id)
            VALUES (:type, :name, :trade_name, :document, :email, :phone,
                    :payment_terms_days, :discount_pct, :notes,
                    :default_warehouse_id, :tid)
            RETURNING *
            """,
            {**body.model_dump(), "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Documento já cadastrado: {exc.orig}")


@router.get("/suppliers/{supplier_id}", response_model=SupplierOut)
async def get_supplier(
    supplier_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM suppliers WHERE id = :id AND tenant_id = :tid",
        {"id": supplier_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornecedor não encontrado.")
    return row


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
async def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": supplier_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE suppliers SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornecedor não encontrado.")
    await db.commit()
    return row


# ── Supplier Contacts ────────────────────────────────────────────────────────

@router.get("/suppliers/{supplier_id}/contacts", response_model=list[SupplierContactOut])
async def list_supplier_contacts(
    supplier_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM supplier_contacts
        WHERE  supplier_id = :sid AND tenant_id = :tid AND active = TRUE
        ORDER  BY is_primary DESC, name
        """,
        {"sid": supplier_id, "tid": user["tenant_id"]},
    )


@router.post("/suppliers/{supplier_id}/contacts", response_model=SupplierContactOut,
             status_code=status.HTTP_201_CREATED)
async def create_supplier_contact(
    supplier_id: int,
    body: SupplierContactCreate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    sup = await _fetch_one(db,
        "SELECT id FROM suppliers WHERE id = :id AND tenant_id = :tid",
        {"id": supplier_id, "tid": user["tenant_id"]},
    )
    if not sup:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornecedor não encontrado.")
    try:
        if body.is_primary:
            await db.execute(text("""
                UPDATE supplier_contacts SET is_primary = FALSE
                WHERE  supplier_id = :sid AND is_primary = TRUE AND active = TRUE
            """), {"sid": supplier_id})
        row = await _fetch_one(db,
            """
            INSERT INTO supplier_contacts (name, role, email, phone, is_primary,
                                           supplier_id, tenant_id)
            VALUES (:name, :role, :email, :phone, :is_primary, :sid, :tid)
            RETURNING *
            """,
            {**body.model_dump(), "sid": supplier_id, "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc.orig))


@router.patch("/supplier-contacts/{contact_id}", response_model=SupplierContactOut)
async def update_supplier_contact(
    contact_id: int,
    body: SupplierContactUpdate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    if payload.get("is_primary"):
        await db.execute(text("""
            UPDATE supplier_contacts SET is_primary = FALSE
            WHERE  supplier_id = (SELECT supplier_id FROM supplier_contacts WHERE id = :id)
              AND  id != :id AND is_primary = TRUE AND active = TRUE
        """), {"id": contact_id})
    set_clause, params = _build_set_clause(payload)
    params.update({"id": contact_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE supplier_contacts SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
    await db.commit()
    return row



# ── Supplier Ratings ─────────────────────────────────────────────────────────

@router.get("/suppliers/{supplier_id}/ratings", response_model=list[SupplierRatingOut])
async def list_supplier_ratings(
    supplier_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM supplier_ratings
        WHERE  supplier_id = :sid AND tenant_id = :tid AND active = TRUE
        ORDER  BY created_at DESC
        """,
        {"sid": supplier_id, "tid": user["tenant_id"]},
    )


@router.post("/suppliers/{supplier_id}/ratings", response_model=SupplierRatingOut,
             status_code=status.HTTP_201_CREATED)
async def create_supplier_rating(
    supplier_id: int,
    body: SupplierRatingCreate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    if body.supplier_id != supplier_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "supplier_id do path e body diferem.")
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO supplier_ratings (delivery_rating, quality_rating, price_rating,
                                          notes, supplier_id, purchase_order_id,
                                          rated_by, tenant_id)
            VALUES (:delivery_rating, :quality_rating, :price_rating, :notes,
                    :supplier_id, :purchase_order_id, :rated_by, :tid)
            RETURNING *
            """,
            {**body.model_dump(), "rated_by": user["id"], "tid": user["tenant_id"]},
        )
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail=f"Avaliação já existe para este PO: {exc.orig}")


# ── Quotations (RFQ) ─────────────────────────────────────────────────────────

@router.get("/quotations", response_model=list[QuotationOut])
async def list_quotations(
    status_eq: Optional[str] = Query(default=None, alias="status"),
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM purchase_quotations
        WHERE  tenant_id = :tid
          AND  active    = TRUE
          AND  (CAST(:st AS TEXT) IS NULL OR status = CAST(:st AS TEXT))
        ORDER  BY created_at DESC
        """,
        {"tid": user["tenant_id"], "st": status_eq},
    )


@router.post("/quotations", response_model=QuotationOut, status_code=status.HTTP_201_CREATED)
async def create_quotation(
    body: QuotationCreate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    try:
        q = await _fetch_one(db,
            """
            INSERT INTO purchase_quotations (notes, expires_at, created_by, tenant_id)
            VALUES (:notes, :expires_at, :uid, :tid)
            RETURNING *
            """,
            {"notes": body.notes, "expires_at": body.expires_at,
             "uid": user["id"], "tid": user["tenant_id"]},
        )
        for it in body.items:
            await db.execute(text("""
                INSERT INTO purchase_quotation_items
                       (requested_quantity, notes, quotation_id, product_id, tenant_id)
                VALUES (:q, :n, :qid, :pid, :tid)
            """), {"q": it.requested_quantity, "n": it.notes, "qid": q["id"],
                   "pid": it.product_id, "tid": user["tenant_id"]})
        await db.commit()
        return q
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc.orig))


@router.get("/quotations/{quotation_id}", response_model=QuotationOut)
async def get_quotation(
    quotation_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM purchase_quotations WHERE id = :id AND tenant_id = :tid",
        {"id": quotation_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cotação não encontrada.")
    return row


@router.get("/quotations/{quotation_id}/items", response_model=list[QuotationItemOut])
async def list_quotation_items(
    quotation_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM purchase_quotation_items
        WHERE  quotation_id = :qid AND tenant_id = :tid AND active = TRUE
        ORDER  BY id
        """,
        {"qid": quotation_id, "tid": user["tenant_id"]},
    )


@router.get("/quotations/{quotation_id}/responses", response_model=list[QuotationResponseOut])
async def list_quotation_responses(
    quotation_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM purchase_quotation_responses
        WHERE  quotation_id = :qid AND tenant_id = :tid AND active = TRUE
        ORDER  BY unit_price NULLS LAST, delivery_days NULLS LAST
        """,
        {"qid": quotation_id, "tid": user["tenant_id"]},
    )


@router.post("/quotations/{quotation_id}/responses", response_model=QuotationResponseOut,
             status_code=status.HTTP_201_CREATED)
async def create_quotation_response(
    quotation_id: int,
    body: QuotationResponseCreate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    try:
        row = await _fetch_one(db,
            """
            INSERT INTO purchase_quotation_responses
                   (unit_price, delivery_days, payment_terms, notes,
                    quotation_id, supplier_id, tenant_id)
            VALUES (:up, :dd, :pt, :n, :qid, :sid, :tid)
            RETURNING *
            """,
            {"up": body.unit_price, "dd": body.delivery_days, "pt": body.payment_terms,
             "n": body.notes, "qid": quotation_id, "sid": body.supplier_id,
             "tid": user["tenant_id"]},
        )
        await db.execute(text("""
            UPDATE purchase_quotations SET status = 'responded', last_updated_at = NOW()
            WHERE  id = :qid AND tenant_id = :tid AND status = 'open'
        """), {"qid": quotation_id, "tid": user["tenant_id"]})
        await db.commit()
        return row
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail=f"Fornecedor já respondeu esta cotação: {exc.orig}")



# ── Purchase Orders ──────────────────────────────────────────────────────────

@router.get("/purchase-orders", response_model=list[PurchaseOrderOut])
async def list_purchase_orders(
    status_eq:    Optional[str] = Query(default=None, alias="status"),
    supplier_id:  Optional[int] = Query(default=None),
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM purchase_orders
        WHERE  tenant_id = :tid
          AND  active    = TRUE
          AND  (CAST(:st  AS TEXT) IS NULL OR status      = CAST(:st AS TEXT))
          AND  (CAST(:sid AS INT)  IS NULL OR supplier_id = CAST(:sid AS INT))
        ORDER  BY created_at DESC
        """,
        {"tid": user["tenant_id"], "st": status_eq, "sid": supplier_id},
    )


@router.post("/purchase-orders", response_model=PurchaseOrderOut,
             status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    body: PurchaseOrderCreate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    if not body.items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "PO sem itens.")
    items_dump = [it.model_dump() for it in body.items]
    discount = Decimal(str(body.discount_amount or 0))
    shipping = Decimal(str(body.shipping_amount or 0))
    subtotal, total = _calc_po_totals(items_dump, discount, shipping)
    tid = user["tenant_id"]
    auto_approved = await _should_auto_approve(db, tid, total)
    initial_status = "approved" if auto_approved else "draft"
    try:
        po_number = await _next_po_number(db, tid)
        po = await _fetch_one(db,
            """
            INSERT INTO purchase_orders
                   (po_number, status, subtotal, discount_amount, shipping_amount,
                    total_amount, payment_terms_days, expected_delivery_date, notes,
                    approved_at, approved_by,
                    supplier_id, warehouse_id, quotation_id, created_by, tenant_id)
            VALUES (:po_number, :st, :subtotal, :discount, :shipping,
                    :total, :pt, :edd, :notes,
                    CASE WHEN :st = 'approved' THEN NOW() ELSE NULL END,
                    CASE WHEN :st = 'approved' THEN :uid ELSE NULL END,
                    :sid, :wid, :qid, :uid, :tid)
            RETURNING *
            """,
            {"po_number": po_number, "st": initial_status,
             "subtotal": subtotal, "discount": discount,
             "shipping": shipping, "total": total,
             "pt": body.payment_terms_days, "edd": body.expected_delivery_date,
             "notes": body.notes, "sid": body.supplier_id, "wid": body.warehouse_id,
             "qid": body.quotation_id, "uid": user["id"], "tid": tid},
        )
        for it in items_dump:
            await db.execute(text("""
                INSERT INTO purchase_order_items
                       (quantity_ordered, unit_cost, discount_pct, total_cost, notes,
                        purchase_order_id, product_id, warehouse_id, tenant_id)
                VALUES (:qty, :uc, :dp, :tc, :notes,
                        :po_id, :pid, :wid, :tid)
            """), {"qty": it["quantity_ordered"], "uc": it["unit_cost"],
                   "dp": it.get("discount_pct") or 0, "tc": it["total_cost"],
                   "notes": it.get("notes"), "po_id": po["id"],
                   "pid": it["product_id"], "wid": it.get("warehouse_id") or body.warehouse_id,
                   "tid": tid})
        await db.commit()
        if auto_approved:
            await EventBus.emit(evt.EVT_PURCHASE_ORDER_APPROVED, {
                "purchase_order_id": po["id"],
                "supplier_id":       po["supplier_id"],
                "total_amount":      str(total),
                "approved_by":       user["id"],
                "tenant_id":         tid,
                "auto_approved":     True,
            })
        return po
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc.orig))


@router.get("/purchase-orders/{po_id}", response_model=PurchaseOrderOut)
async def get_purchase_order(
    po_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    row = await _fetch_one(db,
        "SELECT * FROM purchase_orders WHERE id = :id AND tenant_id = :tid",
        {"id": po_id, "tid": user["tenant_id"]},
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")
    return row


@router.get("/purchase-orders/{po_id}/items", response_model=list[PurchaseOrderItemOut])
async def list_purchase_order_items(
    po_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM purchase_order_items
        WHERE  purchase_order_id = :pid AND tenant_id = :tid AND active = TRUE
        ORDER  BY id
        """,
        {"pid": po_id, "tid": user["tenant_id"]},
    )


@router.patch("/purchase-orders/{po_id}", response_model=PurchaseOrderOut)
async def update_purchase_order(
    po_id: int,
    body:  PurchaseOrderUpdate,
    db:    AsyncSession = Depends(get_db_session),
    user:  dict         = Depends(require_authentication),
):
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum campo para atualizar.")
    cur = await _fetch_one(db,
        "SELECT status FROM purchase_orders WHERE id = :id AND tenant_id = :tid",
        {"id": po_id, "tid": user["tenant_id"]},
    )
    if not cur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")
    if cur["status"] not in ("draft", "pending_approval"):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Edição não permitida no status '{cur['status']}'.")
    set_clause, params = _build_set_clause(payload)
    params.update({"id": po_id, "tid": user["tenant_id"]})
    row = await _fetch_one(db,
        f"UPDATE purchase_orders SET {set_clause} WHERE id = :id AND tenant_id = :tid RETURNING *",
        params,
    )
    await db.commit()
    return row



# ── PO State Transitions ─────────────────────────────────────────────────────

@router.post("/purchase-orders/{po_id}/approve", response_model=PurchaseOrderOut)
async def approve_purchase_order(
    po_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    cur = await _fetch_one(db,
        "SELECT status, supplier_id, total_amount FROM purchase_orders WHERE id = :id AND tenant_id = :tid",
        {"id": po_id, "tid": user["tenant_id"]},
    )
    if not cur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")
    if cur["status"] not in ("draft", "pending_approval"):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Não é possível aprovar PO no status '{cur['status']}'.")
    row = await _fetch_one(db,
        """
        UPDATE purchase_orders
        SET    status = 'approved', approved_at = NOW(),
               approved_by = :uid, last_updated_at = NOW()
        WHERE  id = :id AND tenant_id = :tid
        RETURNING *
        """,
        {"id": po_id, "uid": user["id"], "tid": user["tenant_id"]},
    )
    await db.commit()
    await EventBus.emit(evt.EVT_PURCHASE_ORDER_APPROVED, {
        "purchase_order_id": po_id,
        "supplier_id":       cur["supplier_id"],
        "total_amount":      str(cur["total_amount"]),
        "approved_by":       user["id"],
        "tenant_id":         user["tenant_id"],
    })
    return row


@router.post("/purchase-orders/{po_id}/send", response_model=PurchaseOrderOut)
async def send_purchase_order(
    po_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    cur = await _fetch_one(db,
        "SELECT status FROM purchase_orders WHERE id = :id AND tenant_id = :tid",
        {"id": po_id, "tid": user["tenant_id"]},
    )
    if not cur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")
    if cur["status"] != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"Apenas POs 'approved' podem ser enviadas (atual: '{cur['status']}').")
    row = await _fetch_one(db,
        """
        UPDATE purchase_orders
        SET    status = 'sent', sent_at = NOW(), last_updated_at = NOW()
        WHERE  id = :id AND tenant_id = :tid
        RETURNING *
        """,
        {"id": po_id, "tid": user["tenant_id"]},
    )
    await db.commit()
    return row


@router.post("/purchase-orders/{po_id}/cancel", response_model=PurchaseOrderOut)
async def cancel_purchase_order(
    po_id: int,
    body: PurchaseOrderCancel,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    cur = await _fetch_one(db,
        "SELECT status, supplier_id FROM purchase_orders WHERE id = :id AND tenant_id = :tid",
        {"id": po_id, "tid": user["tenant_id"]},
    )
    if not cur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")
    if cur["status"] in ("received", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"PO já está em status final ('{cur['status']}').")
    row = await _fetch_one(db,
        """
        UPDATE purchase_orders
        SET    status = 'cancelled', cancelled_at = NOW(),
               cancellation_reason = :reason, last_updated_at = NOW()
        WHERE  id = :id AND tenant_id = :tid
        RETURNING *
        """,
        {"id": po_id, "reason": body.reason, "tid": user["tenant_id"]},
    )
    await db.commit()
    await EventBus.emit(evt.EVT_PURCHASE_ORDER_CANCELLED, {
        "purchase_order_id": po_id,
        "supplier_id":       cur["supplier_id"],
        "reason":            body.reason,
        "tenant_id":         user["tenant_id"],
    })
    return row



# ── Receipts (emit_reliable: purchase.received) ──────────────────────────────

@router.get("/purchase-orders/{po_id}/receipts", response_model=list[PurchaseReceiptOut])
async def list_receipts(
    po_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM purchase_order_receipts
        WHERE  purchase_order_id = :pid AND tenant_id = :tid
        ORDER  BY received_at DESC
        """,
        {"pid": po_id, "tid": user["tenant_id"]},
    )


@router.post("/purchase-orders/{po_id}/receipts", response_model=PurchaseReceiptOut,
             status_code=status.HTTP_201_CREATED)
async def create_receipt(
    po_id: int,
    body:  PurchaseReceiptCreate,
    db:    AsyncSession = Depends(get_db_session),
    user:  dict         = Depends(require_authentication),
):
    """
    Cria um recibo (parcial ou total). Atualiza quantity_received nos itens da PO,
    transiciona o status (partially_received ou received) e emite
    `purchase.received` via emit_reliable na MESMA transação.

    O OutboxProcessor entrega o evento ao subscriber do Estoque (~2s),
    que cria os stock_movements (entry) e atualiza stock_balances.
    """
    tid = user["tenant_id"]
    po = await _fetch_one(db,
        "SELECT id, status, supplier_id, payment_terms_days, total_amount FROM purchase_orders WHERE id = :id AND tenant_id = :tid",
        {"id": po_id, "tid": tid},
    )
    if not po:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado.")
    if po["status"] not in ("approved", "sent", "partially_received"):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"PO no status '{po['status']}' não aceita recibos.")

    # Valida itens contra a PO.
    item_rows = await _fetch_all(db,
        """
        SELECT id, product_id, quantity_ordered, quantity_received, unit_cost
        FROM   purchase_order_items
        WHERE  purchase_order_id = :pid AND tenant_id = :tid AND active = TRUE
        """,
        {"pid": po_id, "tid": tid},
    )
    by_id = {r["id"]: r for r in item_rows}
    for it in body.items:
        if it.purchase_order_item_id not in by_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"Item {it.purchase_order_item_id} não pertence à PO {po_id}.")
        po_item = by_id[it.purchase_order_item_id]
        remaining = Decimal(str(po_item["quantity_ordered"])) - Decimal(str(po_item["quantity_received"]))
        if Decimal(str(it.quantity_received)) > remaining:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"Item {it.purchase_order_item_id}: recebido excede pendente "
                                f"(pendente={remaining}, tentando={it.quantity_received}).")

    try:
        receipt = await _fetch_one(db,
            """
            INSERT INTO purchase_order_receipts
                   (received_at, invoice_number, invoice_date, notes,
                    purchase_order_id, received_by, tenant_id)
            VALUES (NOW(), :invn, :invd, :notes, :pid, :uid, :tid)
            RETURNING *
            """,
            {"invn": body.invoice_number, "invd": body.invoice_date, "notes": body.notes,
             "pid": po_id, "uid": user["id"], "tid": tid},
        )

        event_items: list[dict] = []
        for it in body.items:
            await db.execute(text("""
                INSERT INTO purchase_order_receipt_items
                       (quantity_received, unit_cost, discrepancy_notes,
                        receipt_id, purchase_order_item_id, product_id, warehouse_id, tenant_id)
                VALUES (:qty, :uc, :dn, :rid, :poi, :pid, :wid, :tid)
            """), {"qty": it.quantity_received, "uc": it.unit_cost,
                   "dn": it.discrepancy_notes, "rid": receipt["id"],
                   "poi": it.purchase_order_item_id, "pid": it.product_id,
                   "wid": it.warehouse_id, "tid": tid})
            await db.execute(text("""
                UPDATE purchase_order_items
                SET    quantity_received = quantity_received + :qty,
                       last_updated_at   = NOW()
                WHERE  id = :id AND tenant_id = :tid
            """), {"qty": it.quantity_received, "id": it.purchase_order_item_id, "tid": tid})
            event_items.append({
                "product_id":   it.product_id,
                "warehouse_id": it.warehouse_id,
                "quantity":     str(it.quantity_received),
                "unit_cost":    str(it.unit_cost),
            })

        # Recalcula status da PO.
        agg = (await db.execute(text("""
            SELECT SUM(quantity_ordered)  AS ordered,
                   SUM(quantity_received) AS received
            FROM   purchase_order_items
            WHERE  purchase_order_id = :pid AND tenant_id = :tid AND active = TRUE
        """), {"pid": po_id, "tid": tid})).fetchone()
        new_status = "received" if agg.received >= agg.ordered else "partially_received"
        await db.execute(text("""
            UPDATE purchase_orders SET status = :st, last_updated_at = NOW()
            WHERE  id = :id AND tenant_id = :tid
        """), {"st": new_status, "id": po_id, "tid": tid})

        # CRÍTICO: emit_reliable na mesma transação. OutboxProcessor entrega ao Estoque.
        await EventBus.emit_reliable(
            evt.EVT_PURCHASE_RECEIVED,
            {
                "receipt_id":        receipt["id"],
                "purchase_order_id": po_id,
                "supplier_id":       po["supplier_id"],
                "items":             event_items,
            },
            db        = db,
            tenant_id = tid,
        )

        # Quando PO inteiramente recebida, gera evento financeiro de conta a pagar.
        if new_status == "received":
            payment_terms = po["payment_terms_days"] or 30
            await EventBus.emit_reliable(
                evt.EVT_PURCHASE_PAYABLE_DUE,
                {
                    "purchase_order_id": po_id,
                    "supplier_id":       po["supplier_id"],
                    "total_amount":      str(po["total_amount"]),
                    "payment_terms_days": payment_terms,
                },
                db        = db,
                tenant_id = tid,
            )

        await db.commit()
        return receipt
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc.orig))


@router.get("/receipts/{receipt_id}/items", response_model=list[PurchaseReceiptItemOut])
async def list_receipt_items(
    receipt_id: int,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    return await _fetch_all(db,
        """
        SELECT * FROM purchase_order_receipt_items
        WHERE  receipt_id = :rid AND tenant_id = :tid AND active = TRUE
        ORDER  BY id
        """,
        {"rid": receipt_id, "tid": user["tenant_id"]},
    )



# ── Quick Entry (atalho MEI: PO + Receipt em 1 transação) ────────────────────

def _normalize_document(raw: str) -> str:
    """Mantém apenas dígitos. Aceita 11 (CPF) ou 14 (CNPJ)."""
    return "".join(c for c in (raw or "") if c.isdigit())


async def _resolve_or_create_supplier(
    db: AsyncSession,
    tenant_id: int,
    supplier_id: Optional[int],
    document: Optional[str],
    name: Optional[str],
) -> int:
    """
    Resolve fornecedor para quick-entry. Ordem:
      1. supplier_id explícito → valida existência.
      2. supplier_document → busca; se ausente e setting permitir, cria stub.
    """
    if supplier_id:
        row = await _fetch_one(db,
            "SELECT id FROM suppliers WHERE id = :id AND tenant_id = :tid AND active = TRUE",
            {"id": supplier_id, "tid": tenant_id},
        )
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Fornecedor não encontrado.")
        return row["id"]

    if not document:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Informe supplier_id ou supplier_document.")
    doc = _normalize_document(document)
    if len(doc) not in (11, 14):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "supplier_document inválido (esperado 11 ou 14 dígitos).")

    existing = await _fetch_one(db,
        "SELECT id FROM suppliers WHERE document = :doc AND tenant_id = :tid",
        {"doc": doc, "tid": tenant_id},
    )
    if existing:
        return existing["id"]

    auto = await _get_setting(db, tenant_id, "purchase_auto_create_supplier_from_invoice")
    if (auto or "").strip().lower() != "true":
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "Fornecedor não cadastrado e auto-criação desabilitada.")

    stub_type = "pj" if len(doc) == 14 else "pf"
    stub_name = (name or f"Fornecedor {doc}").strip()[:200]
    created = await _fetch_one(db,
        """
        INSERT INTO suppliers (type, name, document, tenant_id)
        VALUES (:type, :name, :doc, :tid)
        RETURNING id
        """,
        {"type": stub_type, "name": stub_name, "doc": doc, "tid": tenant_id},
    )
    logger.info("quick-entry: supplier stub criado (id=%s, doc=%s, tenant=%s).",
                created["id"], doc, tenant_id)
    return created["id"]


async def _resolve_warehouse_id(db: AsyncSession, tenant_id: int,
                                explicit: Optional[int]) -> int:
    if explicit:
        row = await _fetch_one(db,
            "SELECT id FROM warehouses WHERE id = :id AND tenant_id = :tid AND active = TRUE",
            {"id": explicit, "tid": tenant_id},
        )
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Depósito não encontrado.")
        return row["id"]
    row = await _fetch_one(db,
        """
        SELECT id FROM warehouses
        WHERE  tenant_id = :tid AND active = TRUE AND is_default = TRUE
        LIMIT 1
        """,
        {"tid": tenant_id},
    )
    if not row:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Nenhum depósito padrão configurado. Informe warehouse_id.")
    return row["id"]


@router.post("/quick-entry", response_model=QuickEntryOut,
             status_code=status.HTTP_201_CREATED)
async def quick_entry(
    body: QuickEntryCreate,
    db:   AsyncSession = Depends(get_db_session),
    user: dict         = Depends(require_authentication),
):
    """
    Atalho MEI: cria fornecedor (se preciso) + PO 'approved' + Receipt total
    em uma única transação. Emite `purchase.received` e `purchase.payable_due`
    via emit_reliable; o subscriber do Estoque dá entrada nos saldos via Outbox.

    Regras:
    - PO nasce com status 'approved' (atalho assume aprovação implícita).
    - Recibo cobre integralmente as quantidades informadas.
    - Custo unitário do recibo = custo do item da PO (sem discrepância).
    """
    if not body.items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Quick-entry sem itens.")
    tid = user["tenant_id"]
    try:
        supplier_id  = await _resolve_or_create_supplier(
            db, tid, body.supplier_id, body.supplier_document, body.supplier_name)
        warehouse_id = await _resolve_warehouse_id(db, tid, body.warehouse_id)

        items_dump = [it.model_dump() for it in body.items]
        discount = Decimal(str(body.discount_amount or 0))
        shipping = Decimal(str(body.shipping_amount or 0))
        subtotal, total = _calc_po_totals(items_dump, discount, shipping)

        payment_terms = body.payment_terms_days
        if payment_terms is None:
            sup = await _fetch_one(db,
                "SELECT payment_terms_days FROM suppliers WHERE id = :id AND tenant_id = :tid",
                {"id": supplier_id, "tid": tid},
            )
            payment_terms = (sup or {}).get("payment_terms_days")
        if payment_terms is None:
            default_pt = await _get_setting(db, tid, "purchase_default_payment_terms_days")
            try:
                payment_terms = int(default_pt) if default_pt else 30
            except ValueError:
                payment_terms = 30

        po_number = await _next_po_number(db, tid)
        po = await _fetch_one(db,
            """
            INSERT INTO purchase_orders
                   (po_number, status, subtotal, discount_amount, shipping_amount,
                    total_amount, payment_terms_days, notes,
                    approved_at, approved_by,
                    supplier_id, warehouse_id, created_by, tenant_id)
            VALUES (:po_number, 'approved', :subtotal, :discount, :shipping,
                    :total, :pt, :notes,
                    NOW(), :uid,
                    :sid, :wid, :uid, :tid)
            RETURNING *
            """,
            {"po_number": po_number, "subtotal": subtotal, "discount": discount,
             "shipping": shipping, "total": total, "pt": payment_terms,
             "notes": body.notes, "sid": supplier_id, "wid": warehouse_id,
             "uid": user["id"], "tid": tid},
        )

        receipt = await _fetch_one(db,
            """
            INSERT INTO purchase_order_receipts
                   (received_at, invoice_number, invoice_date, notes,
                    purchase_order_id, received_by, tenant_id)
            VALUES (NOW(), :invn, :invd, :notes, :pid, :uid, :tid)
            RETURNING *
            """,
            {"invn": body.invoice_number, "invd": body.invoice_date,
             "notes": body.notes, "pid": po["id"], "uid": user["id"], "tid": tid},
        )

        event_items: list[dict] = []
        for it in items_dump:
            qty = Decimal(str(it["quantity"]))
            uc  = Decimal(str(it["unit_cost"]))
            line_total = (qty * uc) * (Decimal("1") - Decimal(str(it.get("discount_pct") or 0)) / Decimal("100"))
            poi = await _fetch_one(db,
                """
                INSERT INTO purchase_order_items
                       (quantity_ordered, quantity_received, unit_cost, discount_pct,
                        total_cost, purchase_order_id, product_id, warehouse_id, tenant_id)
                VALUES (:qty, :qty, :uc, :dp, :tc,
                        :po_id, :pid, :wid, :tid)
                RETURNING id
                """,
                {"qty": qty, "uc": uc,
                 "dp": it.get("discount_pct") or 0,
                 "tc": line_total.quantize(Decimal("0.01")),
                 "po_id": po["id"], "pid": it["product_id"],
                 "wid": warehouse_id, "tid": tid},
            )
            await db.execute(text("""
                INSERT INTO purchase_order_receipt_items
                       (quantity_received, unit_cost,
                        receipt_id, purchase_order_item_id, product_id, warehouse_id, tenant_id)
                VALUES (:qty, :uc, :rid, :poi, :pid, :wid, :tid)
            """), {"qty": qty, "uc": uc, "rid": receipt["id"],
                   "poi": poi["id"], "pid": it["product_id"],
                   "wid": warehouse_id, "tid": tid})
            event_items.append({
                "product_id":   it["product_id"],
                "warehouse_id": warehouse_id,
                "quantity":     str(qty),
                "unit_cost":    str(uc),
            })

        await db.execute(text("""
            UPDATE purchase_orders SET status = 'received', last_updated_at = NOW()
            WHERE  id = :id AND tenant_id = :tid
        """), {"id": po["id"], "tid": tid})

        await EventBus.emit_reliable(
            evt.EVT_PURCHASE_RECEIVED,
            {
                "receipt_id":        receipt["id"],
                "purchase_order_id": po["id"],
                "supplier_id":       supplier_id,
                "items":             event_items,
            },
            db        = db,
            tenant_id = tid,
        )
        await EventBus.emit_reliable(
            evt.EVT_PURCHASE_PAYABLE_DUE,
            {
                "purchase_order_id":  po["id"],
                "supplier_id":        supplier_id,
                "total_amount":       str(total),
                "payment_terms_days": payment_terms,
            },
            db        = db,
            tenant_id = tid,
        )

        await db.commit()
        await EventBus.emit(evt.EVT_PURCHASE_ORDER_APPROVED, {
            "purchase_order_id": po["id"],
            "supplier_id":       supplier_id,
            "total_amount":      str(total),
            "approved_by":       user["id"],
            "tenant_id":         tid,
            "auto_approved":     True,
            "via":               "quick_entry",
        })
        return {
            "purchase_order_id": po["id"],
            "receipt_id":        receipt["id"],
            "supplier_id":       supplier_id,
            "po_number":         po["po_number"],
            "total_amount":      total,
        }
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc.orig))
