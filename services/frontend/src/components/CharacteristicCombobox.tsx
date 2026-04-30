/**
 * CharacteristicCombobox.tsx
 * ==========================
 * Combobox de characteristic (Cor, Tamanho, Voltagem…). Suporta busca por
 * substring, criação inline (com escolha do `type` ∈ text/color/number) e
 * exclusão de ids já usados em outras linhas (evita duplicatas).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, MagnifyingGlass, Plus, Spinner, X } from '@phosphor-icons/react'
import type { CharacteristicRead, CharacteristicType } from '../services/cadastrosApi'

// min-h-[38px] + box-border garante altura idêntica entre o <button> fechado e
// o <div>+<input> aberto, evitando shift sub-pixel ao trocar de estado.
const fieldCls = 'w-full px-3 py-2 text-sm box-border min-h-[38px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'
const openWrapperCls = 'w-full flex items-center gap-2 box-border min-h-[38px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus-within:border-[var(--color-1)]'

const TYPE_LABEL: Record<CharacteristicType, string> = { text: 'Texto', color: 'Cor', number: 'Número' }

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  options: CharacteristicRead[]
  excludeIds?: number[]
  onCreate: (name: string, type: CharacteristicType) => Promise<CharacteristicRead>
  placeholder?: string
}

export function CharacteristicCombobox({
  value, onChange, options, excludeIds = [], onCreate, placeholder,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingType, setPendingType] = useState<CharacteristicType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false); setPendingType(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])
  const visible = useMemo(
    () => [...options]
      .filter(o => !excluded.has(o.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [options, excluded],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? visible.filter(o => o.name.toLowerCase().includes(q)) : visible
  }, [visible, query])

  const queryTrim = query.trim()
  const showCreateOption = queryTrim.length > 0
    && !options.some(o => o.name.toLowerCase() === queryTrim.toLowerCase())
  const selected = value != null ? options.find(o => o.id === value) ?? null : null

  function pickId(id: number | null) {
    onChange(id); setQuery(''); setError(null); setPendingType(null); setOpen(false)
  }

  async function doCreate(type: CharacteristicType) {
    setCreating(true); setError(null)
    try {
      const created = await onCreate(queryTrim, type)
      pickId(created.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao criar característica.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setQuery('') }}
          className={`${fieldCls} flex items-center justify-between text-left`}>
          <span className={selected ? '' : 'text-gray-400'}>
            {selected?.name || placeholder || 'Característica…'}
          </span>
          <span className="flex items-center gap-1 text-gray-400">
            {selected && (
              <X size={14} onClick={e => { e.stopPropagation(); pickId(null) }} className="hover:text-red-500" />
            )}
            <CaretDown size={14} />
          </span>
        </button>
      ) : (
        <div className={openWrapperCls}>
          <MagnifyingGlass size={14} className="ml-3 text-gray-400 shrink-0" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar ou criar…" disabled={creating}
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }}
            className="flex-1 py-2 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-100 disabled:opacity-50" />
          {creating && <Spinner size={14} className="mr-3 animate-spin text-gray-400" />}
        </div>
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filtered.length === 0 && !showCreateOption && (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhuma característica encontrada.</p>
          )}
          {filtered.map(opt => (
            <button key={opt.id} type="button" onClick={() => pickId(opt.id)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${opt.id === value ? 'font-semibold text-[var(--color-1)]' : 'text-gray-700 dark:text-gray-200'}`}>
              <span>{opt.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-gray-400">{TYPE_LABEL[opt.type]}</span>
            </button>
          ))}
          {showCreateOption && pendingType == null && (
            <button type="button" disabled={creating} onClick={() => setPendingType('text')}
              className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-700 text-[var(--color-1)] hover:bg-gray-100 dark:hover:bg-gray-700 inline-flex items-center gap-1 disabled:opacity-50">
              <Plus size={12} /> Criar característica "<strong>{queryTrim}</strong>"…
            </button>
          )}
          {showCreateOption && pendingType != null && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 space-y-2">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Tipo de "<strong>{queryTrim}</strong>":</p>
              <div className="flex gap-1">
                {(['text', 'color', 'number'] as CharacteristicType[]).map(t => (
                  <button key={t} type="button" disabled={creating}
                    onClick={() => void doCreate(t)}
                    className={`flex-1 px-2 py-1 text-xs rounded border ${t === pendingType ? 'border-[var(--color-1)] text-[var(--color-1)]' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'} hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50`}>
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400">O tipo não pode ser alterado depois.</p>
            </div>
          )}
          {error && (
            <p className="px-3 py-2 text-xs text-red-500 border-t border-gray-100 dark:border-gray-700">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
