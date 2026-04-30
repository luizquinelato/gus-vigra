import { useEffect, useMemo, useState } from 'react'
import { CaretDown, CaretUp, CaretUpDown, ImageSquare, MagicWand, MagnifyingGlass, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  categoriesApi, characteristicsApi, characteristicValuesApi, familiesApi, productsApi,
  productImagesApi, productCharacteristicsApi,
  type CategoryRead, type CharacteristicLinkRead, type CharacteristicRead,
  type CharacteristicValueRead, type FamilyRead, type ProductRead,
} from '../services/cadastrosApi'
import { ProductFormModal } from '../components/ProductFormModal'
import { ProductBulkWizardModal } from '../components/ProductBulkWizardModal'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

type SortKey = 'code' | 'name' | 'brand' | 'family' | 'category' | 'price' | 'cost'
type SortDir = 'asc' | 'desc'

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
  // Ordenação e paginação. pageSize = 0 representa "Todos".
  const [sortKey, setSortKey] = useState<SortKey>('code')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [pageSize, setPageSize] = useState<number>(100)
  const [page, setPage] = useState(1)
  // Caches por product_id, populados sob demanda quando a página visível muda.
  // null indica "carregado, sem imagem"; undefined = ainda não carregado.
  const [covers, setCovers] = useState<Record<number, string | null>>({})
  const [charLinks, setCharLinks] = useState<Record<number, CharacteristicLinkRead[]>>({})
  // Cache global de valores por characteristic_id, populado lazy quando o modal
  // de detalhes precisa resolver os nomes.
  const [valuesByCharId, setValuesByCharId] = useState<Record<number, CharacteristicValueRead[]>>({})
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [charDetailsFor, setCharDetailsFor] = useState<ProductRead | null>(null)
  // ESC fecha o lightbox de imagem e o painel de detalhes de características.
  // Sem onSubmit: ambos são apenas leitura, Enter não tem ação relevante.
  useModalShortcuts({ onClose: () => setPreviewUrl(null),    enabled: previewUrl != null })
  useModalShortcuts({ onClose: () => setCharDetailsFor(null), enabled: charDetailsFor != null })
  // Filtros estruturados (selects). 0 = "Todos".
  const [filterBrand,    setFilterBrand]    = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<number>(0)
  const [filterFamily,   setFilterFamily]   = useState<number>(0)

  function reload() {
    setLoading(true)
    // Capas em batch — uma única query SQL, evita N+1 ao popular a tabela.
    Promise.all([
      productsApi.list({ only_active: false, limit: 500 }),
      categoriesApi.list({ only_active: false }),
      familiesApi.list({ only_active: true }),
      characteristicsApi.list({ only_active: true }),
      productImagesApi.listCovers().catch(() => [] as { product_id: number; url: string }[]),
    ])
      .then(([p, c, f, ch, covs]) => {
        setItems(p); setCategories(c); setFamilies(f); setCharacteristics(ch)
        // Pré-popula o cache de capas. Produtos sem capa ficam como null para
        // que a célula renderize o ícone de placeholder, não o spinner.
        const coverMap: Record<number, string | null> = {}
        p.forEach(prod => { coverMap[prod.id] = null })
        covs.forEach(c => { coverMap[c.product_id] = c.url })
        setCovers(coverMap)
      })
      .catch(() => toast.error('Erro ao carregar produtos.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const familyById = useMemo(() => {
    const m = new Map<number, FamilyRead>()
    families.forEach(f => m.set(f.id, f))
    return m
  }, [families])
  const categoryById = useMemo(() => {
    const m = new Map<number, CategoryRead>()
    categories.forEach(c => m.set(c.id, c))
    return m
  }, [categories])

  function familyLabel(id: number | null): string {
    if (id == null) return ''
    return familyById.get(id)?.name ?? ''
  }
  function categoryLabel(id: number | null): string {
    if (id == null) return ''
    return categoryById.get(id)?.name ?? ''
  }

  // Lista de marcas distintas dos produtos (para o select de filtro).
  const brandOptions = useMemo(() => {
    const set = new Set<string>()
    items.forEach(p => { if (p.brand) set.add(p.brand) })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [items])

  const filtered = useMemo(() => {
    const f = filter.toLowerCase()
    return items.filter(p => {
      if (filterBrand    && p.brand !== filterBrand) return false
      if (filterCategory && p.category_id !== filterCategory) return false
      if (filterFamily   && p.family_id !== filterFamily)     return false
      if (!f) return true
      return (
        p.name.toLowerCase().includes(f) ||
        (p.brand ?? '').toLowerCase().includes(f) ||
        p.code.toLowerCase().includes(f) ||
        familyLabel(p.family_id).toLowerCase().includes(f) ||
        categoryLabel(p.category_id).toLowerCase().includes(f) ||
        (p.barcode ?? '').toLowerCase().includes(f)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, filterBrand, filterCategory, filterFamily, familyById, categoryById])

  // Ordena de acordo com sortKey/sortDir. Strings via localeCompare pt-BR
  // (acentos), números por subtração.
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      switch (sortKey) {
        case 'code':     av = a.code;                       bv = b.code; break
        case 'name':     av = a.name;                       bv = b.name; break
        case 'brand':    av = a.brand ?? '';                bv = b.brand ?? ''; break
        case 'family':   av = familyLabel(a.family_id);     bv = familyLabel(b.family_id); break
        case 'category': av = categoryLabel(a.category_id); bv = categoryLabel(b.category_id); break
        case 'price':    av = Number(a.price);              bv = Number(b.price); break
        case 'cost':     av = Number(a.cost);               bv = Number(b.cost); break
      }
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'pt-BR')
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, familyById, categoryById])

  // Reset de página quando filtro/ordenação/tamanho mudam — evita ficar
  // "fora do range" se o conjunto encolheu.
  useEffect(() => { setPage(1) }, [filter, filterBrand, filterCategory, filterFamily, sortKey, sortDir, pageSize])

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = pageSize === 0 ? sorted : sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  // Capas chegam pré-populadas em reload(); apenas char-links é lazy por página.
  useEffect(() => {
    const missingLinks = paged.filter(p => charLinks[p.id] === undefined)
    if (missingLinks.length > 0) {
      Promise.all(missingLinks.map(p =>
        productCharacteristicsApi.list(p.id)
          .then(links => ({ id: p.id, links }))
          .catch(() => ({ id: p.id, links: [] as CharacteristicLinkRead[] })),
      )).then(results => {
        setCharLinks(prev => {
          const next = { ...prev }
          results.forEach(r => { next[r.id] = r.links })
          return next
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged])

  // Resolve nomes dos valores quando o modal de detalhes é aberto.
  useEffect(() => {
    if (!charDetailsFor) return
    const links = charLinks[charDetailsFor.id]
    if (!links) return
    const charIds = Array.from(new Set(links.map(l => l.characteristic_id)))
    const missing = charIds.filter(id => valuesByCharId[id] === undefined)
    if (missing.length === 0) return
    Promise.all(missing.map(id =>
      characteristicValuesApi.listByCharacteristic(id)
        .then(values => ({ id, values }))
        .catch(() => ({ id, values: [] as CharacteristicValueRead[] })),
    )).then(results => {
      setValuesByCharId(prev => {
        const next = { ...prev }
        results.forEach(r => { next[r.id] = r.values })
        return next
      })
    })
  }, [charDetailsFor, charLinks, valuesByCharId])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
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
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Produtos</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Catálogo principal. Cada item é um produto independente — agrupe pelo campo "Família" quando houver variações.</p>
      </div>

      <div className="flex justify-end gap-2">
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FilterSelect label="Marca" value={filterBrand}
          onChange={v => setFilterBrand(v)}
          options={[{ value: '', label: 'Todas' }, ...brandOptions.map(b => ({ value: b, label: b }))]} />
        <FilterSelect label="Categoria" value={String(filterCategory)}
          onChange={v => setFilterCategory(Number(v))}
          options={[{ value: '0', label: 'Todas' }, ...categories.map(c => ({ value: String(c.id), label: c.name }))]} />
        <FilterSelect label="Família" value={String(filterFamily)}
          onChange={v => setFilterFamily(Number(v))}
          options={[{ value: '0', label: 'Todas' }, ...families.map(f => ({ value: String(f.id), label: f.name }))]} />
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar por código, nome, marca, família, categoria ou EAN…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? <p className="text-sm text-gray-400 p-6">Carregando...</p>
         : sorted.length === 0 ? <p className="text-sm text-gray-400 p-6">Nenhum produto encontrado.</p>
         : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    {/* Coluna espelho da borda esquerda das rows (4px) — mantém alinhamento header ↔ body */}
                    <th className="w-1 p-0" aria-hidden />
                    <th className="px-3 py-3 w-12 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">#</th>
                    <SortHeader k="code"     label="Código"          w="w-32" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortHeader k="name"     label="Produto"                  current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortHeader k="brand"    label="Marca"           w="w-32" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <th className="px-3 py-3 w-24 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Estoque</th>
                    <SortHeader k="price"    label="Preço"           w="w-32" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortHeader k="cost"     label="Custo"           w="w-28" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortHeader k="category" label="Categoria"       w="w-40" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortHeader k="family"   label="Família"         w="w-40" current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <th className="px-3 py-3 w-32 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Características</th>
                    <th className="px-3 py-3 w-24 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paged.map((p, i) => {
                    const lineNumber = pageSize === 0 ? i + 1 : (safePage - 1) * pageSize + i + 1
                    const cover = covers[p.id]
                    const links = charLinks[p.id]
                    const charCount = links?.length
                    return (
                      <tr key={p.id}
                        className="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-[inset_4px_0_0_0_#d1d5db] dark:shadow-[inset_4px_0_0_0_#4b5563]"
                        onMouseEnter={e => { e.currentTarget.style.boxShadow = 'inset 4px 0 0 0 var(--color-1)' }}
                        onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                        <td className="w-1 p-0" aria-hidden />
                        <td className="px-3 py-3.5 text-right">
                          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{lineNumber}</span>
                        </td>
                        <td className="px-3 py-3.5 font-mono text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{p.code}</td>
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <button type="button"
                              onClick={() => cover && setPreviewUrl(cover)}
                              disabled={!cover}
                              title={cover ? 'Ver imagem' : 'Sem imagem'}
                              className="shrink-0 w-9 h-9 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 overflow-hidden flex items-center justify-center hover:border-[var(--color-1)] disabled:cursor-default disabled:hover:border-gray-200 dark:disabled:hover:border-gray-600">
                              {cover
                                ? <img src={cover} alt={p.name} className="w-full h-full object-cover" />
                                : <ImageSquare size={16} className="text-gray-300 dark:text-gray-500" />}
                            </button>
                            <span className="font-semibold text-gray-800 dark:text-gray-100 truncate" title={p.name}>{p.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-xs text-gray-600 dark:text-gray-300">{p.brand || '—'}</td>
                        <td className="px-3 py-3.5 text-right text-xs text-gray-400 dark:text-gray-500">—</td>
                        <td className="px-3 py-3.5 text-right text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtMoney(p.price)}</td>
                        <td className="px-3 py-3.5 text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmtMoney(p.cost)}</td>
                        <td className="px-3 py-3.5 text-xs text-gray-600 dark:text-gray-300">{categoryLabel(p.category_id) || '—'}</td>
                        <td className="px-3 py-3.5 text-xs text-gray-600 dark:text-gray-300">{familyLabel(p.family_id) || '—'}</td>
                        <td className="px-3 py-3.5 text-xs text-gray-600 dark:text-gray-300">
                          {charCount === undefined
                            ? <span className="text-gray-300 dark:text-gray-600">…</span>
                            : charCount === 0
                              ? '—'
                              : <button type="button" onClick={() => setCharDetailsFor(p)}
                                  className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-[var(--color-1)] hover:text-[var(--on-color-1)] transition-colors"
                                  title="Ver características">{charCount}</button>}
                        </td>
                        <td className="px-3 py-3.5 text-right whitespace-nowrap">
                          <button onClick={() => { setEditing(p); setOpenForm(true) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar"><Pencil size={16} /></button>
                          {p.active && <button onClick={() => handleSoftDelete(p)} className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-1" title="Desativar"><Trash size={16} /></button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {pageSize === 0
                  ? `${sorted.length} produto${sorted.length !== 1 ? 's' : ''}`
                  : `Mostrando ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} de ${sorted.length}`}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                  Por página:
                  <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                    className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none">
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={0}>Todos</option>
                  </select>
                </label>
                {pageSize !== 0 && totalPages > 1 && (
                  <div className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                      className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-[var(--color-1)] disabled:opacity-40 disabled:hover:border-gray-200 dark:disabled:hover:border-gray-600">Anterior</button>
                    <span className="px-2">Página {safePage} de {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                      className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-[var(--color-1)] disabled:opacity-40 disabled:hover:border-gray-200 dark:disabled:hover:border-gray-600">Próxima</button>
                  </div>
                )}
              </div>
            </div>
          </>
         )}
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

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setPreviewUrl(null)}>
          <button type="button" onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-black/30 hover:bg-black/50"
            title="Fechar">
            <X size={20} />
          </button>
          <img src={previewUrl} alt="Imagem do produto"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()} />
        </div>
      )}

      {charDetailsFor && (() => {
        const links = charLinks[charDetailsFor.id] ?? []
        const charName = (id: number) => characteristics.find(c => c.id === id)?.name ?? `#${id}`
        const valueRecord = (charId: number, valueId: number) => {
          const v = valuesByCharId[charId]?.find(x => x.id === valueId)
          return v ?? null
        }
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
            onClick={() => setCharDetailsFor(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 truncate">Características</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{charDetailsFor.name}</p>
                </div>
                <button type="button" onClick={() => setCharDetailsFor(null)}
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" title="Fechar">
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-y-auto p-5 space-y-2">
                {links.length === 0
                  ? <p className="text-sm text-gray-400">Nenhuma característica vinculada.</p>
                  : links.map(link => {
                      const v = valueRecord(link.characteristic_id, link.value_id)
                      const loading = valuesByCharId[link.characteristic_id] === undefined
                      return (
                        <div key={link.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
                          <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{charName(link.characteristic_id)}</span>
                          <span className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                            {v?.hex_color && (
                              <span className="inline-block w-4 h-4 rounded border border-gray-200 dark:border-gray-600" style={{ background: v.hex_color }} />
                            )}
                            {loading ? <span className="text-gray-300 dark:text-gray-600">…</span> : (v?.value ?? `#${link.value_id}`)}
                            {v?.unit && <span className="text-xs text-gray-400">{v.unit}</span>}
                          </span>
                        </div>
                      )
                    })}
              </div>
            </div>
          </div>
        )
      })()}
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

interface FilterSelectProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
