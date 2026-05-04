"""
modules/estoque/__init__.py
==========================
Módulo Estoque (Inventory) — saldos, movimentos, lotes, reservas, contagem.

Modelo flat: saldo por (product_id, warehouse_id). Não há variação de produto.
Saldos são criados lazy (UPSERT) no primeiro movimento.

Eventos emitidos (best-effort via EventBus.emit):
- stock.movement.created      { movement_id, product_id, warehouse_id, type, quantity, tenant_id }
- stock.balance.updated       { product_id, warehouse_id, quantity, available, tenant_id }
- stock.low                   { product_id, warehouse_id, quantity, min_quantity, tenant_id }
- stock.reservation.created   { reservation_id, product_id, quantity, tenant_id }
- stock.reservation.released  { reservation_id, tenant_id }
- stock.inventory.closed      { inventory_count_id, total_adjustments, tenant_id }

Eventos consumidos:
- product.created             (Cadastros, emit)         — log informativo (no-op).
- product.deleted             (Cadastros, emit)         — log informativo (cascade no DB).
- purchase.received           (Compras, emit_reliable)  — entrada + recálculo avg_cost.
- purchase.return_sent        (Compras, emit_reliable)  — saída por devolução.

Idempotência: subscribers de emit_reliable usam outbox_event_id como chave em
stock_movements (UNIQUE composto com reference_type/reference_id).

Service Interface pública (cross-módulo, read-only):
- EstoqueService.get_balance(db, product_id, tenant_id, warehouse_id=None)
- EstoqueService.get_available(db, product_id, tenant_id, warehouse_id=None)
- EstoqueService.list_low_stock(db, tenant_id, warehouse_id=None)
- EstoqueService.list_movements(db, tenant_id, ...)
- EstoqueService.get_default_warehouse_id(db, tenant_id)
"""
from app.modules import ModuleRegistry
from app.modules.estoque import events  # noqa — registra subscribers no EventBus
from app.modules.estoque.router import router

ModuleRegistry.register(
    name   = "estoque",
    router = router,
    prefix = "/modules/estoque",
)
