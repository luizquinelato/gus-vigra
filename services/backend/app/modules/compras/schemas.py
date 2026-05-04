"""
modules/compras/schemas.py
==========================
Schemas Pydantic do módulo Compras.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Suppliers ─────────────────────────────────────────────────────────────────

class SupplierCreate(BaseModel):
    type:                 Literal["pf", "pj"] = "pj"
    name:                 str = Field(..., max_length=200)
    trade_name:           Optional[str] = Field(None, max_length=200)
    document:             str = Field(..., min_length=11, max_length=18)
    email:                Optional[str] = Field(None, max_length=200)
    phone:                Optional[str] = Field(None, max_length=20)
    payment_terms_days:   Optional[int] = Field(default=30, ge=0)
    discount_pct:         Optional[Decimal] = Field(default=Decimal("0"), ge=0, le=100)
    notes:                Optional[str] = None
    default_warehouse_id: Optional[int] = None


class SupplierUpdate(BaseModel):
    type:                 Optional[Literal["pf", "pj"]] = None
    name:                 Optional[str] = Field(None, max_length=200)
    trade_name:           Optional[str] = Field(None, max_length=200)
    document:             Optional[str] = Field(None, min_length=11, max_length=18)
    email:                Optional[str] = Field(None, max_length=200)
    phone:                Optional[str] = Field(None, max_length=20)
    payment_terms_days:   Optional[int] = Field(None, ge=0)
    discount_pct:         Optional[Decimal] = Field(None, ge=0, le=100)
    notes:                Optional[str] = None
    default_warehouse_id: Optional[int] = None
    active:               Optional[bool] = None


class SupplierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                   int
    type:                 str
    name:                 str
    trade_name:           Optional[str]
    document:             str
    email:                Optional[str]
    phone:                Optional[str]
    payment_terms_days:   Optional[int]
    discount_pct:         Optional[Decimal]
    notes:                Optional[str]
    default_warehouse_id: Optional[int]
    tenant_id:            int
    active:               bool
    created_at:           datetime
    last_updated_at:      datetime


class SupplierContactCreate(BaseModel):
    name:       Optional[str] = Field(None, max_length=100)
    role:       Optional[str] = Field(None, max_length=100)
    email:      Optional[str] = Field(None, max_length=200)
    phone:      Optional[str] = Field(None, max_length=20)
    is_primary: bool = False


class SupplierContactUpdate(BaseModel):
    name:       Optional[str] = Field(None, max_length=100)
    role:       Optional[str] = Field(None, max_length=100)
    email:      Optional[str] = Field(None, max_length=200)
    phone:      Optional[str] = Field(None, max_length=20)
    is_primary: Optional[bool] = None
    active:     Optional[bool] = None


class SupplierContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    supplier_id:     int
    name:            Optional[str]
    role:            Optional[str]
    email:           Optional[str]
    phone:           Optional[str]
    is_primary:      bool
    tenant_id:       int
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


# ── Quotations ────────────────────────────────────────────────────────────────

class QuotationItemCreate(BaseModel):
    product_id:         int
    requested_quantity: Decimal = Field(..., gt=0)
    notes:              Optional[str] = None


class QuotationCreate(BaseModel):
    notes:      Optional[str] = None
    expires_at: Optional[datetime] = None
    items:      list[QuotationItemCreate] = Field(default_factory=list)


class QuotationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    status:          str
    notes:           Optional[str]
    expires_at:      Optional[datetime]
    tenant_id:       int
    created_by:      Optional[int]
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


class QuotationItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                 int
    quotation_id:       int
    product_id:         int
    requested_quantity: Decimal
    notes:              Optional[str]
    tenant_id:          int


class QuotationResponseCreate(BaseModel):
    supplier_id:    int
    unit_price:     Optional[Decimal] = Field(None, ge=0)
    delivery_days:  Optional[int] = Field(None, ge=0)
    payment_terms:  Optional[str] = None
    notes:          Optional[str] = None


class QuotationResponseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:            int
    quotation_id:  int
    supplier_id:   int
    unit_price:    Optional[Decimal]
    delivery_days: Optional[int]
    payment_terms: Optional[str]
    notes:         Optional[str]
    responded_at:  datetime
    tenant_id:     int


# ── Purchase Orders ──────────────────────────────────────────────────────────

class PurchaseOrderItemCreate(BaseModel):
    product_id:       int
    quantity_ordered: Decimal = Field(..., gt=0)
    unit_cost:        Decimal = Field(..., ge=0)
    discount_pct:     Optional[Decimal] = Field(default=Decimal("0"), ge=0, le=100)
    warehouse_id:     Optional[int] = None
    notes:            Optional[str] = None


class PurchaseOrderCreate(BaseModel):
    supplier_id:            int
    warehouse_id:           int
    quotation_id:           Optional[int] = None
    payment_terms_days:     Optional[int] = Field(None, ge=0)
    expected_delivery_date: Optional[date] = None
    discount_amount:        Optional[Decimal] = Field(default=Decimal("0"), ge=0)
    shipping_amount:        Optional[Decimal] = Field(default=Decimal("0"), ge=0)
    notes:                  Optional[str] = None
    items:                  list[PurchaseOrderItemCreate] = Field(default_factory=list)


class PurchaseOrderUpdate(BaseModel):
    payment_terms_days:     Optional[int] = Field(None, ge=0)
    expected_delivery_date: Optional[date] = None
    discount_amount:        Optional[Decimal] = Field(None, ge=0)
    shipping_amount:        Optional[Decimal] = Field(None, ge=0)
    notes:                  Optional[str] = None


class PurchaseOrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                 int
    purchase_order_id:  int
    product_id:         int
    warehouse_id:       Optional[int]
    quantity_ordered:   Decimal
    quantity_received:  Decimal
    unit_cost:          Decimal
    discount_pct:       Optional[Decimal]
    total_cost:         Decimal
    notes:              Optional[str]
    tenant_id:          int


class PurchaseOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                     int
    po_number:              str
    status:                 str
    supplier_id:            int
    warehouse_id:           int
    quotation_id:           Optional[int]
    subtotal:               Optional[Decimal]
    discount_amount:        Optional[Decimal]
    shipping_amount:        Optional[Decimal]
    total_amount:           Optional[Decimal]
    payment_terms_days:     Optional[int]
    expected_delivery_date: Optional[date]
    notes:                  Optional[str]
    sent_at:                Optional[datetime]
    cancelled_at:           Optional[datetime]
    cancellation_reason:    Optional[str]
    approved_at:            Optional[datetime]
    approved_by:            Optional[int]
    created_by:             Optional[int]
    tenant_id:              int
    active:                 bool
    created_at:             datetime
    last_updated_at:        datetime


class PurchaseOrderCancel(BaseModel):
    reason: str = Field(..., min_length=3)


# ── Receipts ─────────────────────────────────────────────────────────────────

class PurchaseReceiptItemCreate(BaseModel):
    purchase_order_item_id: int
    product_id:             int
    warehouse_id:           int
    quantity_received:      Decimal = Field(..., gt=0)
    unit_cost:              Decimal = Field(..., ge=0)
    discrepancy_notes:      Optional[str] = None


class PurchaseReceiptCreate(BaseModel):
    invoice_number: Optional[str] = Field(None, max_length=50)
    invoice_date:   Optional[date] = None
    notes:          Optional[str] = None
    items:          list[PurchaseReceiptItemCreate] = Field(..., min_length=1)


class PurchaseReceiptItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                     int
    receipt_id:             int
    purchase_order_item_id: int
    product_id:             int
    warehouse_id:           int
    quantity_received:      Decimal
    unit_cost:              Decimal
    discrepancy_notes:      Optional[str]
    tenant_id:              int


class PurchaseReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    purchase_order_id: int
    invoice_number:    Optional[str]
    invoice_date:      Optional[date]
    received_at:       datetime
    received_by:       Optional[int]
    notes:             Optional[str]
    tenant_id:         int
    created_at:        datetime


# ── Supplier Ratings ─────────────────────────────────────────────────────────

class SupplierRatingCreate(BaseModel):
    supplier_id:       int
    purchase_order_id: Optional[int] = None
    delivery_rating:   Optional[int] = Field(None, ge=1, le=5)
    quality_rating:    Optional[int] = Field(None, ge=1, le=5)
    price_rating:      Optional[int] = Field(None, ge=1, le=5)
    notes:             Optional[str] = None


class SupplierRatingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    supplier_id:       int
    purchase_order_id: Optional[int]
    delivery_rating:   Optional[int]
    quality_rating:    Optional[int]
    price_rating:      Optional[int]
    notes:             Optional[str]
    rated_by:          Optional[int]
    tenant_id:         int
    created_at:        datetime


# ── Quick Entry (atalho MEI: PO + Receipt em 1 call) ────────────────────────

class QuickEntryItem(BaseModel):
    product_id:   int
    quantity:     Decimal = Field(..., gt=0)
    unit_cost:    Decimal = Field(..., ge=0)
    discount_pct: Optional[Decimal] = Field(default=Decimal("0"), ge=0, le=100)


class QuickEntryCreate(BaseModel):
    """
    Bundleia fornecedor + PO + recibo em 1 transação.
    Use `supplier_id` se já existe, ou `supplier_document` (CPF/CNPJ) com
    `supplier_name` para auto-criar fornecedor stub (depende do setting
    `purchase_auto_create_supplier_from_invoice`).
    """
    supplier_id:        Optional[int] = None
    supplier_document:  Optional[str] = Field(None, min_length=11, max_length=18)
    supplier_name:      Optional[str] = Field(None, max_length=200)
    warehouse_id:       Optional[int] = None
    invoice_number:     Optional[str] = Field(None, max_length=50)
    invoice_date:       Optional[date] = None
    payment_terms_days: Optional[int] = Field(None, ge=0)
    notes:              Optional[str] = None
    discount_amount:    Optional[Decimal] = Field(default=Decimal("0"), ge=0)
    shipping_amount:    Optional[Decimal] = Field(default=Decimal("0"), ge=0)
    items:              list[QuickEntryItem] = Field(..., min_length=1)


class QuickEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    purchase_order_id: int
    receipt_id:        int
    supplier_id:       int
    po_number:         str
    total_amount:      Decimal
