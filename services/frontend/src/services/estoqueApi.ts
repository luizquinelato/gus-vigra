/**
 * estoqueApi.ts
 * =============
 * Cliente tipado para o módulo Estoque (backend: app/modules/estoque).
 * Prefixo das rotas: /api/v1/modules/estoque (montado pelo ModuleRegistry).
 */
import apiClient from './apiClient'

const BASE = '/modules/estoque'

// ── Warehouses ────────────────────────────────────────────────────────────────

export type WarehouseType = 'physical' | 'virtual' | 'marketplace' | 'consignment'

export interface WarehouseRead {
  id: number; code: string; name: string; type: WarehouseType
  address_line: string | null; city: string | null; state: string | null; zip_code: string | null
  is_default: boolean; notes: string | null
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface WarehouseWrite {
  code: string; name: string; type?: WarehouseType
  address_line?: string | null; city?: string | null; state?: string | null; zip_code?: string | null
  is_default?: boolean; notes?: string | null
}

// ── Stock Balances ────────────────────────────────────────────────────────────

export interface StockBalanceRead {
  id: number; product_id: number; warehouse_id: number
  quantity: string; reserved_quantity: string; available: string
  avg_cost: string; min_quantity: string; max_quantity: string | null
  tenant_id: number; last_updated_at: string
}

export interface StockBalanceLimitsWrite {
  min_quantity?: string | null; max_quantity?: string | null
}

// ── Stock Movements ───────────────────────────────────────────────────────────

export type MovementType =
  | 'entry' | 'exit' | 'adjustment' | 'transfer_in' | 'transfer_out'
  | 'reservation' | 'release' | 'consumption' | 'return_in' | 'return_out'

export interface StockMovementRead {
  id: number; type: MovementType
  quantity: string; unit_cost: string
  reason: string | null; notes: string | null
  reference_type: string | null; reference_id: number | null
  outbox_event_id: number | null
  product_id: number; warehouse_id: number
  created_by: number | null; tenant_id: number
  created_at: string
}

export interface StockAdjustmentWrite {
  product_id: number; warehouse_id: number
  type: 'entry' | 'exit' | 'adjustment'
  quantity: string; unit_cost?: string
  reason?: string | null; notes?: string | null
}

export interface StockTransferWrite {
  product_id: number
  source_warehouse_id: number; target_warehouse_id: number
  quantity: string; notes?: string | null
}

// ── Reservations ──────────────────────────────────────────────────────────────

export type ReservationStatus = 'active' | 'consumed' | 'released' | 'expired'

export interface StockReservationRead {
  id: number; product_id: number; warehouse_id: number
  quantity: string; status: ReservationStatus
  expires_at: string | null; consumed_at: string | null; released_at: string | null
  reference_type: string | null; reference_id: number | null
  outbox_event_id: number | null; tenant_id: number
  created_at: string; last_updated_at: string
}
export interface StockReservationWrite {
  product_id: number; warehouse_id: number; quantity: string
  expires_at?: string | null
  reference_type?: string | null; reference_id?: number | null
}

// ── Inventory Counts ──────────────────────────────────────────────────────────

export type InventoryStatus = 'open' | 'counting' | 'closed' | 'cancelled'

export interface InventoryCountRead {
  id: number; code: string; description: string | null
  status: InventoryStatus
  opened_at: string; closed_at: string | null; cancelled_at: string | null
  warehouse_id: number; opened_by: number | null; closed_by: number | null
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface InventoryCountWrite {
  code: string; description?: string | null; warehouse_id: number
}
export interface InventoryCountUpdate {
  description?: string | null
  status?: InventoryStatus
}

export interface InventoryCountItemRead {
  id: number; inventory_count_id: number; product_id: number
  expected_quantity: string; counted_quantity: string | null
  adjustment_quantity: string | null; notes: string | null
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}

// ── API ──────────────────────────────────────────────────────────────────────

export const warehousesApi = {
  list: (params?: { only_active?: boolean }) =>
    apiClient.get<WarehouseRead[]>(`${BASE}/warehouses`, { params }).then(r => r.data),
  get: (id: number) => apiClient.get<WarehouseRead>(`${BASE}/warehouses/${id}`).then(r => r.data),
  create: (body: WarehouseWrite) =>
    apiClient.post<WarehouseRead>(`${BASE}/warehouses`, body).then(r => r.data),
  patch: (id: number, body: Partial<WarehouseWrite> & { active?: boolean }) =>
    apiClient.patch<WarehouseRead>(`${BASE}/warehouses/${id}`, body).then(r => r.data),
  softDelete: (id: number) =>
    apiClient.patch<WarehouseRead>(`${BASE}/warehouses/${id}`, { active: false }).then(r => r.data),
}

export const balancesApi = {
  list: (params?: { warehouse_id?: number; product_id?: number; below_min?: boolean; limit?: number; offset?: number }) =>
    apiClient.get<StockBalanceRead[]>(`${BASE}/balances`, { params }).then(r => r.data),
  get: (productId: number, params?: { warehouse_id?: number }) =>
    apiClient.get<StockBalanceRead>(`${BASE}/balances/${productId}`, { params }).then(r => r.data),
  patchLimits: (productId: number, warehouseId: number, body: StockBalanceLimitsWrite) =>
    apiClient.patch<StockBalanceRead>(`${BASE}/balances/${productId}/${warehouseId}`, body).then(r => r.data),
}

export const movementsApi = {
  list: (params?: { product_id?: number; warehouse_id?: number; type?: MovementType; limit?: number; offset?: number }) =>
    apiClient.get<StockMovementRead[]>(`${BASE}/movements`, { params }).then(r => r.data),
  createAdjustment: (body: StockAdjustmentWrite) =>
    apiClient.post<StockMovementRead>(`${BASE}/movements`, body).then(r => r.data),
  createTransfer: (body: StockTransferWrite) =>
    apiClient.post<{ source_movement_id: number; target_movement_id: number }>(`${BASE}/transfers`, body).then(r => r.data),
}

export const reservationsApi = {
  list: (params?: { status?: ReservationStatus; product_id?: number; warehouse_id?: number }) =>
    apiClient.get<StockReservationRead[]>(`${BASE}/reservations`, { params }).then(r => r.data),
  create: (body: StockReservationWrite) =>
    apiClient.post<StockReservationRead>(`${BASE}/reservations`, body).then(r => r.data),
  release: (id: number) =>
    apiClient.post<StockReservationRead>(`${BASE}/reservations/${id}/release`).then(r => r.data),
  consume: (id: number) =>
    apiClient.post<StockReservationRead>(`${BASE}/reservations/${id}/consume`).then(r => r.data),
}

export const inventoryCountsApi = {
  list: (params?: { status?: InventoryStatus; warehouse_id?: number }) =>
    apiClient.get<InventoryCountRead[]>(`${BASE}/inventory-counts`, { params }).then(r => r.data),
  get: (id: number) =>
    apiClient.get<InventoryCountRead>(`${BASE}/inventory-counts/${id}`).then(r => r.data),
  create: (body: InventoryCountWrite) =>
    apiClient.post<InventoryCountRead>(`${BASE}/inventory-counts`, body).then(r => r.data),
  patch: (id: number, body: InventoryCountUpdate) =>
    apiClient.patch<InventoryCountRead>(`${BASE}/inventory-counts/${id}`, body).then(r => r.data),
  listItems: (countId: number) =>
    apiClient.get<InventoryCountItemRead[]>(`${BASE}/inventory-counts/${countId}/items`).then(r => r.data),
  addItem: (countId: number, body: { product_id: number; notes?: string | null }) =>
    apiClient.post<InventoryCountItemRead>(`${BASE}/inventory-counts/${countId}/items`, body).then(r => r.data),
  patchItem: (itemId: number, body: { counted_quantity?: string | null; notes?: string | null }) =>
    apiClient.patch<InventoryCountItemRead>(`${BASE}/inventory-count-items/${itemId}`, body).then(r => r.data),
  close: (countId: number) =>
    apiClient.post<InventoryCountRead>(`${BASE}/inventory-counts/${countId}/close`).then(r => r.data),
}
