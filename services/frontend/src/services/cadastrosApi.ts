/**
 * cadastrosApi.ts
 * ===============
 * Cliente tipado para o módulo Cadastros (backend: app/modules/cadastros).
 * Prefixo das rotas: /api/v1/modules/cadastros (montado pelo ModuleRegistry).
 */
import apiClient from './apiClient'

const BASE = '/modules/cadastros'

// ── Tipos compartilhados ─────────────────────────────────────────────────────

export interface CategoryRead {
  id: number; name: string; slug: string; icon: string | null
  parent_id: number | null; tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface CategoryWrite { name: string; slug: string; icon?: string | null; parent_id?: number | null }

export interface TagRead {
  id: number; name: string; slug: string; tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface TagWrite { name: string; slug: string }

// ── Famílias ─────────────────────────────────────────────────────────────────

// Valores guardados em FamilyRead.defaults — chaves são colunas de products
// gerenciadas em nível de família. Tipo amplo porque cada chave tem semântica
// distinta (string/number/decimal/category_id/html); a UI valida por chave.
export type FamilyDefaultValue = string | number | null
export type FamilyDefaults = Record<string, FamilyDefaultValue>

export interface FamilyRead {
  id: number; name: string
  defaults: FamilyDefaults
  characteristic_ids: number[]
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface FamilyWrite {
  name: string
  defaults?: FamilyDefaults
  characteristic_ids?: number[]
}

// Tipo lógico das colunas do allow-list (corresponde a FAMILY_MANAGED_FIELD_OPTIONS no backend).
export type FamilyManagedFieldType = 'string' | 'text' | 'html' | 'decimal' | 'category'
export interface FamilyManagedFieldOption {
  key:   string
  label: string
  type:  FamilyManagedFieldType
}

export interface FamilyApplyResult {
  family_id:      number
  products_count: number
  fields_applied: string[]
}

// ── Características & Valores ────────────────────────────────────────────────

export type CharacteristicType = 'text' | 'color' | 'number'

export interface CharacteristicRead {
  id: number; name: string; type: CharacteristicType
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface CharacteristicWrite {
  name: string; type?: CharacteristicType
}

export interface CharacteristicValueRead {
  id: number; value: string
  hex_color: string | null
  numeric_value: string | null
  unit: string | null
  characteristic_id: number
  tenant_id: number
  active: boolean; created_at: string; last_updated_at: string
}
export interface CharacteristicValueWrite {
  value: string
  hex_color?: string | null
  numeric_value?: string | null
  unit?: string | null
}

export type ProductType = 'simple' | 'kit'
export interface ProductRead {
  id: number; code: string; name: string
  family_id: number | null
  barcode: string | null
  price: string; cost: string
  unit: string; type: ProductType
  brand: string | null; slug: string
  description: string | null; short_description: string | null
  ncm: string | null
  weight_kg: string | null; height_cm: string | null; width_cm: string | null; depth_cm: string | null
  meta_title: string | null; meta_description: string | null
  category_id: number | null; tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface ProductWrite {
  code: string; name: string
  family_id?: number | null
  barcode?: string | null
  price?: string; cost?: string
  unit?: string; type?: ProductType
  brand?: string | null; slug: string
  description?: string | null; short_description?: string | null
  ncm?: string | null
  weight_kg?: string | null; height_cm?: string | null; width_cm?: string | null; depth_cm?: string | null
  meta_title?: string | null; meta_description?: string | null; category_id?: number | null
}

// ── Characteristic Links (M:N produto ↔ valor) ──────────────────────────────

export interface CharacteristicLinkRead {
  id: number; product_id: number
  characteristic_id: number; value_id: number
  tenant_id: number; active: boolean
  created_at: string; last_updated_at: string
}
export interface CharacteristicLinkWrite {
  characteristic_id: number; value_id: number
}

// ── Kit (composição quando type='kit') ───────────────────────────────────────

export interface KitItemRead {
  id: number; quantity: string
  kit_id: number; component_id: number
  tenant_id: number
  active: boolean; created_at: string; last_updated_at: string
}
export interface KitItemWrite { component_id: number; quantity?: string }

// ── Imagens ──────────────────────────────────────────────────────────────────

export interface ProductImageRead {
  id: number; url: string; alt_text: string | null
  family_id: number | null; sort_order: number
  product_id: number | null; tenant_id: number
  active: boolean; created_at: string; last_updated_at: string
}
export interface ProductImageWrite {
  url: string; alt_text?: string | null
  family_id?: number | null; sort_order?: number; product_id?: number | null
}

export type PriceTableType = 'fixed' | 'percentage_off'
export interface PriceTableRead {
  id: number; name: string; type: PriceTableType; discount_pct: string; is_default: boolean
  tenant_id: number; active: boolean; created_at: string; last_updated_at: string
}
export interface PriceTableWrite { name: string; type?: PriceTableType; discount_pct?: string; is_default?: boolean }

export interface PriceTableItemRead {
  id: number; price: string; price_table_id: number; product_id: number
  tenant_id: number
  active: boolean; created_at: string; last_updated_at: string
}
export interface PriceTableItemWrite {
  price: string; price_table_id: number; product_id: number
}

export type PromotionType = 'pct_off' | 'fixed_off' | 'buy_x_get_y' | 'free_shipping'
export type PromotionAppliesTo = 'all' | 'product' | 'category'
export interface PromotionRead {
  id: number; name: string; type: PromotionType; value: string | null
  min_order_amount: string | null; min_quantity: number | null
  applies_to: PromotionAppliesTo; target_ids: number[] | null
  coupon_code: string | null; max_uses: number | null; uses_count: number
  max_uses_per_client: number; stackable: boolean
  starts_at: string | null; ends_at: string | null
  tenant_id: number; active: boolean; created_at: string; last_updated_at: string
}
export interface PromotionWrite {
  name: string; type: PromotionType; value?: string | null
  min_order_amount?: string | null; min_quantity?: number | null
  applies_to?: PromotionAppliesTo; target_ids?: number[] | null
  coupon_code?: string | null; max_uses?: number | null
  max_uses_per_client?: number; stackable?: boolean
  starts_at?: string | null; ends_at?: string | null
}

export type CampaignType = 'launch' | 'sale' | 'reactivation' | 'seasonal'
export type CampaignChannel = 'whatsapp' | 'email' | 'marketplace' | 'store'
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'done' | 'cancelled'
export interface CampaignRead {
  id: number; name: string; type: CampaignType; channel: CampaignChannel; status: CampaignStatus
  scheduled_at: string | null; executed_at: string | null
  reach_count: number; conversion_count: number; revenue_generated: string
  created_by_agent: boolean; promotion_id: number | null; segment_id: number | null
  tenant_id: number; active: boolean; created_at: string; last_updated_at: string
}
export interface CampaignWrite {
  name: string; type: CampaignType; channel: CampaignChannel; status?: CampaignStatus
  scheduled_at?: string | null; promotion_id?: number | null; segment_id?: number | null
  created_by_agent?: boolean
}

// ── CRUD genérico tipado ─────────────────────────────────────────────────────

function makeCrud<R, W>(path: string) {
  return {
    list:   (params?: Record<string, unknown>) => apiClient.get<R[]>(`${BASE}${path}`, { params }).then(r => r.data),
    get:    (id: number) => apiClient.get<R>(`${BASE}${path}/${id}`).then(r => r.data),
    create: (body: W)   => apiClient.post<R>(`${BASE}${path}`, body).then(r => r.data),
    patch:  (id: number, body: Partial<W> & { active?: boolean }) =>
              apiClient.patch<R>(`${BASE}${path}/${id}`, body).then(r => r.data),
    softDelete: (id: number) => apiClient.patch<R>(`${BASE}${path}/${id}`, { active: false }).then(r => r.data),
  }
}

export const categoriesApi      = makeCrud<CategoryRead,       CategoryWrite      >('/categories')
export const tagsApi            = makeCrud<TagRead,            TagWrite           >('/tags')
// Famílias estendem o CRUD genérico com endpoints próprios:
// - applyDefaults: propaga os defaults a todos os produtos da família.
// - getManagedFieldOptions: lista o allow-list de campos configuráveis.
const familiesCrud = makeCrud<FamilyRead, FamilyWrite>('/product-families')
export const familiesApi = {
  ...familiesCrud,
  applyDefaults: (familyId: number) =>
    apiClient.post<FamilyApplyResult>(`${BASE}/product-families/${familyId}/apply-defaults`).then(r => r.data),
  getManagedFieldOptions: () =>
    apiClient.get<FamilyManagedFieldOption[]>(`${BASE}/product-families/managed-fields-options`).then(r => r.data),
}
export const characteristicsApi = makeCrud<CharacteristicRead, CharacteristicWrite>('/product-characteristics')
export const productsApi        = makeCrud<ProductRead,        ProductWrite       >('/products')
export const priceTablesApi     = makeCrud<PriceTableRead,     PriceTableWrite    >('/price-tables')
export const promotionsApi      = makeCrud<PromotionRead,      PromotionWrite     >('/promotions')
export const campaignsApi       = makeCrud<CampaignRead,       CampaignWrite      >('/campaigns')

// ── Valores de característica (aninhados em product-characteristics) ─────────

export const characteristicValuesApi = {
  listByCharacteristic: (characteristicId: number, params?: Record<string, unknown>) =>
    apiClient.get<CharacteristicValueRead[]>(
      `${BASE}/product-characteristics/${characteristicId}/values`, { params },
    ).then(r => r.data),
  create: (characteristicId: number, body: CharacteristicValueWrite) =>
    apiClient.post<CharacteristicValueRead>(
      `${BASE}/product-characteristics/${characteristicId}/values`, body,
    ).then(r => r.data),
  patch: (valueId: number, body: Partial<CharacteristicValueWrite> & { active?: boolean }) =>
    apiClient.patch<CharacteristicValueRead>(`${BASE}/characteristic-values/${valueId}`, body).then(r => r.data),
  softDelete: (valueId: number) =>
    apiClient.patch<CharacteristicValueRead>(`${BASE}/characteristic-values/${valueId}`, { active: false }).then(r => r.data),
}

// ── Bulk de produtos (wizard de combinatória) ────────────────────────────────

export interface ProductBulkCharacteristic {
  characteristic_id: number; value_id: number
}
export interface ProductBulkItem extends ProductWrite {
  characteristics?: ProductBulkCharacteristic[]
}

export const productsBulkApi = {
  create: (body: { family_id?: number | null; items: ProductBulkItem[] }) =>
    apiClient.post<ProductRead[]>(`${BASE}/products/bulk`, body).then(r => r.data),
}

// ── Links produto ↔ characteristic value ─────────────────────────────────────

export const productCharacteristicsApi = {
  list: (productId: number) =>
    apiClient.get<CharacteristicLinkRead[]>(
      `${BASE}/products/${productId}/characteristics`,
    ).then(r => r.data),
  replace: (productId: number, body: CharacteristicLinkWrite[]) =>
    apiClient.put<CharacteristicLinkRead[]>(
      `${BASE}/products/${productId}/characteristics`, body,
    ).then(r => r.data),
}

// ── Itens de Kit (composição quando type='kit') ──────────────────────────────

export const kitItemsApi = {
  listByKit: (kitId: number, params?: Record<string, unknown>) =>
    apiClient.get<KitItemRead[]>(`${BASE}/products/${kitId}/kit-items`, { params }).then(r => r.data),
  add: (kitId: number, body: KitItemWrite) =>
    apiClient.post<KitItemRead>(`${BASE}/products/${kitId}/kit-items`, body).then(r => r.data),
  patch: (itemId: number, body: { quantity?: string; active?: boolean }) =>
    apiClient.patch<KitItemRead>(`${BASE}/kit-items/${itemId}`, body).then(r => r.data),
  softDelete: (itemId: number) =>
    apiClient.patch<KitItemRead>(`${BASE}/kit-items/${itemId}`, { active: false }).then(r => r.data),
}

// ── Imagens de produto (upload binário + registro) ───────────────────────────

export const productImagesApi = {
  upload: (file: File): Promise<{ url: string }> => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post<{ url: string }>(`${BASE}/products/upload-image`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  listByProduct: (productId: number, params?: Record<string, unknown>) =>
    apiClient.get<ProductImageRead[]>(`${BASE}/products/${productId}/images`, { params }).then(r => r.data),
  listByFamily: (familyId: number, params?: Record<string, unknown>) =>
    apiClient.get<ProductImageRead[]>(`${BASE}/product-families/${familyId}/images`, { params }).then(r => r.data),
  listCovers: () =>
    apiClient.get<{ product_id: number; url: string }[]>(`${BASE}/products/covers`).then(r => r.data),
  attach: (productId: number, body: ProductImageWrite) =>
    apiClient.post<ProductImageRead>(`${BASE}/products/${productId}/images`, body).then(r => r.data),
  attachToFamily: (familyId: number, body: Omit<ProductImageWrite, 'family_id' | 'product_id'>) =>
    apiClient.post<ProductImageRead>(`${BASE}/product-families/${familyId}/images`, body).then(r => r.data),
  patch: (imageId: number, body: { alt_text?: string | null; sort_order?: number; active?: boolean }) =>
    apiClient.patch<ProductImageRead>(`${BASE}/images/${imageId}`, body).then(r => r.data),
  softDelete: (imageId: number) =>
    apiClient.patch<ProductImageRead>(`${BASE}/images/${imageId}`, { active: false }).then(r => r.data),
}

// ── Items de tabela de preço (aninhados em price-table) ──────────────────────

export const priceTableItemsApi = {
  listByTable: (tableId: number, params?: Record<string, unknown>) =>
    apiClient.get<PriceTableItemRead[]>(`${BASE}/price-tables/${tableId}/items`, { params }).then(r => r.data),
  create: (tableId: number, body: PriceTableItemWrite) =>
    apiClient.post<PriceTableItemRead>(`${BASE}/price-tables/${tableId}/items`, body).then(r => r.data),
  patch: (itemId: number, body: { price?: string; active?: boolean }) =>
    apiClient.patch<PriceTableItemRead>(`${BASE}/price-table-items/${itemId}`, body).then(r => r.data),
  softDelete: (itemId: number) =>
    apiClient.patch<PriceTableItemRead>(`${BASE}/price-table-items/${itemId}`, { active: false }).then(r => r.data),
}
