"""
modules/compras/service.py
==========================
Service Interface pública do módulo Compras (read-only).

Único ponto de entrada cross-módulo:

    from app.modules.compras.service import ComprasService
    cost = await ComprasService.get_last_purchase_cost(db, product_id, tenant_id)

Regras (allowlist 11.4 do Modular Monolith):
- READ-ONLY. Nunca emite eventos. Nunca muta dados.
- tenant_id explícito em todas as chamadas.
- Retornos: dicts simples ou None.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class ComprasService:
    """Interface pública e read-only do módulo Compras."""

    # ── Suppliers ────────────────────────────────────────────────────────────

    @staticmethod
    async def get_supplier(
        db: AsyncSession, supplier_id: int, tenant_id: int,
    ) -> Optional[dict[str, Any]]:
        row = (await db.execute(
            text("""
                SELECT id, type, name, trade_name, document, email, phone,
                       payment_terms_days, discount_pct, default_warehouse_id,
                       active, tenant_id
                FROM   suppliers
                WHERE  id = :sid AND tenant_id = :tid
            """),
            {"sid": supplier_id, "tid": tenant_id},
        )).fetchone()
        return dict(row._mapping) if row else None

    @staticmethod
    async def get_supplier_payment_terms(
        db: AsyncSession, supplier_id: int, tenant_id: int,
    ) -> int:
        """Retorna prazo do fornecedor (ou setting default se ausente)."""
        sup = (await db.execute(
            text("SELECT payment_terms_days FROM suppliers WHERE id = :sid AND tenant_id = :tid"),
            {"sid": supplier_id, "tid": tenant_id},
        )).fetchone()
        if sup and sup.payment_terms_days:
            return int(sup.payment_terms_days)
        # Fallback: setting do tenant.
        s = (await db.execute(
            text("""
                SELECT setting_value FROM system_settings
                WHERE  tenant_id = :tid AND setting_key = 'purchase_default_payment_terms_days'
                  AND  active = TRUE
            """),
            {"tid": tenant_id},
        )).fetchone()
        try:
            return int(s.setting_value) if s and s.setting_value else 30
        except (ValueError, AttributeError):
            return 30

    # ── Purchase Orders ──────────────────────────────────────────────────────

    @staticmethod
    async def list_open_purchase_orders(
        db: AsyncSession, tenant_id: int, supplier_id: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """POs em status não-final (não recebidas e não canceladas)."""
        rows = (await db.execute(
            text("""
                SELECT id, po_number, status, total_amount, expected_delivery_date,
                       supplier_id, warehouse_id, tenant_id, created_at
                FROM   purchase_orders
                WHERE  tenant_id = :tid
                  AND  status   IN ('draft','pending_approval','approved','sent','partially_received')
                  AND  active    = TRUE
                  AND  (CAST(:sid AS INT) IS NULL OR supplier_id = CAST(:sid AS INT))
                ORDER  BY created_at DESC
            """),
            {"tid": tenant_id, "sid": supplier_id},
        )).fetchall()
        return [dict(r._mapping) for r in rows]

    @staticmethod
    async def get_last_purchase_cost(
        db: AsyncSession, product_id: int, tenant_id: int,
    ) -> Optional[dict[str, Any]]:
        """Retorna o último custo unitário recebido para um produto."""
        row = (await db.execute(
            text("""
                SELECT poi.unit_cost, po.supplier_id, por.received_at
                FROM   purchase_order_receipt_items pori
                JOIN   purchase_order_receipts      por ON por.id = pori.receipt_id
                JOIN   purchase_order_items         poi ON poi.id = pori.purchase_order_item_id
                JOIN   purchase_orders              po  ON po.id  = poi.purchase_order_id
                WHERE  pori.product_id = :pid AND pori.tenant_id = :tid
                ORDER  BY por.received_at DESC
                LIMIT  1
            """),
            {"pid": product_id, "tid": tenant_id},
        )).fetchone()
        return dict(row._mapping) if row else None

    # ── Receipts ─────────────────────────────────────────────────────────────

    @staticmethod
    async def list_pending_receipts(
        db: AsyncSession, tenant_id: int, warehouse_id: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """POs aguardando recebimento (sent ou partially_received)."""
        rows = (await db.execute(
            text("""
                SELECT id, po_number, status, supplier_id, warehouse_id,
                       expected_delivery_date, total_amount
                FROM   purchase_orders
                WHERE  tenant_id    = :tid
                  AND  status      IN ('sent','partially_received')
                  AND  active       = TRUE
                  AND  (CAST(:wid AS INT) IS NULL OR warehouse_id = CAST(:wid AS INT))
                ORDER  BY expected_delivery_date NULLS LAST, created_at
            """),
            {"tid": tenant_id, "wid": warehouse_id},
        )).fetchall()
        return [dict(r._mapping) for r in rows]
