/**
 * CharacteristicValueCombobox.tsx
 * ===============================
 * Combobox de valores de uma characteristic. UX é específica por type:
 *   - text   → apenas label.
 *   - color  → label + color picker para hex.
 *   - number → label + numeric_value + unit (texto curto).
 *
 * Suporta busca, exibição de swatch (color) ou valor+unidade (number) na lista.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, MagnifyingGlass, Plus, Spinner, X } from '@phosphor-icons/react'
import type { CharacteristicType, CharacteristicValueRead } from '../services/cadastrosApi'

// min-h-[38px] + box-border garante altura idêntica entre o <button> fechado e
// o <div>+<input> aberto, evitando shift sub-pixel ao trocar de estado.
const fieldCls = 'w-full px-3 py-2 text-sm box-border min-h-[38px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'
const openWrapperCls = 'w-full flex items-center gap-2 box-border min-h-[38px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus-within:border-[var(--color-1)]'

interface CreateBody {
  value: string
  hex_color?: string | null
  numeric_value?: string | null
  unit?: string | null
}

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  options: CharacteristicValueRead[]
  characteristicType: CharacteristicType
  disabled?: boolean
  onCreate?: (body: CreateBody) => Promise<CharacteristicValueRead>
}

export function CharacteristicValueCombobox({
  value, onChange, options, characteristicType, disabled, onCreate,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  // Campos específicos do "draft" do novo valor:
  const [draftHex, setDraftHex] = useState('#000000')
  const [draftNum, setDraftNum] = useState('')
  const [draftUnit, setDraftUnit] = useState('')
  const [pendingCreate, setPendingCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false); setPendingCreate(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const sorted = useMemo(
    () => [...options].sort((a, b) => a.value.localeCompare(b.value)),
    [options],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sorted.filter(o => o.value.toLowerCase().includes(q)) : sorted
  }, [sorted, query])

  const queryTrim = query.trim()
  const showCreateOption = !!onCreate && queryTrim.length > 0
    && !options.some(o => o.value.toLowerCase() === queryTrim.toLowerCase())
  const selected = value != null ? options.find(o => o.id === value) ?? null : null

  function pickId(id: number | null) {
    onChange(id); setQuery(''); setError(null); setPendingCreate(false); setOpen(false)
  }

  async function doCreate() {
    if (!onCreate) return
    setCreating(true); setError(null)
    try {
      const body: CreateBody = { value: queryTrim }
      if (characteristicType === 'color') body.hex_color = draftHex
      if (characteristicType === 'number') {
        body.numeric_value = draftNum.trim() || null
        body.unit = draftUnit.trim() || null
      }
      const created = await onCreate(body)
      pickId(created.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao criar valor.')
    } finally {
      setCreating(false)
    }
  }

  function renderOptionExtra(o: CharacteristicValueRead) {
    if (characteristicType === 'color' && o.hex_color) {
      return <span className="inline-block w-4 h-4 rounded border border-gray-300 dark:border-gray-600" style={{ backgroundColor: o.hex_color }} />
    }
    if (characteristicType === 'number' && (o.numeric_value || o.unit)) {
      return <span className="text-[10px] text-gray-400">{o.numeric_value ?? ''}{o.unit ? ` ${o.unit}` : ''}</span>
    }
    return null
  }

  // Para cor, exibe "Nome — #HEX" (excessão pedida pelo usuário); demais tipos só nome.
  // items-center (não baseline) evita shift sub-pixel quando duas font-sizes
  // diferentes são alinhadas pelo baseline.
  function renderOptionLabel(o: CharacteristicValueRead) {
    if (characteristicType === 'color' && o.hex_color) {
      return (
        <span className="inline-flex items-center gap-2">
          <span>{o.value}</span>
          <span className="font-mono text-[10px] text-gray-400 uppercase">{o.hex_color}</span>
        </span>
      )
    }
    return <span>{o.value}</span>
  }

  return (
    <div ref={wrapperRef} className="relative">
      {!open ? (
        <button type="button" disabled={disabled} onClick={() => { setOpen(true); setQuery('') }}
          className={`${fieldCls} flex items-center justify-between text-left disabled:opacity-50`}>
          <span className="flex items-center gap-2">
            {selected && renderOptionExtra(selected)}
            {selected ? renderOptionLabel(selected) : <span className="text-gray-400">Valor…</span>}
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
        <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 && !showCreateOption && (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhum valor encontrado.</p>
          )}
          {filtered.map(opt => (
            <button key={opt.id} type="button" onClick={() => pickId(opt.id)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${opt.id === value ? 'font-semibold text-[var(--color-1)]' : 'text-gray-700 dark:text-gray-200'}`}>
              <span className="inline-flex items-center gap-2">{renderOptionExtra(opt)}{renderOptionLabel(opt)}</span>
            </button>
          ))}
          {showCreateOption && !pendingCreate && (
            <button type="button" disabled={creating} onClick={() => setPendingCreate(true)}
              className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-700 text-[var(--color-1)] hover:bg-gray-100 dark:hover:bg-gray-700 inline-flex items-center gap-1 disabled:opacity-50">
              <Plus size={12} /> Criar valor "<strong>{queryTrim}</strong>"…
            </button>
          )}
          {showCreateOption && pendingCreate && (
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 space-y-2">
              {characteristicType === 'color' && (
                <div className="flex items-center gap-2">
                  <input type="color" value={draftHex} onChange={e => setDraftHex(e.target.value)}
                    className="h-8 w-10 rounded border border-gray-200 dark:border-gray-600 bg-transparent" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{draftHex}</span>
                </div>
              )}
              {characteristicType === 'number' && (
                <div className="flex gap-2">
                  <input value={draftNum} onChange={e => setDraftNum(e.target.value)}
                    placeholder="Valor" inputMode="decimal" className={fieldCls} />
                  <input value={draftUnit} onChange={e => setDraftUnit(e.target.value)}
                    placeholder="Unidade (ex: ml)" className={fieldCls} />
                </div>
              )}
              <button type="button" disabled={creating} onClick={() => void doCreate()}
                className="w-full px-3 py-1.5 text-xs rounded bg-[var(--color-1)] text-white hover:opacity-90 disabled:opacity-50">
                Criar "{queryTrim}"
              </button>
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
