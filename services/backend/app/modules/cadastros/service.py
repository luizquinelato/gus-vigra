"""
modules/cadastros/service.py
============================
Service Interface pública do módulo Cadastros.

Este é o ÚNICO ponto de entrada permitido para outros módulos consultarem
dados do catálogo. Importação cross-módulo:

    from app.modules.cadastros.service import CadastrosService
    summary = await CadastrosService.get_product_summary(db, product_id, tenant_id)

Regras
------
- Todos os métodos são READ-ONLY (mutação fica no router, atrás de auth).
- Todos os métodos exigem tenant_id explícito (isolamento mandatório).
- Retornos são dicts simples ou None — sem ORM models, sem objetos pesados.
- Não emitir eventos aqui — emissão é responsabilidade do router (camada de transação).
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class CadastrosService:
    """Interface pública e read-only do catálogo (Cadastros)."""

    # ── Produtos ─────────────────────────────────────────────────────────────

    @staticmethod
    async def get_product_summary(
        db: AsyncSession, product_id: int, tenant_id: int
    ) -> Optional[dict[str, Any]]:
        """
        Retorna projeção compacta de um produto. Útil para outros módulos
        (Vendas, Estoque, E-Commerce) que precisam do nome/tipo/unidade/preço
        sem carregar a entidade completa.
        """
        result = await db.execute(
            text("""
                SELECT id, code, name, family_id, slug, type, unit, price,
                       brand, active, tenant_id
                FROM   products
                WHERE  id = :pid AND tenant_id = :tid AND active = TRUE
            """),
            {"pid": product_id, "tid": tenant_id},
        )
        row = result.fetchone()
        return dict(row._mapping) if row else None

    @staticmethod
    async def is_active_product(
        db: AsyncSession, product_id: int, tenant_id: int
    ) -> bool:
        """Confere existência + active=TRUE. Usado por validações de outros módulos."""
        result = await db.execute(
            text("""
                SELECT 1 FROM products
                WHERE id = :pid AND tenant_id = :tid AND active = TRUE
                LIMIT 1
            """),
            {"pid": product_id, "tid": tenant_id},
        )
        return result.fetchone() is not None

    # ── Preço efetivo ────────────────────────────────────────────────────────

    @staticmethod
    async def get_product_price(
        db: AsyncSession,
        product_id: int,
        tenant_id: int,
        price_table_id: Optional[int] = None,
    ) -> Optional[dict[str, Any]]:
        """
        Resolve o preço efetivo de um produto.

        Prioridade (ordem de fallback):
          1. price_table_items[price_table_id, product_id] — se tabela informada
             tipo='fixed' usa o `price` direto;
             tipo='percentage_off' aplica `discount_pct` sobre products.price.
          2. Tabela padrão do tenant (is_default=TRUE) com mesma regra.
          3. products.price.

        NÃO aplica promoções — promoções são resolvidas em runtime na Vendas
        a partir de list_active_promotions().

        Retorna { product_id, base_price, effective_price, source } ou None
        se o produto não existir.
        """
        result = await db.execute(
            text("""
                SELECT id, price, tenant_id
                FROM   products
                WHERE  id = :pid AND tenant_id = :tid AND active = TRUE
            """),
            {"pid": product_id, "tid": tenant_id},
        )
        prod = result.fetchone()
        if not prod:
            return None

        base = prod.price

        # Tenta a tabela explícita (se informada) ou a padrão do tenant.
        candidate = await db.execute(
            text("""
                SELECT pt.id, pt.type, pt.discount_pct, pti.price
                FROM   price_tables pt
                LEFT   JOIN price_table_items pti
                       ON pti.price_table_id = pt.id
                       AND pti.product_id    = :pid
                       AND pti.active        = TRUE
                WHERE  pt.tenant_id = :tid
                  AND  pt.active    = TRUE
                  AND  ( (:ptid IS NOT NULL AND pt.id = :ptid)
                         OR (:ptid IS NULL  AND pt.is_default = TRUE) )
                ORDER  BY (pt.id = :ptid) DESC, pt.is_default DESC
                LIMIT  1
            """),
            {"pid": product_id, "tid": tenant_id, "ptid": price_table_id},
        )
        row = candidate.fetchone()
        if row:
            if row.type == "fixed" and row.price is not None:
                return {"product_id": product_id, "base_price": base,
                        "effective_price": row.price, "source": f"price_table:{row.id}"}
            if row.type == "percentage_off":
                discount = (row.discount_pct or 0) / 100
                effective = base * (1 - discount)
                return {"product_id": product_id, "base_price": base,
                        "effective_price": effective, "source": f"price_table:{row.id}"}

        return {"product_id": product_id, "base_price": base,
                "effective_price": base, "source": "base_price"}

    # ── Promoções ────────────────────────────────────────────────────────────

    @staticmethod
    async def list_active_promotions(
        db: AsyncSession,
        tenant_id: int,
        when: Optional[datetime] = None,
    ) -> list[dict[str, Any]]:
        """
        Lista promoções ativas no instante `when` (default: NOW()).

        Critério de ativa: active=TRUE AND (starts_at IS NULL OR starts_at <= when)
                                       AND (ends_at   IS NULL OR ends_at   >  when).

        Útil para o módulo Vendas resolver descontos ao montar o carrinho.
        """
        result = await db.execute(
            text("""
                SELECT id, name, type, value, min_order_amount, min_quantity,
                       applies_to, target_ids, coupon_code, max_uses, uses_count,
                       max_uses_per_client, stackable, starts_at, ends_at, tenant_id
                FROM   promotions
                WHERE  tenant_id = :tid
                  AND  active    = TRUE
                  AND  (starts_at IS NULL OR starts_at <= COALESCE(:w, NOW()))
                  AND  (ends_at   IS NULL OR ends_at   >  COALESCE(:w, NOW()))
                ORDER  BY id DESC
            """),
            {"tid": tenant_id, "w": when},
        )
        return [dict(r._mapping) for r in result.fetchall()]

    @staticmethod
    async def get_promotion_by_coupon(
        db: AsyncSession, coupon_code: str, tenant_id: int
    ) -> Optional[dict[str, Any]]:
        """Busca uma promoção ativa por cupom (case-sensitive)."""
        result = await db.execute(
            text("""
                SELECT id, name, type, value, min_order_amount, min_quantity,
                       applies_to, target_ids, coupon_code, max_uses, uses_count,
                       max_uses_per_client, stackable, starts_at, ends_at, tenant_id
                FROM   promotions
                WHERE  tenant_id   = :tid
                  AND  coupon_code = :code
                  AND  active      = TRUE
                LIMIT  1
            """),
            {"tid": tenant_id, "code": coupon_code},
        )
        row = result.fetchone()
        return dict(row._mapping) if row else None
