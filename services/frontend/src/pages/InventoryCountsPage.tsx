import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Eye, FloppyDisk, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  inventoryCountsApi, warehousesApi,
  type InventoryCountRead, type InventoryCountItemRead, type WarehouseRead, type InventoryStatus,
} from '../services/estoqueApi'
import { productsApi, type ProductRead } from '../services/cadastrosApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'
import { useConfirm } from '../contexts/ConfirmContext'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

const STATUS_LABEL: Record<InventoryStatus, string> = {
  open: 'Aberta', counting: 'Em contagem', closed: 'Fechada', cancelled: 'Cancelada',
}
const STATUS_COLOR: Record<InventoryStatus, string> = {
  open: 'var(--color-info)', counting: 'var(--color-warning)', closed: 'var(--color-success)', cancelled: '#9ca3af',
}

function fmt(n: string | null) {
  if (n === null || n === undefined) return '—'
  const v = Number(n); return Number.isNaN(v) ? n : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}
function fmtDt(s: string | null) { return s ? new Date(s).toLocaleString('pt-BR') : '—' }

function CreateModal({ warehouses, onClose, onSaved }: { warehouses: WarehouseRead[]; onClose: () => void; onSaved: () => void }) {
  const [code, setCode]                 = useState('')
  const [description, setDescription]   = useState('')
  const [warehouseId, setWarehouseId]   = useState<number | ''>(warehouses.find(w => w.is_default)?.id ?? '')
  const [saving, setSaving]             = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!code.trim() || !warehouseId) { toast.error('Código e depósito são obrigatórios.'); return }
    setSaving(true)
    try {
      await inventoryCountsApi.create({
        code: code.trim(), description: description.trim() || null,
        warehouse_id: Number(warehouseId),
      })
      toast.success('Inventário aberto.'); onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao abrir inventário.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-create)', color: 'var(--on-color-create)' }}>
              <Plus size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Abrir inventário</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Código<span className="text-red-500 ml-0.5">*</span></span>
            <input value={code} onChange={e => setCode(e.target.value)} className={`${fieldCls} mt-1`} maxLength={30} placeholder="ex: INV-2026-01" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Depósito<span className="text-red-500 ml-0.5">*</span></span>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Descrição</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className={`${fieldCls} mt-1 min-h-[60px]`} />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Abrir
          </button>
        </div>
      </div>
    </div>
  )
}

interface DetailModalProps {
  count: InventoryCountRead
  productById: Map<number, ProductRead>
  products: ProductRead[]
  onClose: () => void
  onChanged: () => void
}
function DetailModal({ count, productById, products, onClose, onChanged }: DetailModalProps) {
  const [items, setItems]       = useState<InventoryCountItemRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [drafts, setDrafts]     = useState<Record<number, string>>({})
  const [addProductId, setAdd]  = useState<number | ''>('')
  const confirm = useConfirm()
  const editable = count.status === 'open' || count.status === 'counting'

  function reload() {
    setLoading(true)
    inventoryCountsApi.listItems(count.id)
      .then(its => { setItems(its); setDrafts({}) })
      .catch(() => toast.error('Erro ao carregar itens.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [count.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const inItems = useMemo(() => new Set(items.map(i => i.product_id)), [items])
  const available = useMemo(() => products.filter(p => p.active && !inItems.has(p.id)), [products, inItems])

  async function handleAdd() {
    if (!addProductId) return
    try { await inventoryCountsApi.addItem(count.id, { product_id: Number(addProductId) }); setAdd(''); reload() }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao adicionar.')
    }
  }

  async function handleSaveItem(it: InventoryCountItemRead) {
    const v = drafts[it.id]; if (v === undefined) return
    try { await inventoryCountsApi.patchItem(it.id, { counted_quantity: v }); reload() }
    catch { toast.error('Erro ao salvar contagem.') }
  }

  async function handleClose() {
    const ok = await confirm({
      variant: 'warning',
      title: 'Fechar inventário?',
      message: <>Isto gera ajustes de estoque para itens contados (divergências entre esperado e contado). Operação irreversível.</>,
      confirmLabel: 'Fechar inventário',
    })
    if (!ok) return
    try { await inventoryCountsApi.close(count.id); toast.success('Inventário fechado e ajustes gerados.'); onChanged() }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao fechar.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{count.code}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{count.description ?? '—'} • Aberta em {fmtDt(count.opened_at)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded text-white" style={{ background: STATUS_COLOR[count.status] }}>{STATUS_LABEL[count.status]}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
          </div>
        </div>

        {editable && (
          <div className="flex items-end gap-2 mb-4">
            <label className="block flex-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Adicionar produto</span>
              <select value={addProductId} onChange={e => setAdd(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
                <option value="">Selecione…</option>
                {available.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </label>
            <button onClick={handleAdd} disabled={!addProductId} className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold border-none disabled:opacity-50"
              style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
              <Plus size={14} /> Incluir
            </button>
          </div>
        )}

        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : items.length === 0 ? <p className="text-sm text-gray-400">Nenhum item.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Esperado</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Contado</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Diferença</th>
              <th className="w-16" />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map(it => {
                const p = productById.get(it.product_id)
                const draft = drafts[it.id] ?? (it.counted_quantity ?? '')
                const diff = it.counted_quantity !== null ? Number(it.counted_quantity) - Number(it.expected_quantity) : null
                return (
                  <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="py-3 pl-3 text-gray-800 dark:text-gray-100 font-semibold">{p ? `${p.code} — ${p.name}` : `#${it.product_id}`}</td>
                    <td className="py-3 text-right font-mono text-gray-500 dark:text-gray-400">{fmt(it.expected_quantity)}</td>
                    <td className="py-3 text-right">
                      {editable ? (
                        <input type="number" step="0.0001" min="0" value={draft}
                          onChange={e => setDrafts(d => ({ ...d, [it.id]: e.target.value }))}
                          className={`${fieldCls} text-right max-w-[120px] inline-block py-1`} />
                      ) : <span className="font-mono">{fmt(it.counted_quantity)}</span>}
                    </td>
                    <td className="py-3 text-right font-mono">
                      {diff === null ? '—' : (
                        <span style={{ color: diff === 0 ? 'inherit' : diff > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {diff > 0 ? '+' : ''}{diff.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      {editable && drafts[it.id] !== undefined && (
                        <button onClick={() => handleSaveItem(it)} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Salvar">
                          <FloppyDisk size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {editable && (
          <div className="flex justify-end mt-6">
            <button onClick={handleClose}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
              style={{ background: 'var(--color-success)', color: 'var(--on-color-success)' }}>
              <CheckCircle size={15} /> Fechar inventário
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function InventoryCountsPage() {
  const [counts, setCounts]         = useState<InventoryCountRead[]>([])
  const [products, setProducts]     = useState<ProductRead[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRead[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('')
  const [statusFilter, setSF]       = useState<InventoryStatus | ''>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail]         = useState<InventoryCountRead | null>(null)

  function reload() {
    setLoading(true)
    Promise.all([
      inventoryCountsApi.list({ status: statusFilter || undefined }),
      productsApi.list({ only_active: false, limit: 500 }),
      warehousesApi.list({ only_active: false }),
    ])
      .then(([c, p, w]) => { setCounts(c); setProducts(p); setWarehouses(w) })
      .catch(() => toast.error('Erro ao carregar inventários.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const productById   = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])
  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return counts.filter(c => c.code.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))
  }, [counts, filter])

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Inventários</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Contagens físicas de estoque com geração de ajustes ao fechar.</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Novo inventário
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Status</span>
          <select value={statusFilter} onChange={e => setSF(e.target.value as InventoryStatus | '')} className={`${fieldCls} min-w-[160px]`}>
            <option value="">Todos</option>
            {(Object.keys(STATUS_LABEL) as InventoryStatus[]).map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
        </label>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? <p className="text-sm text-gray-400 p-6">Carregando...</p>
         : filtered.length === 0 ? <p className="text-sm text-gray-400 p-6">Nenhum inventário.</p>
         : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="w-1 p-0" aria-hidden />
                  <th className="px-3 py-3 w-12 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">#</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Código</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Depósito</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Aberta em</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Fechada em</th>
                  <th className="px-3 py-3 w-32 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-center">Status</th>
                  <th className="px-3 py-3 w-20 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((c, i) => (
                  <tr key={c.id}
                    className="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-[inset_4px_0_0_0_#d1d5db] dark:shadow-[inset_4px_0_0_0_#4b5563]"
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = 'inset 4px 0 0 0 var(--color-1)' }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                    <td className="w-1 p-0" aria-hidden />
                    <td className="px-3 py-3.5 text-left">
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i + 1}</span>
                    </td>
                    <td className="px-3 py-3.5 font-mono font-semibold text-gray-800 dark:text-gray-100">{c.code}</td>
                    <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400">{warehouseById.get(c.warehouse_id)?.name ?? `#${c.warehouse_id}`}</td>
                    <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400 text-[12px]">{fmtDt(c.opened_at)}</td>
                    <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400 text-[12px]">{fmtDt(c.closed_at)}</td>
                    <td className="px-3 py-3.5 text-center">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded text-white" style={{ background: STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status]}</span>
                    </td>
                    <td className="px-3 py-3.5">
                      <button onClick={() => setDetail(c)} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Abrir"><Eye size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {createOpen && <CreateModal warehouses={warehouses} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
      {detail     && <DetailModal count={detail} productById={productById} products={products} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); reload() }} />}
    </div>
  )
}
