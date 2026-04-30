"""
modules/cadastros/schemas.py
============================
Schemas Pydantic do módulo Cadastros.

Convenções:
- *Create  → payload de criação (sem id, sem timestamps).
- *Update  → payload de PATCH (todos opcionais — only-changed-fields).
- *Out     → resposta da API (id + campos públicos + timestamps).
- *Summary → projeção compacta para joins/listas.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Categorias ────────────────────────────────────────────────────────────────

class CategoryCreate(BaseModel):
    name:      str = Field(..., max_length=100)
    slug:      str = Field(..., max_length=120)
    icon:      Optional[str] = Field(None, max_length=50)
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    name:      Optional[str] = Field(None, max_length=100)
    slug:      Optional[str] = Field(None, max_length=120)
    icon:      Optional[str] = Field(None, max_length=50)
    parent_id: Optional[int] = None
    active:    Optional[bool] = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:               int
    name:             str
    slug:             str
    icon:             Optional[str]
    parent_id:        Optional[int]
    tenant_id:        int
    active:           bool
    created_at:       datetime
    last_updated_at:  datetime


# ── Tags ──────────────────────────────────────────────────────────────────────

class TagCreate(BaseModel):
    name: str = Field(..., max_length=100)
    slug: str = Field(..., max_length=120)


class TagUpdate(BaseModel):
    name:   Optional[str] = Field(None, max_length=100)
    slug:   Optional[str] = Field(None, max_length=120)
    active: Optional[bool] = None


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:               int
    name:             str
    slug:             str
    tenant_id:        int
    active:           bool
    created_at:       datetime
    last_updated_at:  datetime


# ── Famílias ──────────────────────────────────────────────────────────────────

class FamilyCreate(BaseModel):
    name:       str = Field(..., max_length=80)


class FamilyUpdate(BaseModel):
    name:       Optional[str] = Field(None, max_length=80)
    active:     Optional[bool] = None


class FamilyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:               int
    name:             str
    tenant_id:        int
    active:           bool
    created_at:       datetime
    last_updated_at:  datetime


# ── Características & Valores ────────────────────────────────────────────────

CharacteristicType = Literal["text", "color", "number"]


class CharacteristicCreate(BaseModel):
    name:       str = Field(..., max_length=50)
    type:       CharacteristicType = "text"


class CharacteristicUpdate(BaseModel):
    """`type` é imutável após criação (regra de negócio)."""
    name:       Optional[str] = Field(None, max_length=50)
    active:     Optional[bool] = None


class CharacteristicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:               int
    name:             str
    type:             str
    tenant_id:        int
    active:           bool
    created_at:       datetime
    last_updated_at:  datetime


class CharacteristicValueCreate(BaseModel):
    value:         str = Field(..., max_length=100)
    hex_color:     Optional[str] = Field(None, max_length=7)
    numeric_value: Optional[Decimal] = None
    unit:          Optional[str] = Field(None, max_length=20)


class CharacteristicValueUpdate(BaseModel):
    value:         Optional[str] = Field(None, max_length=100)
    hex_color:     Optional[str] = Field(None, max_length=7)
    numeric_value: Optional[Decimal] = None
    unit:          Optional[str] = Field(None, max_length=20)
    active:        Optional[bool] = None


class CharacteristicValueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    value:             str
    hex_color:         Optional[str]
    numeric_value:     Optional[Decimal]
    unit:              Optional[str]
    characteristic_id: int
    tenant_id:         int
    active:            bool
    created_at:        datetime
    last_updated_at:   datetime


# ── Produtos (modelo flat) ────────────────────────────────────────────────────

ProductType = Literal["simple", "kit"]


class ProductCreate(BaseModel):
    code:              str = Field(..., max_length=50)
    name:              str = Field(..., max_length=200)
    family_id:         Optional[int] = None
    barcode:           Optional[str] = Field(None, max_length=50)
    price:             Decimal = Field(default=Decimal("0"))
    cost:              Decimal = Field(default=Decimal("0"))
    unit:              str = Field("un", max_length=20)
    type:              ProductType = "simple"
    brand:             Optional[str] = Field(None, max_length=100)
    slug:              str = Field(..., max_length=250)
    description:       Optional[str] = None
    short_description: Optional[str] = None
    ncm:               Optional[str] = Field(None, max_length=10)
    weight_kg:         Optional[Decimal] = None
    height_cm:         Optional[Decimal] = None
    width_cm:          Optional[Decimal] = None
    depth_cm:          Optional[Decimal] = None
    meta_title:        Optional[str] = Field(None, max_length=200)
    meta_description:  Optional[str] = Field(None, max_length=500)
    category_id:       Optional[int] = None


class ProductUpdate(BaseModel):
    code:              Optional[str] = Field(None, max_length=50)
    name:              Optional[str] = Field(None, max_length=200)
    family_id:         Optional[int] = None
    barcode:           Optional[str] = Field(None, max_length=50)
    price:             Optional[Decimal] = None
    cost:              Optional[Decimal] = None
    unit:              Optional[str] = Field(None, max_length=20)
    type:              Optional[ProductType] = None
    brand:             Optional[str] = Field(None, max_length=100)
    slug:              Optional[str] = Field(None, max_length=250)
    description:       Optional[str] = None
    short_description: Optional[str] = None
    ncm:               Optional[str] = Field(None, max_length=10)
    weight_kg:         Optional[Decimal] = None
    height_cm:         Optional[Decimal] = None
    width_cm:          Optional[Decimal] = None
    depth_cm:          Optional[Decimal] = None
    meta_title:        Optional[str] = Field(None, max_length=200)
    meta_description:  Optional[str] = Field(None, max_length=500)
    category_id:       Optional[int] = None
    active:            Optional[bool] = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    code:              str
    name:              str
    family_id:         Optional[int]
    barcode:           Optional[str]
    price:             Decimal
    cost:              Decimal
    unit:              str
    type:              str
    brand:             Optional[str]
    slug:              str
    description:       Optional[str]
    short_description: Optional[str]
    ncm:               Optional[str]
    weight_kg:         Optional[Decimal]
    height_cm:         Optional[Decimal]
    width_cm:          Optional[Decimal]
    depth_cm:          Optional[Decimal]
    meta_title:        Optional[str]
    meta_description:  Optional[str]
    category_id:       Optional[int]
    tenant_id:         int
    active:            bool
    created_at:        datetime
    last_updated_at:   datetime


class ProductSummary(BaseModel):
    """Projeção compacta usada por outros módulos via Service Interface."""
    model_config = ConfigDict(from_attributes=True)
    id:        int
    code:      str
    name:      str
    family_id: Optional[int]
    slug:      str
    type:      str
    unit:      str
    price:     Decimal
    brand:     Optional[str]
    active:    bool
    tenant_id: int


# ── Bulk (wizard de combinatória) ─────────────────────────────────────────────

class ProductBulkCharacteristic(BaseModel):
    """Característica aplicada a um item do bulk (resolvida por id existente)."""
    characteristic_id: int
    value_id:          int


class ProductBulkItem(ProductCreate):
    """Item do bulk: produto + lista de characteristic links (opcional)."""
    characteristics: Optional[list[ProductBulkCharacteristic]] = None


class ProductBulkCreate(BaseModel):
    """Cria N produtos atomicamente (todos com o mesmo `family_id`)."""
    family_id: Optional[int] = None
    items:     list[ProductBulkItem]


# ── Characteristic Links (M:N produto ↔ valor) ────────────────────────────────

class CharacteristicLinkCreate(BaseModel):
    characteristic_id: int
    value_id:          int


class CharacteristicLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    product_id:        int
    characteristic_id: int
    value_id:          int
    tenant_id:         int
    active:            bool
    created_at:        datetime
    last_updated_at:   datetime


# ── Itens de Kit ──────────────────────────────────────────────────────────────

class KitItemCreate(BaseModel):
    component_id: int
    quantity:     Decimal = Field(default=Decimal("1"))


class KitItemUpdate(BaseModel):
    quantity: Optional[Decimal] = None
    active:   Optional[bool] = None


class KitItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    quantity:        Decimal
    kit_id:          int
    component_id:    int
    tenant_id:       int
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


# ── Imagens ───────────────────────────────────────────────────────────────────

class ProductImageCreate(BaseModel):
    """Registra uma imagem já enviada (upload binário vai por endpoint próprio)."""
    url:        str = Field(..., max_length=500)
    alt_text:   Optional[str] = Field(None, max_length=200)
    family_id:  Optional[int] = None
    sort_order: int = 0
    product_id: Optional[int] = None


class ProductImageUpdate(BaseModel):
    alt_text:   Optional[str] = Field(None, max_length=200)
    sort_order: Optional[int] = None
    active:     Optional[bool] = None


class ProductImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    url:             str
    alt_text:        Optional[str]
    family_id:       Optional[int]
    sort_order:      int
    product_id:      Optional[int]
    tenant_id:       int
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


# ── Tag Links ─────────────────────────────────────────────────────────────────

class TagLinkCreate(BaseModel):
    product_id: int
    tag_id:     int


class TagLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    product_id:      int
    tag_id:          int
    tenant_id:       int
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


# ── Tabelas de Preço ──────────────────────────────────────────────────────────

PriceTableType = Literal["fixed", "percentage_off"]


class PriceTableCreate(BaseModel):
    name:         str = Field(..., max_length=100)
    type:         PriceTableType = "fixed"
    discount_pct: Decimal = Field(default=Decimal("0"))
    is_default:   bool = False


class PriceTableUpdate(BaseModel):
    name:         Optional[str] = Field(None, max_length=100)
    type:         Optional[PriceTableType] = None
    discount_pct: Optional[Decimal] = None
    is_default:   Optional[bool] = None
    active:       Optional[bool] = None


class PriceTableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:               int
    name:             str
    type:             str
    discount_pct:     Decimal
    is_default:       bool
    tenant_id:        int
    active:           bool
    created_at:       datetime
    last_updated_at:  datetime


class PriceTableItemCreate(BaseModel):
    price:          Decimal
    price_table_id: int
    product_id:     int


class PriceTableItemUpdate(BaseModel):
    price:  Optional[Decimal] = None
    active: Optional[bool] = None


class PriceTableItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    price:           Decimal
    price_table_id:  int
    product_id:      int
    tenant_id:       int
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


# ── Promoções ─────────────────────────────────────────────────────────────────

PromotionType = Literal["pct_off", "fixed_off", "buy_x_get_y", "free_shipping"]
PromotionAppliesTo = Literal["all", "product", "category"]


class PromotionCreate(BaseModel):
    name:                str = Field(..., max_length=200)
    type:                PromotionType
    value:               Optional[Decimal] = None
    min_order_amount:    Optional[Decimal] = None
    min_quantity:        Optional[int] = None
    applies_to:          PromotionAppliesTo = "all"
    target_ids:          Optional[list[int]] = None
    coupon_code:         Optional[str] = Field(None, max_length=50)
    max_uses:            Optional[int] = None
    max_uses_per_client: int = 1
    stackable:           bool = False
    starts_at:           Optional[datetime] = None
    ends_at:             Optional[datetime] = None


class PromotionUpdate(BaseModel):
    name:                Optional[str] = Field(None, max_length=200)
    type:                Optional[PromotionType] = None
    value:               Optional[Decimal] = None
    min_order_amount:    Optional[Decimal] = None
    min_quantity:        Optional[int] = None
    applies_to:          Optional[PromotionAppliesTo] = None
    target_ids:          Optional[list[int]] = None
    coupon_code:         Optional[str] = Field(None, max_length=50)
    max_uses:            Optional[int] = None
    max_uses_per_client: Optional[int] = None
    stackable:           Optional[bool] = None
    starts_at:           Optional[datetime] = None
    ends_at:             Optional[datetime] = None
    active:              Optional[bool] = None


class PromotionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                   int
    name:                 str
    type:                 str
    value:                Optional[Decimal]
    min_order_amount:     Optional[Decimal]
    min_quantity:         Optional[int]
    applies_to:           str
    target_ids:           Optional[list[int]]
    coupon_code:          Optional[str]
    max_uses:             Optional[int]
    uses_count:           int
    max_uses_per_client:  int
    stackable:            bool
    starts_at:            Optional[datetime]
    ends_at:              Optional[datetime]
    tenant_id:            int
    active:               bool
    created_at:           datetime
    last_updated_at:      datetime


# ── Campanhas ─────────────────────────────────────────────────────────────────

CampaignType    = Literal["launch", "sale", "reactivation", "seasonal"]
CampaignChannel = Literal["whatsapp", "email", "marketplace", "store"]
CampaignStatus  = Literal["draft", "scheduled", "running", "done", "cancelled"]


class CampaignCreate(BaseModel):
    name:             str = Field(..., max_length=200)
    type:             CampaignType
    channel:          CampaignChannel
    status:           CampaignStatus = "draft"
    scheduled_at:     Optional[datetime] = None
    promotion_id:     Optional[int] = None
    segment_id:       Optional[int] = None
    created_by_agent: bool = False


class CampaignUpdate(BaseModel):
    name:              Optional[str] = Field(None, max_length=200)
    type:              Optional[CampaignType] = None
    channel:           Optional[CampaignChannel] = None
    status:            Optional[CampaignStatus] = None
    scheduled_at:      Optional[datetime] = None
    executed_at:       Optional[datetime] = None
    reach_count:       Optional[int] = None
    conversion_count:  Optional[int] = None
    revenue_generated: Optional[Decimal] = None
    promotion_id:      Optional[int] = None
    segment_id:        Optional[int] = None
    active:            Optional[bool] = None


class CampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    name:              str
    type:              str
    channel:           str
    status:            str
    scheduled_at:      Optional[datetime]
    executed_at:       Optional[datetime]
    reach_count:       int
    conversion_count:  int
    revenue_generated: Decimal
    created_by_agent:  bool
    promotion_id:      Optional[int]
    segment_id:        Optional[int]
    tenant_id:         int
    active:            bool
    created_at:        datetime
    last_updated_at:   datetime
