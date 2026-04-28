import { useEffect, useMemo, useState } from 'react'
import { CaretDown, CaretRight, MagicWand, MagnifyingGlass, Pencil, Plus, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  categoriesApi, characteristicsApi, familiesApi, productsApi,
  type CategoryRead, type CharacteristicRead, type FamilyRead, type ProductRead,
} from '../services/cadastrosApi'
import { ProductFormModal } from '../components/ProductFormModal'
import { ProductBulkWizardModal } from '../components/ProductBulkWizardModal'

const FREE_KEY = '__free__'  // chave do grupo "sem família"

function fmtMoney(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ProductsPage() {
  const [items, setItems] = useState<ProductRead[]>([])
  const [categories, setCategories] = useState<CategoryRead[]>([])
  const [families, setFamilies] = useState<FamilyRead[]>([])
  const [characteristics, setCharacteristics] = useState<CharacteristicRead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<ProductRead | null>(null)
  const [openForm, setOpenForm] = useState(false)
  const [openWizard, setOpenWizard] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function reload() {
    setLoading(true)
    Promise.all([
      productsApi.list({ only_active: false, limit: 500 }),
      categoriesApi.list({ only_active: false }),
      familiesApi.list({ only_active: true }),
      characteristicsApi.list({ only_active: true }),
    ])
      .then(([p, c, f, ch]) => { setItems(p); setCategories(c); setFamilies(f); setCharacteristics(ch) })
      .catch(() => toast.error('Erro ao carregar produtos.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

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
    if (!f) return items
    return items.filter(p =>
      p.name.toLowerCase().includes(f) ||
      (p.brand ?? '').toLowerCase().includes(f) ||
      p.code.toLowerCase().includes(f) ||
      familyLabel(p.family_id).toLowerCase().includes(f) ||
      (p.barcode ?? '').toLowerCase().includes(f),
    )
  }, [items, filter, familyById])

  // Agrupa por família. Produtos sem família vão para grupo FREE_KEY (renderizado no fim).
  const groups = useMemo(() => {
    const map = new Map<string, ProductRead[]>()
    filtered.forEach(p => {
      const k = p.family_id != null ? String(p.family_id) : FREE_KEY
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(p)
    })
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === FREE_KEY) return 1
      if (b[0] === FREE_KEY) return -1
      return familyLabel(Number(a[0])).localeCompare(familyLabel(Number(b[0])))
    })
  }, [filtered, familyById])

  function toggleGroup(family: string) {
    setCollapsed(s => {
      const n = new Set(s)
      if (n.has(family)) n.delete(family); else n.add(family)
      return n
    })
  }

  function mergeFamily(created: FamilyRead) {
    setFamilies(prev => prev.some(f => f.id === created.id) ? prev : [...prev, created])
  }
  function mergeCharacteristic(created: CharacteristicRead) {
    setCharacteristics(prev => prev.some(c => c.id === created.id) ? prev : [...prev, created])
  }

  async function handleSoftDelete(p: ProductRead) {
    if (!confirm(`Desativar "${p.name}"?`)) return
    try { await productsApi.softDelete(p.id); toast.success('Produto desativado.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Produtos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Catálogo principal. Cada item é um produto independente — agrupe pelo campo "Família" quando houver variações.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setOpenWizard(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <MagicWand size={15} /> Wizard de combinações
          </button>
          <button onClick={() => { setEditing(null); setOpenForm(true) }}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
            <Plus size={15} /> Novo produto
          </button>
        </div>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar por código, nome, marca, família ou EAN…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p>
         : groups.length === 0 ? <p className="text-sm text-gray-400">Nenhum produto cadastrado.</p>
         : groups.map(([family, list]) => {
            const isFree = family === FREE_KEY
            const isCollapsed = collapsed.has(family)
            const label = isFree ? '' : familyLabel(Number(family))
            return (
              <div key={family}>
                {!isFree && (
                  <button onClick={() => toggleGroup(family)}
                    className="w-full flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 hover:text-[var(--color-1)]">
                    {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                    Família · <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{label}</span>
                    <span className="text-xs text-gray-400 font-normal">({list.length})</span>
                  </button>
                )}
                {!isCollapsed && (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 dark:border-gray-700">
                      <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Código</th>
                      <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
                      <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Preço</th>
                      <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Tipo</th>
                      <th className="text-center pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Status</th>
                      <th className="w-20" />
                    </tr></thead>
                    <tbody>
                      {list.map((p, i) => {
                        const cat = categories.find(c => c.id === p.category_id)
                        return (
                          <tr key={p.id} className={`hover:bg-gray-100 dark:hover:bg-gray-700/50 ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}`}>
                            <td className="py-3 pl-3 font-mono text-xs text-gray-600 dark:text-gray-300">{p.code}</td>
                            <td className="py-3">
                              <p className="font-semibold text-gray-800 dark:text-gray-100">{p.name}</p>
                              <p className="text-xs text-gray-400">{[p.brand, cat?.name].filter(Boolean).join(' · ') || '—'}</p>
                            </td>
                            <td className="py-3 text-right text-gray-700 dark:text-gray-200">{fmtMoney(p.price)}</td>
                            <td className="py-3 text-xs text-gray-500 dark:text-gray-400">{p.type === 'kit' ? 'Kit' : 'Simples'}</td>
                            <td className="py-3 text-center">
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: p.active ? 'var(--color-success)' : '#cbd5e1', color: p.active ? 'var(--on-color-success)' : '#475569' }}>
                                {p.active ? 'Ativo' : 'Inativo'}
                              </span>
                            </td>
                            <td className="py-3 pr-3 text-right">
                              <button onClick={() => { setEditing(p); setOpenForm(true) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" title="Editar"><Pencil size={16} /></button>
                              {p.active && <button onClick={() => handleSoftDelete(p)} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Desativar"><Trash size={16} /></button>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
      </section>

      {openForm && (
        <ProductFormModal initial={editing} categories={categories} allProducts={items}
          families={families} characteristics={characteristics}
          onFamilyCreated={mergeFamily} onCharacteristicCreated={mergeCharacteristic}
          onClose={() => setOpenForm(false)}
          onSaved={() => { setOpenForm(false); reload() }} />
      )}
      {openWizard && (
        <ProductBulkWizardModal categories={categories}
          families={families} characteristics={characteristics}
          onFamilyCreated={mergeFamily} onCharacteristicCreated={mergeCharacteristic}
          onClose={() => setOpenWizard(false)}
          onSaved={() => { setOpenWizard(false); reload() }} />
      )}
    </div>
  )
}
