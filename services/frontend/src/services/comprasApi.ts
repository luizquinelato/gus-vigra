/**
 * comprasApi.ts
 * =============
 * Cliente tipado para o módulo Compras (backend: app/modules/compras).
 * Prefixo das rotas: /api/v1/modules/compras (montado pelo ModuleRegistry).
 */
import apiClient from './apiClient'

const BASE = '/modules/compras'

// ── Suppliers ────────────────────────────────────────────────────────────────

export type SupplierType = 'pf' | 'pj'

export interface SupplierRead {
  id: number; type: SupplierType; name: string; trade_name: string | null
  document: string; email: string | null; phone: string | null
  payment_terms_days: number | null; discount_pct: string | null
  notes: string | null; default_warehouse_id: number | null
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface SupplierWrite {
  type?: SupplierType; name: string; trade_name?: string | null
  document: string; email?: string | null; phone?: string | null
  payment_terms_days?: number | null; discount_pct?: string | null
  notes?: string | null; default_warehouse_id?: number | null
}

export interface SupplierContactRead {
  id: number; supplier_id: number
  name: string | null; role: string | null
  email: string | null; phone: string | null; is_primary: boolean
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface SupplierContactWrite {
  name?: string | null; role?: string | null
  email?: string | null; phone?: string | null; is_primary?: boolean
}

// ── Quotations (RFQ) ─────────────────────────────────────────────────────────

export type QuotationStatus = 'open' | 'responded' | 'approved' | 'cancelled'

export interface QuotationRead {
  id: number; status: QuotationStatus
  notes: string | null; expires_at: string | null
  tenant_id: number; created_by: number | null; active: boolean
  created_at: string; last_updated_at: string
}
export interface QuotationItemWrite {
  product_id: number; requested_quantity: string; notes?: string | null
}
export interface QuotationWrite {
  notes?: string | null; expires_at?: string | null
  items?: QuotationItemWrite[]
}

export interface QuotationItemRead {
  id: number; quotation_id: number; product_id: number
  requested_quantity: string; notes: string | null; tenant_id: number
}

export interface QuotationResponseRead {
  id: number; quotation_id: number; supplier_id: number
  unit_price: string | null; delivery_days: number | null
  payment_terms: string | null; notes: string | null
  responded_at: string; tenant_id: number
}
export interface QuotationResponseWrite {
  supplier_id: number
  unit_price?: string | null; delivery_days?: number | null
  payment_terms?: string | null; notes?: string | null
}

// ── Purchase Orders ──────────────────────────────────────────────────────────

export type PurchaseOrderStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'sent'
  | 'partial_received' | 'received' | 'cancelled'

export interface PurchaseOrderItemWrite {
  product_id: number; quantity_ordered: string; unit_cost: string
  discount_pct?: string | null; warehouse_id?: number | null; notes?: string | null
}

export interface PurchaseOrderWrite {
  supplier_id: number; warehouse_id: number
  quotation_id?: number | null
  payment_terms_days?: number | null
  expected_delivery_date?: string | null
  discount_amount?: string | null; shipping_amount?: string | null
  notes?: string | null
  items: PurchaseOrderItemWrite[]
}
export interface PurchaseOrderUpdate {
  payment_terms_days?: number | null
  expected_delivery_date?: string | null
  discount_amount?: string | null; shipping_amount?: string | null
  notes?: string | null
}

export interface PurchaseOrderItemRead {
  id: number; purchase_order_id: number; product_id: number
  warehouse_id: number | null
  quantity_ordered: string; quantity_received: string
  unit_cost: string; discount_pct: string | null
  total_cost: string; notes: string | null
  tenant_id: number
}

export interface PurchaseOrderRead {
  id: number; po_number: string; status: PurchaseOrderStatus
  supplier_id: number; warehouse_id: number; quotation_id: number | null
  subtotal: string | null; discount_amount: string | null
  shipping_amount: string | null; total_amount: string | null
  payment_terms_days: number | null
  expected_delivery_date: string | null
  notes: string | null
  sent_at: string | null
  cancelled_at: string | null; cancellation_reason: string | null
  approved_at: string | null; approved_by: number | null
  created_by: number | null
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}

// ── Receipts ─────────────────────────────────────────────────────────────────

export interface PurchaseReceiptItemWrite {
  purchase_order_item_id: number; product_id: number; warehouse_id: number
  quantity_received: string; unit_cost: string
  discrepancy_notes?: string | null
}
export interface PurchaseReceiptWrite {
  invoice_number?: string | null; invoice_date?: string | null
  notes?: string | null
  items: PurchaseReceiptItemWrite[]
}

export interface PurchaseReceiptRead {
  id: number; purchase_order_id: number
  invoice_number: string | null; invoice_date: string | null
  received_at: string; received_by: number | null
  notes: string | null; tenant_id: number; created_at: string
}
export interface PurchaseReceiptItemRead {
  id: number; receipt_id: number; purchase_order_item_id: number
  product_id: number; warehouse_id: number
  quantity_received: string; unit_cost: string
  discrepancy_notes: string | null; tenant_id: number
}

// ── Quick Entry (MEI) ────────────────────────────────────────────────────────

export interface QuickEntryItem {
  product_id: number; quantity: string; unit_cost: string
  discount_pct?: string | null
}
export interface QuickEntryWrite {
  supplier_id?: number | null
  supplier_document?: string | null; supplier_name?: string | null
  warehouse_id?: number | null
  invoice_number?: string | null; invoice_date?: string | null
  payment_terms_days?: number | null
  notes?: string | null
  discount_amount?: string | null; shipping_amount?: string | null
  items: QuickEntryItem[]
}
export interface QuickEntryResult {
  purchase_order_id: number; receipt_id: number
  supplier_id: number; po_number: string; total_amount: string
}

// ── Supplier Ratings ─────────────────────────────────────────────────────────

export interface SupplierRatingRead {
  id: number; supplier_id: number; purchase_order_id: number | null
  delivery_rating: number | null; quality_rating: number | null; price_rating: number | null
  notes: string | null; rated_by: number | null; tenant_id: number; created_at: string
}
export interface SupplierRatingWrite {
  supplier_id: number; purchase_order_id?: number | null
  delivery_rating?: number | null; quality_rating?: number | null; price_rating?: number | null
  notes?: string | null
}

// ── API ──────────────────────────────────────────────────────────────────────

export const suppliersApi = {
  list: (params?: { only_active?: boolean }) =>
    apiClient.get<SupplierRead[]>(`${BASE}/suppliers`, { params }).then(r => r.data),
  get: (id: number) => apiClient.get<SupplierRead>(`${BASE}/suppliers/${id}`).then(r => r.data),
  create: (body: SupplierWrite) =>
    apiClient.post<SupplierRead>(`${BASE}/suppliers`, body).then(r => r.data),
  patch: (id: number, body: Partial<SupplierWrite> & { active?: boolean }) =>
    apiClient.patch<SupplierRead>(`${BASE}/suppliers/${id}`, body).then(r => r.data),
  softDelete: (id: number) =>
    apiClient.patch<SupplierRead>(`${BASE}/suppliers/${id}`, { active: false }).then(r => r.data),
  listContacts: (supplierId: number) =>
    apiClient.get<SupplierContactRead[]>(`${BASE}/suppliers/${supplierId}/contacts`).then(r => r.data),
  addContact: (supplierId: number, body: SupplierContactWrite) =>
    apiClient.post<SupplierContactRead>(`${BASE}/suppliers/${supplierId}/contacts`, body).then(r => r.data),
  patchContact: (contactId: number, body: Partial<SupplierContactWrite> & { active?: boolean }) =>
    apiClient.patch<SupplierContactRead>(`${BASE}/supplier-contacts/${contactId}`, body).then(r => r.data),
  listRatings: (supplierId: number) =>
    apiClient.get<SupplierRatingRead[]>(`${BASE}/suppliers/${supplierId}/ratings`).then(r => r.data),
  addRating: (supplierId: number, body: SupplierRatingWrite) =>
    apiClient.post<SupplierRatingRead>(`${BASE}/suppliers/${supplierId}/ratings`, body).then(r => r.data),
}

export const quotationsApi = {
  list: (params?: { status?: QuotationStatus }) =>
    apiClient.get<QuotationRead[]>(`${BASE}/quotations`, { params }).then(r => r.data),
  get: (id: number) => apiClient.get<QuotationRead>(`${BASE}/quotations/${id}`).then(r => r.data),
  create: (body: QuotationWrite) =>
    apiClient.post<QuotationRead>(`${BASE}/quotations`, body).then(r => r.data),
  listItems: (quotationId: number) =>
    apiClient.get<QuotationItemRead[]>(`${BASE}/quotations/${quotationId}/items`).then(r => r.data),
  listResponses: (quotationId: number) =>
    apiClient.get<QuotationResponseRead[]>(`${BASE}/quotations/${quotationId}/responses`).then(r => r.data),
  addResponse: (quotationId: number, body: QuotationResponseWrite) =>
    apiClient.post<QuotationResponseRead>(`${BASE}/quotations/${quotationId}/responses`, body).then(r => r.data),
}

export const purchaseOrdersApi = {
  list: (params?: { status?: PurchaseOrderStatus; supplier_id?: number; only_active?: boolean }) =>
    apiClient.get<PurchaseOrderRead[]>(`${BASE}/purchase-orders`, { params }).then(r => r.data),
  get: (id: number) => apiClient.get<PurchaseOrderRead>(`${BASE}/purchase-orders/${id}`).then(r => r.data),
  create: (body: PurchaseOrderWrite) =>
    apiClient.post<PurchaseOrderRead>(`${BASE}/purchase-orders`, body).then(r => r.data),
  patch: (id: number, body: PurchaseOrderUpdate) =>
    apiClient.patch<PurchaseOrderRead>(`${BASE}/purchase-orders/${id}`, body).then(r => r.data),
  listItems: (poId: number) =>
    apiClient.get<PurchaseOrderItemRead[]>(`${BASE}/purchase-orders/${poId}/items`).then(r => r.data),
  approve: (poId: number) =>
    apiClient.post<PurchaseOrderRead>(`${BASE}/purchase-orders/${poId}/approve`).then(r => r.data),
  send: (poId: number) =>
    apiClient.post<PurchaseOrderRead>(`${BASE}/purchase-orders/${poId}/send`).then(r => r.data),
  cancel: (poId: number, reason: string) =>
    apiClient.post<PurchaseOrderRead>(`${BASE}/purchase-orders/${poId}/cancel`, { reason }).then(r => r.data),
  listReceipts: (poId: number) =>
    apiClient.get<PurchaseReceiptRead[]>(`${BASE}/purchase-orders/${poId}/receipts`).then(r => r.data),
  createReceipt: (poId: number, body: PurchaseReceiptWrite) =>
    apiClient.post<PurchaseReceiptRead>(`${BASE}/purchase-orders/${poId}/receipts`, body).then(r => r.data),
  listReceiptItems: (receiptId: number) =>
    apiClient.get<PurchaseReceiptItemRead[]>(`${BASE}/receipts/${receiptId}/items`).then(r => r.data),
}

export const quickEntryApi = {
  create: (body: QuickEntryWrite) =>
    apiClient.post<QuickEntryResult>(`${BASE}/quick-entry`, body).then(r => r.data),
}
