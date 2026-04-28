"""
modules/cadastros/events.py
===========================
Cadastros é módulo-fonte: emite eventos mas não consome eventos de outros módulos.

Catálogo de eventos emitidos (todos via EventBus.emit — best-effort, in-process)
-------------------------------------------------------------------------------
Constantes públicas para evitar string mágica nos handlers/router.

Outros módulos (estoque, vendas, ecommerce) podem subscrever-se a estes eventos
em seus respectivos events.py:

    from app.core.event_bus import EventBus
    from app.modules.cadastros.events import EVT_PRODUCT_CREATED

    async def on_product_created(payload: dict) -> None:
        ...

    EventBus.subscribe(EVT_PRODUCT_CREATED, on_product_created)
"""
import logging

logger = logging.getLogger(__name__)


# ── Eventos de Produto ────────────────────────────────────────────────────────
EVT_PRODUCT_CREATED          = "product.created"
EVT_PRODUCT_UPDATED          = "product.updated"
EVT_PRODUCT_DELETED          = "product.deleted"
EVT_PRODUCT_BULK_CREATED     = "product.bulk_created"

# ── Eventos de Promoção ───────────────────────────────────────────────────────
EVT_PROMOTION_CREATED        = "promotion.created"
EVT_PROMOTION_ACTIVATED      = "promotion.activated"
EVT_PROMOTION_DEACTIVATED    = "promotion.deactivated"

# ── Eventos de Campanha ───────────────────────────────────────────────────────
EVT_CAMPAIGN_CREATED         = "campaign.created"
EVT_CAMPAIGN_SCHEDULED       = "campaign.scheduled"


logger.debug(
    "modules/cadastros/events: %d eventos declarados (somente emissão).",
    10,
)
