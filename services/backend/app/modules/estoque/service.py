"""
modules/estoque/service.py
==========================
Service Interface pública do módulo Estoque (read-only).

Único ponto de entrada permitido para outros módulos consultarem saldos,
disponibilidade e histórico de movimentos. Importação cross-módulo:

    from app.modules.estoque.service import EstoqueService
    saldo = await EstoqueService.get_available(db, product_id, tenant_id)

Regras (allowlist 11.4 do Modular Monolith):
- Todos os métodos são READ-ONLY (mutações ficam no router/handlers).
- tenant_id explícito em todas as chamadas (isolamento mandatório).
- Retornos: dicts simples, ints, Decimals — sem ORM models.
- Nunca emitir eventos aqui — eventos pertencem à camada de transação.

Para Vendas: confirmar disponibilidade antes de aceitar pedido.
Para Compras: consultar saldo atual antes de gerar sugestões de reposição.
Para Cadastros: somar saldo de componentes para resolver kits.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class EstoqueService:
    """Interface pública e read-only do Estoque."""

    # ── Saldo ────────────────────────────────────────────────────────────────

    @staticmethod
    async def get_balance(
        db: AsyncSession, product_id: int, tenant_id: int,
        warehouse_id: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """
        Retorna saldo de um produto. Se warehouse_id não informado, soma todos
        os depósitos do tenant; nesse caso `warehouse_id` no retorno é None.
        """
        if warehouse_id is not None:
            row = (await db.execute(
                text("""
                    SELECT product_id, warehouse_id, quantity, reserved_quantity,
                           (quantity - reserved_quantity) AS available,
                           avg_cost, min_quantity, max_quantity, tenant_id, last_updated_at
                    FROM   stock_balances
                    WHERE  product_id = :pid AND warehouse_id = :wid AND tenant_id = :tid
                """),
                {"pid": product_id, "wid": warehouse_id, "tid": tenant_id},
            )).fetchone()
            return dict(row._mapping) if row else None

        row = (await db.execute(
            text("""
                SELECT product_id,
                       NULL::int                               AS warehouse_id,
                       COALESCE(SUM(quantity), 0)              AS quantity,
                       COALESCE(SUM(reserved_quantity), 0)     AS reserved_quantity,
                       COALESCE(SUM(quantity - reserved_quantity), 0) AS available,
                       0                                       AS avg_cost,
                       0                                       AS min_quantity,
                       NULL::numeric                           AS max_quantity,
                       :tid                                    AS tenant_id,
                       MAX(last_updated_at)                    AS last_updated_at
                FROM   stock_balances
                WHERE  product_id = :pid AND tenant_id = :tid
                GROUP  BY product_id
            """),
            {"pid": product_id, "tid": tenant_id},
        )).fetchone()
        return dict(row._mapping) if row else None

    @staticmethod
    async def get_available(
        db: AsyncSession, product_id: int, tenant_id: int,
        warehouse_id: Optional[int] = None,
    ) -> Decimal:
        """Disponível = quantity - reserved_quantity. Retorna 0 se sem balance."""
        bal = await EstoqueService.get_balance(db, product_id, tenant_id, warehouse_id)
        if not bal:
            return Decimal("0")
        return Decimal(str(bal["available"] or 0))

    @staticmethod
    async def list_low_stock(
        db: AsyncSession, tenant_id: int, warehouse_id: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """Saldos abaixo do mínimo configurado. Útil para Compras (sugestão de reposição)."""
        params: dict[str, Any] = {"tid": tenant_id, "wid": warehouse_id}
        rows = (await db.execute(
            text("""
                SELECT product_id, warehouse_id, quantity, reserved_quantity,
                       avg_cost, min_quantity, max_quantity, last_updated_at
                FROM   stock_balances
                WHERE  tenant_id     = :tid
                  AND  min_quantity  > 0
                  AND  quantity     <= min_quantity
                  AND  (CAST(:wid AS INT) IS NULL OR warehouse_id = CAST(:wid AS INT))
                ORDER  BY (min_quantity - quantity) DESC
            """),
            params,
        )).fetchall()
        return [dict(r._mapping) for r in rows]

    # ── Histórico ────────────────────────────────────────────────────────────

    @staticmethod
    async def list_movements(
        db: AsyncSession, tenant_id: int, *,
        product_id: Optional[int] = None, warehouse_id: Optional[int] = None,
        limit: int = 50, offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Histórico de movimentos. Filtros opcionais por produto e/ou depósito."""
        rows = (await db.execute(
            text("""
                SELECT id, type, quantity, unit_cost, reason, notes, reference_type, reference_id,
                       outbox_event_id, product_id, warehouse_id, created_by, tenant_id, created_at
                FROM   stock_movements
                WHERE  tenant_id = :tid
                  AND  (CAST(:pid AS INT) IS NULL OR product_id   = CAST(:pid AS INT))
                  AND  (CAST(:wid AS INT) IS NULL OR warehouse_id = CAST(:wid AS INT))
                ORDER  BY created_at DESC, id DESC
                LIMIT  :lim OFFSET :off
            """),
            {"tid": tenant_id, "pid": product_id, "wid": warehouse_id,
             "lim": limit, "off": offset},
        )).fetchall()
        return [dict(r._mapping) for r in rows]

    # ── Default warehouse ────────────────────────────────────────────────────

    @staticmethod
    async def get_default_warehouse_id(db: AsyncSession, tenant_id: int) -> Optional[int]:
        """Retorna o warehouse default (setting > flag is_default)."""
        from app.modules.estoque.events import _get_default_warehouse_id
        return await _get_default_warehouse_id(db, tenant_id)
