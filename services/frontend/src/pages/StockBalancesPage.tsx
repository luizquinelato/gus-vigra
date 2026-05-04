import { useEffect, useMemo, useState } from 'react'
import { FloppyDisk, MagnifyingGlass, Pencil, Warning, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  balancesApi, warehousesApi,
  type StockBalanceRead, type WarehouseRead,
} from '../services/estoqueApi'
import { productsApi, type ProductRead } from '../services/cadastrosApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function fmt(n: string | null) {
  if (n === null || n === undefined) return '—'
  const v = Number(n)
  if (Number.isNaN(v)) return n
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

interface LimitsModalProps {
  balance: StockBalanceRead
  productName: string
  warehouseName: string
  onClose: () => void
  onSaved: () => void
}
function LimitsModal({ balance, productName, warehouseName, onClose, onSaved }: LimitsModalProps) {
  const [minQ, setMinQ]     = useState(balance.min_quantity ?? '0')
  const [maxQ, setMaxQ]     = useState(balance.max_quantity ?? '')
  const [saving, setSaving] = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    setSaving(true)
    try {
      await balancesApi.patchLimits(balance.product_id, balance.warehouse_id, {
        min_quantity: minQ.trim() || '0',
        max_quantity: maxQ.trim() || null,
      })
      toast.success('Limites atualizados.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao atualizar.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-edit)', color: 'var(--on-color-edit)' }}>
              <Pencil size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Limites de estoque</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{productName} • {warehouseName}</p>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Quantidade mínima</span>
            <input type="number" step="0.0001" min="0" value={minQ} onChange={e => setMinQ(e.target.value)} className={`${fieldCls} mt-1`} />
            <span className="text-[11px] text-gray-400 mt-1 block">Alertas quando o saldo estiver abaixo deste valor.</span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Quantidade máxima</span>
            <input type="number" step="0.0001" min="0" value={maxQ} onChange={e => setMaxQ(e.target.value)} className={`${fieldCls} mt-1`} placeholder="Sem limite" />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StockBalancesPage() {
  const [balances, setBalances]     = useState<StockBalanceRead[]>([])
  const [products, setProducts]     = useState<ProductRead[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRead[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('')
  const [whFilter, setWhFilter]     = useState<number | ''>('')
  const [belowMin, setBelowMin]     = useState(false)
  const [editing, setEditing]       = useState<StockBalanceRead | null>(null)

  function reload() {
    setLoading(true)
    Promise.all([
      balancesApi.list({
        warehouse_id: whFilter || undefined,
        below_min: belowMin || undefined,
        limit: 500,
      }),
      productsApi.list({ only_active: false, limit: 500 }),
      warehousesApi.list({ only_active: true }),
    ])
      .then(([b, p, w]) => { setBalances(b); setProducts(p); setWarehouses(w) })
      .catch(() => toast.error('Erro ao carregar saldos.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [whFilter, belowMin]) // eslint-disable-line react-hooks/exhaustive-deps

  const productById   = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return balances.filter(b => {
      const p = productById.get(b.product_id)
      if (!p) return false
      return p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    })
  }, [balances, productById, filter])

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Saldos de Estoque</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Quantidade disponível, reservada e custo médio por produto/depósito.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Filtrar por código ou nome…" value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Depósito</span>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value ? Number(e.target.value) : '')}
            className={`${fieldCls} min-w-[180px]`}>
            <option value="">Todos</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={belowMin} onChange={e => setBelowMin(e.target.checked)} className="accent-[var(--color-1)]" />
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Apenas abaixo do mínimo</span>
        </label>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? <p className="text-sm text-gray-400 p-6">Carregando...</p>
         : filtered.length === 0 ? <p className="text-sm text-gray-400 p-6">Nenhum saldo registrado.</p>
         : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="w-1 p-0" aria-hidden />
                  <th className="px-3 py-3 w-12 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">#</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Produto</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Depósito</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Quantidade</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Reservado</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Disponível</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Custo médio</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Mín / Máx</th>
                  <th className="px-3 py-3 w-20 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((b, i) => {
                  const p = productById.get(b.product_id)
                  const w = warehouseById.get(b.warehouse_id)
                  const min = Number(b.min_quantity ?? '0')
                  const qty = Number(b.quantity ?? '0')
                  const low = min > 0 && qty < min
                  return (
                    <tr key={b.id}
                      className="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-[inset_4px_0_0_0_#d1d5db] dark:shadow-[inset_4px_0_0_0_#4b5563]"
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'inset 4px 0 0 0 var(--color-1)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                      <td className="w-1 p-0" aria-hidden />
                      <td className="px-3 py-3.5 text-left">
                        <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i + 1}</span>
                      </td>
                      <td className="px-3 py-3.5 font-semibold text-gray-800 dark:text-gray-100">
                        <div className="flex items-center gap-2">
                          {low && <span title="Abaixo do mínimo"><Warning size={14} weight="fill" className="text-amber-500" /></span>}
                          <span>{p ? `${p.code} — ${p.name}` : `#${b.product_id}`}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400">{w?.name ?? `#${b.warehouse_id}`}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-gray-800 dark:text-gray-100">{fmt(b.quantity)}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-gray-500 dark:text-gray-400">{fmt(b.reserved_quantity)}</td>
                      <td className="px-3 py-3.5 text-right font-mono font-semibold text-gray-800 dark:text-gray-100">{fmt(b.available)}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-gray-500 dark:text-gray-400">{fmt(b.avg_cost)}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-[12px] text-gray-500 dark:text-gray-400">
                        {fmt(b.min_quantity)} / {b.max_quantity ? fmt(b.max_quantity) : '∞'}
                      </td>
                      <td className="px-3 py-3.5">
                        <button onClick={() => setEditing(b)} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar limites"><Pencil size={16} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <LimitsModal
          balance={editing}
          productName={productById.get(editing.product_id)?.name ?? `#${editing.product_id}`}
          warehouseName={warehouseById.get(editing.warehouse_id)?.name ?? `#${editing.warehouse_id}`}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}
