"""
modules/estoque/schemas.py
==========================
Schemas Pydantic do módulo Estoque.

Convenções:
- *Create  → payload de criação (sem id, sem timestamps).
- *Update  → payload de PATCH (todos opcionais).
- *Out     → resposta da API (id + campos públicos + timestamps).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Warehouses ────────────────────────────────────────────────────────────────

WAREHOUSE_TYPES = ("physical", "virtual", "marketplace", "consignment")


class WarehouseCreate(BaseModel):
    code:         str = Field(..., max_length=20)
    name:         str = Field(..., max_length=100)
    type:         Literal["physical", "virtual", "marketplace", "consignment"] = "physical"
    address_line: Optional[str] = Field(None, max_length=200)
    city:         Optional[str] = Field(None, max_length=100)
    state:        Optional[str] = Field(None, max_length=2)
    zip_code:     Optional[str] = Field(None, max_length=10)
    is_default:   bool = False
    notes:        Optional[str] = None


class WarehouseUpdate(BaseModel):
    code:         Optional[str] = Field(None, max_length=20)
    name:         Optional[str] = Field(None, max_length=100)
    type:         Optional[Literal["physical", "virtual", "marketplace", "consignment"]] = None
    address_line: Optional[str] = Field(None, max_length=200)
    city:         Optional[str] = Field(None, max_length=100)
    state:        Optional[str] = Field(None, max_length=2)
    zip_code:     Optional[str] = Field(None, max_length=10)
    is_default:   Optional[bool] = None
    notes:        Optional[str] = None
    active:       Optional[bool] = None


class WarehouseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    code:            str
    name:            str
    type:            str
    address_line:    Optional[str]
    city:            Optional[str]
    state:           Optional[str]
    zip_code:        Optional[str]
    is_default:      bool
    notes:           Optional[str]
    tenant_id:       int
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


# ── Stock Balances ────────────────────────────────────────────────────────────

class StockBalanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                int
    product_id:        int
    warehouse_id:      int
    quantity:          Decimal
    reserved_quantity: Decimal
    available:         Decimal  # quantity - reserved_quantity (calculado)
    avg_cost:          Decimal
    min_quantity:      Decimal
    max_quantity:      Optional[Decimal]
    tenant_id:         int
    last_updated_at:   datetime


class StockBalanceLimitsUpdate(BaseModel):
    min_quantity: Optional[Decimal] = Field(None, ge=0)
    max_quantity: Optional[Decimal] = Field(None, ge=0)


# ── Stock Movements ───────────────────────────────────────────────────────────

MOVEMENT_TYPES = (
    "entry", "exit", "adjustment", "transfer_in", "transfer_out",
    "reservation", "release", "consumption", "return_in", "return_out",
)


class StockAdjustmentCreate(BaseModel):
    """Ajuste manual de estoque (registra movimento + atualiza saldo)."""
    product_id:   int
    warehouse_id: int
    type:         Literal["entry", "exit", "adjustment"]
    quantity:     Decimal = Field(..., gt=0)
    unit_cost:    Decimal = Field(default=Decimal("0"), ge=0)
    reason:       Optional[str] = Field(None, max_length=50)
    notes:        Optional[str] = None


class StockTransferCreate(BaseModel):
    """Transferência entre depósitos — gera par transfer_out/transfer_in."""
    product_id:           int
    source_warehouse_id:  int
    target_warehouse_id:  int
    quantity:             Decimal = Field(..., gt=0)
    notes:                Optional[str] = None


class StockMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    type:            str
    quantity:        Decimal
    unit_cost:       Decimal
    reason:          Optional[str]
    notes:           Optional[str]
    reference_type:  Optional[str]
    reference_id:    Optional[int]
    outbox_event_id: Optional[int]
    product_id:      int
    warehouse_id:    int
    created_by:      Optional[int]
    tenant_id:       int
    created_at:      datetime


# ── Stock Lots (FIFO) ─────────────────────────────────────────────────────────

class StockLotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                 int
    lot_code:           Optional[str]
    quantity:           Decimal
    remaining_quantity: Decimal
    unit_cost:          Decimal
    entry_date:         datetime
    expiration_date:    Optional[date]
    product_id:         int
    warehouse_id:       int
    source_movement_id: Optional[int]
    tenant_id:          int
    active:             bool


# ── Stock Reservations ────────────────────────────────────────────────────────

RESERVATION_STATUSES = ("active", "consumed", "released", "expired")


class StockReservationCreate(BaseModel):
    product_id:     int
    warehouse_id:   int
    quantity:       Decimal = Field(..., gt=0)
    expires_at:     Optional[datetime] = None
    reference_type: Optional[str] = Field(None, max_length=40)
    reference_id:   Optional[int] = None


class StockReservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    product_id:      int
    warehouse_id:    int
    quantity:        Decimal
    status:          str
    expires_at:      Optional[datetime]
    consumed_at:     Optional[datetime]
    released_at:     Optional[datetime]
    reference_type:  Optional[str]
    reference_id:    Optional[int]
    outbox_event_id: Optional[int]
    tenant_id:       int
    created_at:      datetime
    last_updated_at: datetime


# ── Inventory Counts ──────────────────────────────────────────────────────────

INVENTORY_STATUSES = ("open", "counting", "closed", "cancelled")


class InventoryCountCreate(BaseModel):
    code:         str = Field(..., max_length=30)
    description:  Optional[str] = None
    warehouse_id: int


class InventoryCountUpdate(BaseModel):
    description: Optional[str] = None
    status:      Optional[Literal["open", "counting", "closed", "cancelled"]] = None


class InventoryCountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:              int
    code:            str
    description:     Optional[str]
    status:          str
    opened_at:       datetime
    closed_at:       Optional[datetime]
    cancelled_at:    Optional[datetime]
    warehouse_id:    int
    opened_by:       Optional[int]
    closed_by:       Optional[int]
    tenant_id:       int
    active:          bool
    created_at:      datetime
    last_updated_at: datetime


class InventoryCountItemCreate(BaseModel):
    product_id: int
    notes:      Optional[str] = None


class InventoryCountItemUpdate(BaseModel):
    counted_quantity: Optional[Decimal] = Field(None, ge=0)
    notes:            Optional[str] = None


class InventoryCountItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id:                  int
    inventory_count_id:  int
    product_id:          int
    expected_quantity:   Decimal
    counted_quantity:    Optional[Decimal]
    adjustment_quantity: Optional[Decimal]
    notes:               Optional[str]
    tenant_id:           int
    active:              bool
    created_at:          datetime
    last_updated_at:     datetime
