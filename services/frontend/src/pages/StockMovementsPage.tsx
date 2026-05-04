import { useEffect, useMemo, useState } from 'react'
import { ArrowsLeftRight, FloppyDisk, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  movementsApi, warehousesApi,
  type StockMovementRead, type WarehouseRead, type MovementType,
} from '../services/estoqueApi'
import { productsApi, type ProductRead } from '../services/cadastrosApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

const TYPE_LABEL: Record<MovementType, string> = {
  entry: 'Entrada', exit: 'Saída', adjustment: 'Ajuste',
  transfer_in: 'Transf. entrada', transfer_out: 'Transf. saída',
  reservation: 'Reserva', release: 'Liberação', consumption: 'Consumo',
  return_in: 'Devolução entrada', return_out: 'Devolução saída',
}
const TYPE_COLOR: Record<MovementType, string> = {
  entry: 'var(--color-success)', exit: 'var(--color-danger)', adjustment: 'var(--color-warning)',
  transfer_in: 'var(--color-info)', transfer_out: 'var(--color-info)',
  reservation: '#9ca3af', release: '#9ca3af', consumption: 'var(--color-danger)',
  return_in: 'var(--color-success)', return_out: 'var(--color-warning)',
}

function fmt(n: string) {
  const v = Number(n)
  return Number.isNaN(v) ? n : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}
function fmtDt(s: string) { return new Date(s).toLocaleString('pt-BR') }

interface AdjustmentModalProps {
  products: ProductRead[]
  warehouses: WarehouseRead[]
  onClose: () => void
  onSaved: () => void
}
function AdjustmentModal({ products, warehouses, onClose, onSaved }: AdjustmentModalProps) {
  const [productId, setProductId]     = useState<number | ''>('')
  const [warehouseId, setWarehouseId] = useState<number | ''>(warehouses.find(w => w.is_default)?.id ?? '')
  const [type, setType]               = useState<'entry' | 'exit' | 'adjustment'>('entry')
  const [quantity, setQuantity]       = useState('')
  const [unitCost, setUnitCost]       = useState('0')
  const [reason, setReason]           = useState('')
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!productId || !warehouseId) { toast.error('Produto e depósito são obrigatórios.'); return }
    if (!quantity || Number(quantity) <= 0) { toast.error('Quantidade deve ser maior que zero.'); return }
    setSaving(true)
    try {
      await movementsApi.createAdjustment({
        product_id: Number(productId),
        warehouse_id: Number(warehouseId),
        type, quantity, unit_cost: unitCost || '0',
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      })
      toast.success('Movimento registrado.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao registrar movimento.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-create)', color: 'var(--on-color-create)' }}>
              <Plus size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Novo movimento</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Produto<span className="text-red-500 ml-0.5">*</span></span>
            <select value={productId} onChange={e => setProductId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Depósito<span className="text-red-500 ml-0.5">*</span></span>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo<span className="text-red-500 ml-0.5">*</span></span>
            <select value={type} onChange={e => setType(e.target.value as 'entry' | 'exit' | 'adjustment')} className={`${fieldCls} mt-1`}>
              <option value="entry">Entrada</option>
              <option value="exit">Saída</option>
              <option value="adjustment">Ajuste</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Quantidade<span className="text-red-500 ml-0.5">*</span></span>
            <input type="number" step="0.0001" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Custo unitário</span>
            <input type="number" step="0.01" min="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} className={`${fieldCls} mt-1`} />
            <span className="text-[11px] text-gray-400 mt-1 block">Ignorado para ajustes (mantém custo médio).</span>
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Motivo</span>
            <input value={reason} onChange={e => setReason(e.target.value)} className={`${fieldCls} mt-1`} maxLength={50} placeholder="ex: contagem, perda, doação" />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Observações</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className={`${fieldCls} mt-1 min-h-[60px]`} />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Registrar
          </button>
        </div>
      </div>
    </div>
  )
}

interface TransferModalProps {
  products: ProductRead[]
  warehouses: WarehouseRead[]
  onClose: () => void
  onSaved: () => void
}
function TransferModal({ products, warehouses, onClose, onSaved }: TransferModalProps) {
  const [productId, setProductId]   = useState<number | ''>('')
  const [sourceId, setSourceId]     = useState<number | ''>('')
  const [targetId, setTargetId]     = useState<number | ''>('')
  const [quantity, setQuantity]     = useState('')
  const [notes, setNotes]           = useState('')
  const [saving, setSaving]         = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!productId || !sourceId || !targetId) { toast.error('Produto e depósitos são obrigatórios.'); return }
    if (sourceId === targetId) { toast.error('Origem e destino devem ser diferentes.'); return }
    if (!quantity || Number(quantity) <= 0) { toast.error('Quantidade deve ser maior que zero.'); return }
    setSaving(true)
    try {
      await movementsApi.createTransfer({
        product_id: Number(productId),
        source_warehouse_id: Number(sourceId),
        target_warehouse_id: Number(targetId),
        quantity, notes: notes.trim() || null,
      })
      toast.success('Transferência registrada.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao transferir.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-info)', color: 'var(--on-color-info)' }}>
              <ArrowsLeftRight size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Transferência entre depósitos</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Produto<span className="text-red-500 ml-0.5">*</span></span>
            <select value={productId} onChange={e => setProductId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">De<span className="text-red-500 ml-0.5">*</span></span>
            <select value={sourceId} onChange={e => setSourceId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Para<span className="text-red-500 ml-0.5">*</span></span>
            <select value={targetId} onChange={e => setTargetId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Quantidade<span className="text-red-500 ml-0.5">*</span></span>
            <input type="number" step="0.0001" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Observações</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className={`${fieldCls} mt-1 min-h-[60px]`} />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Transferir
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StockMovementsPage() {
  const [movements, setMovements]   = useState<StockMovementRead[]>([])
  const [products, setProducts]     = useState<ProductRead[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRead[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('')
  const [whFilter, setWhFilter]     = useState<number | ''>('')
  const [typeFilter, setTypeFilter] = useState<MovementType | ''>('')
  const [adjOpen, setAdjOpen]       = useState(false)
  const [transfOpen, setTransfOpen] = useState(false)

  function reload() {
    setLoading(true)
    Promise.all([
      movementsApi.list({
        warehouse_id: whFilter || undefined,
        type: typeFilter || undefined,
        limit: 200,
      }),
      productsApi.list({ only_active: false, limit: 500 }),
      warehousesApi.list({ only_active: false }),
    ])
      .then(([m, p, w]) => { setMovements(m); setProducts(p); setWarehouses(w) })
      .catch(() => toast.error('Erro ao carregar movimentos.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [whFilter, typeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const productById   = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    if (!q) return movements
    return movements.filter(m => {
      const p = productById.get(m.product_id)
      return p && (p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    })
  }, [movements, productById, filter])

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Movimentações de Estoque</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Histórico de entradas, saídas, ajustes e transferências.</p>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={() => setTransfOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 hover:border-[var(--color-1)]">
          <ArrowsLeftRight size={15} /> Transferir
        </button>
        <button onClick={() => setAdjOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Novo movimento
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Filtrar por produto…" value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Depósito</span>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} min-w-[180px]`}>
            <option value="">Todos</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Tipo</span>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as MovementType | '')} className={`${fieldCls} min-w-[160px]`}>
            <option value="">Todos</option>
            {(Object.keys(TYPE_LABEL) as MovementType[]).map(k => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
          </select>
        </label>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? <p className="text-sm text-gray-400 p-6">Carregando...</p>
         : filtered.length === 0 ? <p className="text-sm text-gray-400 p-6">Nenhum movimento.</p>
         : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="w-1 p-0" aria-hidden />
                  <th className="px-3 py-3 w-12 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">#</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Data</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Tipo</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Produto</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Depósito</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Quantidade</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Custo unit.</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((m, i) => {
                  const p = productById.get(m.product_id)
                  const w = warehouseById.get(m.warehouse_id)
                  const t = m.type as MovementType
                  return (
                    <tr key={m.id}
                      className="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-[inset_4px_0_0_0_#d1d5db] dark:shadow-[inset_4px_0_0_0_#4b5563]"
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'inset 4px 0 0 0 var(--color-1)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                      <td className="w-1 p-0" aria-hidden />
                      <td className="px-3 py-3.5 text-left">
                        <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i + 1}</span>
                      </td>
                      <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400 font-mono text-[12px]">{fmtDt(m.created_at)}</td>
                      <td className="px-3 py-3.5">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded text-white" style={{ background: TYPE_COLOR[t] }}>
                          {TYPE_LABEL[t]}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 font-semibold text-gray-800 dark:text-gray-100">{p ? `${p.code} — ${p.name}` : `#${m.product_id}`}</td>
                      <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400">{w?.name ?? `#${m.warehouse_id}`}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-gray-800 dark:text-gray-100">{fmt(m.quantity)}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-gray-500 dark:text-gray-400">{fmt(m.unit_cost)}</td>
                      <td className="px-3 py-3.5 text-[12px] text-gray-500 dark:text-gray-400">
                        {m.reference_type ? `${m.reference_type}#${m.reference_id ?? '?'}` : (m.reason || '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adjOpen   && <AdjustmentModal products={products} warehouses={warehouses} onClose={() => setAdjOpen(false)}   onSaved={() => { setAdjOpen(false); reload() }} />}
      {transfOpen && <TransferModal   products={products} warehouses={warehouses} onClose={() => setTransfOpen(false)} onSaved={() => { setTransfOpen(false); reload() }} />}
    </div>
  )
}
