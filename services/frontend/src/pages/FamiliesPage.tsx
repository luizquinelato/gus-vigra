import { useEffect, useMemo, useState } from 'react'
import { CaretDown, CaretUp, CaretUpDown, MagnifyingGlass, Package, Pencil, Plus, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { familiesApi, productsApi, productImagesApi, type FamilyRead, type ProductRead } from '../services/cadastrosApi'
import FamilyFormModal from '../components/FamilyFormModal'
import FamilyProductsModal from '../components/FamilyProductsModal'

type SortKey = 'name' | 'count' | 'status'
type SortDir = 'asc' | 'desc'

export default function FamiliesPage() {
  const [items, setItems] = useState<FamilyRead[]>([])
  const [products, setProducts] = useState<ProductRead[]>([])
  const [covers, setCovers] = useState<Record<number, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<FamilyRead | null>(null)
  const [open, setOpen] = useState(false)
  // Modal somente-leitura com produtos vinculados.
  const [productsOf, setProductsOf] = useState<FamilyRead | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function reload() {
    setLoading(true)
    Promise.all([
      familiesApi.list({ only_active: false }),
      productsApi.list({ only_active: false, limit: 500 }),
      productImagesApi.listCovers().catch(() => [] as { product_id: number; url: string }[]),
    ])
      .then(([fs, ps, covs]) => {
        setItems(fs); setProducts(ps)
        const map: Record<number, string | null> = {}
        ps.forEach(p => { map[p.id] = null })
        covs.forEach(c => { map[c.product_id] = c.url })
        setCovers(map)
      })
      .catch(() => toast.error('Erro ao carregar famílias.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const countByFamily = useMemo(() => {
    const m = new Map<number, number>()
    products.forEach(p => { if (p.family_id != null) m.set(p.family_id, (m.get(p.family_id) ?? 0) + 1) })
    return m
  }, [products])

  const filtered = useMemo(
    () => items.filter(t => t.name.toLowerCase().includes(filter.toLowerCase())),
    [items, filter],
  )

  // Ordenação local. Strings via localeCompare pt-BR; números por subtração.
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name':   cmp = a.name.localeCompare(b.name, 'pt-BR'); break
        case 'count':  cmp = (countByFamily.get(a.id) ?? 0) - (countByFamily.get(b.id) ?? 0); break
        case 'status': cmp = Number(b.active) - Number(a.active); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir, countByFamily])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  async function handleSoftDelete(f: FamilyRead) {
    const count = countByFamily.get(f.id) ?? 0
    const extra = count > 0 ? `\n\n${count} produto(s) ficará(ão) sem família.` : ''
    if (!confirm(`Desativar "${f.name}"?${extra}`)) return
    try { await familiesApi.softDelete(f.id); toast.success('Família desativada.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Famílias</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Agrupamento de produtos derivados de um mesmo modelo (ex: Camiseta Básica).</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova família
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? <p className="text-sm text-gray-400 p-6">Carregando...</p>
         : sorted.length === 0 ? <p className="text-sm text-gray-400 p-6">Nenhuma família.</p>
         : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  {/* Coluna espelho da borda esquerda das rows (4px). */}
                  <th className="w-1 p-0" aria-hidden />
                  <th className="px-3 py-3 w-12 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">#</th>
                  <SortHeader k="name"   label="Nome"              current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeader k="count"  label="Produtos" w="w-32" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortHeader k="status" label="Status"   w="w-28" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <th className="px-3 py-3 w-32 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {sorted.map((f, i) => {
                  const count = countByFamily.get(f.id) ?? 0
                  return (
                    <tr key={f.id}
                      className="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-[inset_4px_0_0_0_#d1d5db] dark:shadow-[inset_4px_0_0_0_#4b5563]"
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'inset 4px 0 0 0 var(--color-1)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                      <td className="w-1 p-0" aria-hidden />
                      <td className="px-3 py-3.5 text-left">
                        <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i + 1}</span>
                      </td>
                      <td className="px-3 py-3.5 font-semibold text-gray-800 dark:text-gray-100">{f.name}</td>
                      <td className="px-3 py-3.5 text-left text-gray-600 dark:text-gray-300 whitespace-nowrap">{count}</td>
                      <td className="px-3 py-3.5 text-left">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: f.active ? 'var(--color-success)' : '#cbd5e1', color: f.active ? 'var(--on-color-success)' : '#475569' }}>
                          {f.active ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-left whitespace-nowrap">
                        <button onClick={() => setProductsOf(f)} disabled={count === 0}
                          className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-[var(--color-1)] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600 dark:disabled:hover:text-gray-300"
                          title={count === 0 ? 'Sem produtos vinculados' : 'Ver produtos'}><Package size={16} /></button>
                        <button onClick={() => { setEditing(f); setOpen(true) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors ml-1" title="Editar"><Pencil size={16} /></button>
                        {f.active && <button onClick={() => handleSoftDelete(f)} className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-1" title="Desativar"><Trash size={16} /></button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <FamilyFormModal initial={editing}
          productsCount={editing ? (countByFamily.get(editing.id) ?? 0) : 0}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />
      )}
      {productsOf && (
        <FamilyProductsModal family={productsOf} products={products} covers={covers}
          onClose={() => setProductsOf(null)} />
      )}
    </div>
  )
}

interface SortHeaderProps {
  k: SortKey
  label: string
  w?: string
  align?: 'left' | 'right' | 'center'
  current: SortKey
  dir: SortDir
  onClick: (k: SortKey) => void
}

function SortHeader({ k, label, w, align = 'left', current, dir, onClick }: SortHeaderProps) {
  const isCurrent = current === k
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  return (
    <th className={`px-3 py-3 ${w ?? ''}`}>
      <button type="button" onClick={() => onClick(k)}
        className={`w-full inline-flex items-center gap-1 ${justify} text-xs font-medium uppercase tracking-wider transition-colors ${
          isCurrent ? 'text-[var(--color-1)]' : 'text-gray-700 dark:text-gray-300 hover:text-[var(--color-1)]'
        }`}>
        {label}
        {isCurrent
          ? (dir === 'asc' ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />)
          : <CaretUpDown size={11} weight="bold" className="text-gray-400 dark:text-gray-500" />}
      </button>
    </th>
  )
}
