"""
modules/compras/__init__.py
==========================
Módulo Compras (Purchasing) — fornecedores, cotações (RFQ), pedidos de compra,
recebimento, avaliação e importação de NF-e.

Compras é módulo-fonte: emite eventos, não consome de outros módulos.

Eventos emitidos via emit_reliable (Outbox transacional):
- purchase.received           { receipt_id, purchase_order_id, supplier_id, items: [...], tenant_id }
- purchase.return_sent        { purchase_order_id, supplier_id, items: [...], tenant_id }
- purchase.payable_due        { purchase_order_id, supplier_id, total_amount, due_date, tenant_id }
- purchase.order.approved     { purchase_order_id, supplier_id, total_amount, approved_by, tenant_id }
- purchase.order.cancelled    { purchase_order_id, supplier_id, reason, tenant_id }
- purchase.nfe.imported       { nfe_import_id, purchase_order_id, supplier_id, total_amount, tenant_id }

Service Interface pública (cross-módulo, read-only):
- ComprasService.get_supplier(db, supplier_id, tenant_id)
- ComprasService.list_open_purchase_orders(db, tenant_id, supplier_id=None)
- ComprasService.get_last_purchase_cost(db, product_id, tenant_id)
- ComprasService.get_supplier_payment_terms(db, supplier_id, tenant_id)
- ComprasService.list_pending_receipts(db, tenant_id, warehouse_id=None)
"""
from app.modules import ModuleRegistry
from app.modules.compras import events  # noqa — declara constantes de eventos
from app.modules.compras.router import router

ModuleRegistry.register(
    name   = "compras",
    router = router,
    prefix = "/modules/compras",
)
