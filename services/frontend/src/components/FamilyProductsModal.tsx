import { useEffect, useMemo, useState } from 'react'
import { ImageSquare, MagnifyingGlass, Package, Pencil, X } from '@phosphor-icons/react'
import {
  characteristicsApi, characteristicValuesApi, productCharacteristicsApi,
  type CharacteristicLinkRead, type CharacteristicRead, type CharacteristicValueRead,
  type FamilyRead, type ProductRead,
} from '../services/cadastrosApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

function fmtMoney(v: string | number): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

interface Props {
  family:   FamilyRead
  products: ProductRead[]            // todos os produtos já carregados pela página
  covers:   Record<number, string | null>
  onClose:  () => void
  onEdit?:  (p: ProductRead) => void  // abre o ProductFormModal no produto clicado
}

// Read-only: lista os produtos vinculados à família com filtro local. O CRUD
// fica em ProductsPage; aqui só dá visibilidade rápida e atalho para editar.
export default function FamilyProductsModal({ family, products, covers, onClose, onEdit }: Props) {
  const [filter, setFilter] = useState('')
  // Caches lazy: char links por product_id, lista de characteristics (nomes) e
  // valores por characteristic_id (carregados sob demanda no painel de detalhes).
  const [charLinks, setCharLinks] = useState<Record<number, CharacteristicLinkRead[]>>({})
  const [characteristics, setCharacteristics] = useState<CharacteristicRead[]>([])
  const [valuesByCharId, setValuesByCharId] = useState<Record<number, CharacteristicValueRead[]>>({})
  const [charDetailsFor, setCharDetailsFor] = useState<ProductRead | null>(null)

  // ESC fecha; se houver sub-painel aberto, ESC fecha ele primeiro.
  useModalShortcuts({ onClose: () => setCharDetailsFor(null), enabled: charDetailsFor != null })
  useModalShortcuts({ onClose,                                 enabled: charDetailsFor == null })

  const linked = useMemo(
    () => products.filter(p => p.family_id === family.id),
    [products, family.id],
  )

  // Pré-carrega nomes das características (lista pequena) e os links por
  // produto da família — paraleliza para evitar cascata visível.
  useEffect(() => {
    characteristicsApi.list({ only_active: false }).then(setCharacteristics).catch(() => {})
  }, [])
  useEffect(() => {
    const missing = linked.filter(p => charLinks[p.id] === undefined)
    if (missing.length === 0) return
    Promise.all(missing.map(p =>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked])

  // Resolve nomes dos valores quando o painel de detalhes é aberto.
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
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return linked
    return linked.filter(p =>
      p.name.toLowerCase().includes(f) ||
      p.code.toLowerCase().includes(f) ||
      (p.brand ?? '').toLowerCase().includes(f) ||
      (p.barcode ?? '').toLowerCase().includes(f),
    )
  }, [linked, filter])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header fixo. */}
        <div className="flex-shrink-0 px-6 pt-6 pb-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}>
                <Package size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 truncate">Produtos da família</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{family.name} · {linked.length} produto{linked.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title="Fechar"><X size={20} /></button>
          </div>
        </div>

        {/* Filtro inline + tabela. */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" placeholder="Filtrar por código, nome, marca ou EAN…"
              value={filter} onChange={e => setFilter(e.target.value)}
              className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]"
              autoFocus />
          </div>

          {linked.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nenhum produto vinculado a esta família.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Nenhum resultado.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="w-1 p-0" aria-hidden />
                    <th className="px-3 py-2.5 w-12 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">#</th>
                    <th className="px-3 py-2.5 w-32 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Código</th>
                    <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Produto</th>
                    <th className="px-3 py-2.5 w-28 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Preço</th>
                    <th className="px-3 py-2.5 w-28 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-right">Custo</th>
                    <th className="px-3 py-2.5 w-32 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Características</th>
                    <th className="px-3 py-2.5 w-20 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-center">Status</th>
                    {onEdit && <th className="px-3 py-2.5 w-16 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Ações</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filtered.map((p, i) => {
                    const cover = covers[p.id]
                    const links = charLinks[p.id]
                    const charCount = links?.length
                    return (
                      <tr key={p.id}
                        className="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-[inset_4px_0_0_0_#d1d5db] dark:shadow-[inset_4px_0_0_0_#4b5563]"
                        onMouseEnter={e => { e.currentTarget.style.boxShadow = 'inset 4px 0 0 0 var(--color-1)' }}
                        onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                        <td className="w-1 p-0" aria-hidden />
                        <td className="px-3 py-3 text-right">
                          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i + 1}</span>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{p.code}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="shrink-0 w-9 h-9 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 overflow-hidden flex items-center justify-center">
                              {cover
                                ? <img src={cover} alt={p.name} className="w-full h-full object-cover" />
                                : <ImageSquare size={16} className="text-gray-300 dark:text-gray-500" />}
                            </div>
                            <span className="font-semibold text-gray-800 dark:text-gray-100 truncate" title={p.name}>{p.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtMoney(p.price)}</td>
                        <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmtMoney(p.cost)}</td>
                        <td className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">
                          {charCount === undefined
                            ? <span className="text-gray-300 dark:text-gray-600">…</span>
                            : charCount === 0
                              ? '—'
                              : <button type="button" onClick={() => setCharDetailsFor(p)}
                                  className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-[var(--color-1)] hover:text-[var(--on-color-1)] transition-colors"
                                  title="Ver características">{charCount}</button>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
                            style={{ background: p.active ? 'var(--color-success)' : '#cbd5e1', color: p.active ? 'var(--on-color-success)' : '#475569' }}>
                            {p.active ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        {onEdit && (
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <button onClick={() => onEdit(p)}
                              className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                              title="Editar produto"><Pencil size={16} /></button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer. */}
        <div className="flex-shrink-0 px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-cancel)' }}>Fechar</button>
        </div>

        {/* Sub-painel: detalhes de características do produto clicado.
            Mesmo padrão visual usado em ProductsPage; sobrepõe este modal. */}
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
    </div>
  )
}
