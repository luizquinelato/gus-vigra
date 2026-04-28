import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FloppyDisk, MagnifyingGlass, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  familiesApi, priceTableItemsApi, priceTablesApi, productsApi,
  type FamilyRead, type PriceTableItemRead, type PriceTableRead, type ProductRead,
} from '../services/cadastrosApi'

const fieldCls = 'w-full px-2 py-1 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

export default function PriceTableItemsPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const tid = Number(tableId)
  const [table, setTable] = useState<PriceTableRead | null>(null)
  const [products, setProducts] = useState<ProductRead[]>([])
  const [items, setItems] = useState<PriceTableItemRead[]>([])
  const [families, setFamilies] = useState<FamilyRead[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({}) // product_id -> preço digitado
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  function reload() {
    setLoading(true)
    Promise.all([
      priceTablesApi.get(tid),
      productsApi.list({ only_active: true, limit: 500 }),
      priceTableItemsApi.listByTable(tid, { only_active: false }),
      familiesApi.list({ only_active: true }),
    ])
      .then(([t, ps, its, fs]) => {
        setTable(t); setProducts(ps); setItems(its); setFamilies(fs); setDrafts({})
      })
      .catch(() => toast.error('Erro ao carregar tabela.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (tid) reload() }, [tid]) // eslint-disable-line react-hooks/exhaustive-deps

  const itemsByProduct = useMemo(() => {
    const m = new Map<number, PriceTableItemRead>()
    items.forEach(it => m.set(it.product_id, it))
    return m
  }, [items])

  const familyById = useMemo(() => {
    const m = new Map<number, FamilyRead>()
    families.forEach(f => m.set(f.id, f))
    return m
  }, [families])
  function familyLabel(id: number | null): string {
    if (id == null) return ''
    return familyById.get(id)?.name ?? `#${id}`
  }

  const filtered = useMemo(() => {
    const f = filter.toLowerCase()
    if (!f) return products
    return products.filter(p =>
      p.code.toLowerCase().includes(f) ||
      p.name.toLowerCase().includes(f) ||
      familyLabel(p.family_id).toLowerCase().includes(f),
    )
  }, [products, filter])

  async function handleSave(p: ProductRead) {
    const price = (drafts[p.id] ?? '').trim()
    if (!price || isNaN(Number(price))) { toast.error('Preço inválido.'); return }
    setSaving(p.id)
    try {
      const existing = itemsByProduct.get(p.id)
      if (existing) await priceTableItemsApi.patch(existing.id, { price, active: true })
      else          await priceTableItemsApi.create(tid, { price, price_table_id: tid, product_id: p.id })
      toast.success('Preço salvo.')
      reload()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar preço.')
    } finally { setSaving(null) }
  }

  async function handleRemove(it: PriceTableItemRead) {
    if (!confirm('Remover preço deste produto? (volta ao preço padrão)')) return
    try { await priceTableItemsApi.softDelete(it.id); toast.success('Preço removido.'); reload() }
    catch { toast.error('Erro ao remover.') }
  }

  if (table && table.type !== 'fixed') {
    return (
      <div className="min-h-full p-8 space-y-4">
        <Link to="/cadastros/tabelas-preco" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <ArrowLeft size={14} /> Voltar para tabelas
        </Link>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Esta tabela é do tipo <strong>% off</strong> ({Number(table.discount_pct).toFixed(2)}%) — ela aplica um desconto global sobre o preço padrão, sem preços por produto.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <Link to="/cadastros/tabelas-preco" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <ArrowLeft size={14} /> Voltar para tabelas
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Preços por produto{table ? ` · ${table.name}` : ''}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Defina o preço desta tabela para cada produto. Sem preço definido, o produto usa o preço padrão.</p>
          </div>
        </div>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar por código, nome ou família…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhum produto encontrado.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 dark:border-gray-700">
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Código</th>
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
              <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">Preço padrão</th>
              <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-40">Preço nesta tabela</th>
              <th className="w-24" />
            </tr></thead>
            <tbody>
              {filtered.map((p, i) => {
                const existing = itemsByProduct.get(p.id)
                const draftValue = drafts[p.id] ?? (existing && existing.active ? existing.price : '')
                const dirty = drafts[p.id] !== undefined && drafts[p.id] !== (existing?.price ?? '')
                return (
                  <tr key={p.id} className={`hover:bg-gray-100 dark:hover:bg-gray-700/50 ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}`}>
                    <td className="py-2 pl-3 font-mono text-xs text-gray-600 dark:text-gray-300">{p.code}</td>
                    <td className="py-2">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.family_id != null ? `Família: ${familyLabel(p.family_id)}` : ''}</p>
                    </td>
                    <td className="py-2 text-right text-gray-500 dark:text-gray-400">{Number(p.price).toFixed(2)}</td>
                    <td className="py-2 text-right">
                      <input type="number" step="0.01" value={draftValue}
                        onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                        placeholder={existing && !existing.active ? '(removido)' : '—'}
                        className={`${fieldCls} text-right ${dirty ? 'border-[var(--color-1)]' : ''}`} />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button onClick={() => handleSave(p)} disabled={saving === p.id || !dirty}
                        className="text-gray-400 hover:text-[var(--color-1)] p-1 disabled:opacity-30 disabled:cursor-not-allowed" title="Salvar">
                        <FloppyDisk size={16} className={saving === p.id ? 'animate-spin' : undefined} />
                      </button>
                      {existing && existing.active && (
                        <button onClick={() => handleRemove(existing)} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Remover preço">
                          <Trash size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
