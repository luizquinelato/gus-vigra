"""
modules/cadastros/__init__.py
=============================
Módulo Cadastros (Master Data) — produtos (modelo flat), categorias, tags,
características, kits, imagens, tabelas de preço, promoções e campanhas.

É a fonte de verdade alimentando Estoque, Vendas, E-Commerce e Marketplaces.

Eventos emitidos (best-effort via EventBus.emit):
- product.created            { product_id, tenant_id, name, type, family }
- product.updated            { product_id, tenant_id, fields_changed }
- product.deleted            { product_id, tenant_id }
- product.bulk_created       { tenant_id, family, product_ids }
- promotion.created          { promotion_id, tenant_id, type, coupon_code }
- promotion.activated        { promotion_id, tenant_id }
- promotion.deactivated      { promotion_id, tenant_id }
- campaign.created           { campaign_id, tenant_id, channel, type }
- campaign.scheduled         { campaign_id, tenant_id, scheduled_at }

Eventos consumidos: nenhum (Cadastros é fonte; não reage a outros módulos).

Service Interface pública (cross-módulo):
- CadastrosService.get_product_summary(db, product_id, tenant_id)
- CadastrosService.get_product_price(db, product_id, tenant_id, price_table_id=None)
- CadastrosService.list_active_promotions(db, tenant_id, when=None)
- CadastrosService.is_active_product(db, product_id, tenant_id)
"""
from app.modules import ModuleRegistry
from app.modules.cadastros import events  # noqa — registra/declara eventos no EventBus
from app.modules.cadastros.router import router

ModuleRegistry.register(
    name   = "cadastros",
    router = router,
    prefix = "/modules/cadastros",
)
