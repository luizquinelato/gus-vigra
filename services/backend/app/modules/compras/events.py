"""
modules/compras/events.py
=========================
Constantes de eventos emitidos por Compras. Compras é módulo-fonte e
NÃO consome eventos de outros módulos — não há subscribers neste arquivo.

Outros módulos podem subscrever-se a estes eventos:

    from app.core.event_bus import EventBus
    from app.modules.compras.events import EVT_PURCHASE_RECEIVED

    async def on_purchase_received(payload: dict) -> None:
        ...

    EventBus.subscribe(EVT_PURCHASE_RECEIVED, on_purchase_received)

Distinção emit vs emit_reliable:
- Eventos "transacionais" (afetam estoque, financeiro): emit_reliable.
- Eventos informativos: emit.
"""
import logging

logger = logging.getLogger(__name__)


# ── Eventos transacionais (emit_reliable — Outbox) ────────────────────────────
EVT_PURCHASE_RECEIVED       = "purchase.received"
EVT_PURCHASE_RETURN_SENT    = "purchase.return_sent"
EVT_PURCHASE_PAYABLE_DUE    = "purchase.payable_due"

# ── Eventos informativos (emit best-effort) ───────────────────────────────────
EVT_PURCHASE_ORDER_APPROVED  = "purchase.order.approved"
EVT_PURCHASE_ORDER_CANCELLED = "purchase.order.cancelled"

logger.debug("modules/compras/events: 5 eventos declarados (somente emissão).")
