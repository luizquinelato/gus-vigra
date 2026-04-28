import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, MagnifyingGlass, Plus, Spinner, X } from '@phosphor-icons/react'
import { familiesApi, type FamilyRead } from '../services/cadastrosApi'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  /** Catálogo carregado pelo pai. Quando uma nova família é criada inline,
   *  o componente chama `onCreated` para o pai mesclar no catálogo. */
  options: FamilyRead[]
  onCreated?: (created: FamilyRead) => void
  placeholder?: string
  allowClear?: boolean
}

export function FamilyCombobox({
  value, onChange, options, onCreated, placeholder, allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const sorted = useMemo(
    () => [...options].sort((a, b) => a.name.localeCompare(b.name)),
    [options],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(o => o.name.toLowerCase().includes(q))
  }, [sorted, query])

  const queryTrim = query.trim()
  const showCreateOption = queryTrim.length > 0
    && !sorted.some(o => o.name.toLowerCase() === queryTrim.toLowerCase())

  const selected = value != null ? options.find(o => o.id === value) ?? null : null

  function pickId(id: number | null) {
    onChange(id)
    setQuery('')
    setError(null)
    setOpen(false)
  }

  async function createAndPick(name: string) {
    setCreating(true); setError(null)
    try {
      const created = await familiesApi.create({ name })
      onCreated?.(created)
      pickId(created.id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar família.'
      setError(msg)
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
            {selected?.name || placeholder || 'Selecionar…'}
          </span>
          <span className="flex items-center gap-1 text-gray-400">
            {selected && allowClear && (
              <X size={14} onClick={e => { e.stopPropagation(); pickId(null) }} className="hover:text-red-500" />
            )}
            <CaretDown size={14} />
          </span>
        </button>
      ) : (
        <div className={`${fieldCls} flex items-center gap-2 p-0`}>
          <MagnifyingGlass size={14} className="ml-3 text-gray-400 shrink-0" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar ou digitar nova família…"
            disabled={creating}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!queryTrim) return
                const exact = sorted.find(o => o.name.toLowerCase() === queryTrim.toLowerCase())
                if (exact) pickId(exact.id)
                else void createAndPick(queryTrim)
              }
              if (e.key === 'Escape') { setOpen(false) }
            }}
            className="flex-1 py-2 text-sm bg-transparent outline-none text-gray-800 dark:text-gray-100 disabled:opacity-50" />
          {creating && <Spinner size={14} className="mr-3 animate-spin text-gray-400" />}
        </div>
      )}

      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filtered.length === 0 && !showCreateOption && (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhuma família encontrada.</p>
          )}
          {filtered.map(opt => (
            <button key={opt.id} type="button" onClick={() => pickId(opt.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${opt.id === value ? 'font-semibold text-[var(--color-1)]' : 'text-gray-700 dark:text-gray-200'}`}>
              {opt.name}
            </button>
          ))}
          {showCreateOption && (
            <button type="button" disabled={creating}
              onClick={() => void createAndPick(queryTrim)}
              className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-700 text-[var(--color-1)] hover:bg-gray-100 dark:hover:bg-gray-700 inline-flex items-center gap-1 disabled:opacity-50">
              <Plus size={12} /> Criar família "<strong>{queryTrim}</strong>"
            </button>
          )}
          {error && (
            <p className="px-3 py-2 text-xs text-red-500 border-t border-gray-100 dark:border-gray-700">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
