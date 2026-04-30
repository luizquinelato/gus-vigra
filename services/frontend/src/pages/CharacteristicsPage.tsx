import { Fragment, useEffect, useMemo, useState } from 'react'
import { CaretDown, CaretRight, FloppyDisk, MagnifyingGlass, Palette, Pencil, Plus, TextT, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  characteristicValuesApi, characteristicsApi,
  type CharacteristicRead, type CharacteristicType, type CharacteristicValueRead,
  type CharacteristicValueWrite, type CharacteristicWrite,
} from '../services/cadastrosApi'
import { colorNameFromHex } from '../utils/colorName'
import { DecimalInput } from '../components/ProductFormModal'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function TypeBadge({ type }: { type: CharacteristicType }) {
  const map: Record<CharacteristicType, { label: string; bg: string; fg: string; Icon: typeof TextT }> = {
    text:   { label: 'Texto',  bg: '#e0e7ff', fg: '#3730a3', Icon: TextT },
    color:  { label: 'Cor',    bg: '#fce7f3', fg: '#9d174d', Icon: Palette },
    number: { label: 'Número', bg: '#dcfce7', fg: '#166534', Icon: TextT },
  }
  const { label, bg, fg, Icon } = map[type]
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: bg, color: fg }}>
      <Icon size={11} weight="bold" /> {label}
    </span>
  )
}

function CharacteristicModal({ initial, onClose, onSaved }: { initial: CharacteristicRead | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<CharacteristicType>(initial?.type ?? 'text')
  const [saving, setSaving] = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!name.trim()) { toast.error('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      const body: CharacteristicWrite = { name: name.trim(), type }
      if (initial) await characteristicsApi.patch(initial.id, body)
      else         await characteristicsApi.create(body)
      toast.success(initial ? 'Característica atualizada.' : 'Característica criada.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: initial ? 'var(--color-edit)' : 'var(--color-create)', color: initial ? 'var(--on-color-edit)' : 'var(--on-color-create)' }}>
              {initial ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar característica' : 'Nova característica'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome<span className="text-red-500 ml-0.5">*</span></span>
            <input value={name} onChange={e => setName(e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: Cor, Tamanho, Voltagem" />
          </label>
          <div>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo</span>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(['text', 'color', 'number'] as CharacteristicType[]).map(t => (
                <button key={t} type="button" disabled={!!initial} onClick={() => setType(t)}
                  className={`px-3 py-2 text-xs rounded-lg border ${type === t ? 'border-[var(--color-1)] text-[var(--color-1)] font-semibold' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'} ${initial ? 'opacity-60 cursor-not-allowed' : 'hover:border-[var(--color-1)]'}`}>
                  {t === 'text' ? 'Texto' : t === 'color' ? 'Cor' : 'Número'}
                </button>
              ))}
            </div>
            {initial && <p className="text-[11px] text-gray-400 mt-1">O tipo não pode ser alterado após a criação. Para mudar, exclua e crie novamente.</p>}
          </div>
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

function ValueModal({ characteristic, initial, onClose, onSaved }: {
  characteristic: CharacteristicRead
  initial: CharacteristicValueRead | null
  onClose: () => void
  onSaved: () => void
}) {
  const [value, setValue] = useState(initial?.value ?? '')
  const [hex, setHex] = useState(initial?.hex_color ?? '#000000')
  const [num, setNum] = useState(initial?.numeric_value ?? '')
  const [unit, setUnit] = useState(initial?.unit ?? '')
  const [saving, setSaving] = useState(false)

  function applyHex(newHex: string) {
    setHex(newHex)
    const suggested = colorNameFromHex(newHex)
    if (suggested) setValue(suggested)
  }

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!value.trim()) { toast.error('Valor é obrigatório.'); return }
    setSaving(true)
    try {
      const body: CharacteristicValueWrite = {
        value: value.trim(),
        hex_color: characteristic.type === 'color' ? hex : null,
        numeric_value: characteristic.type === 'number' && num.trim() ? num.trim() : null,
        unit: characteristic.type === 'number' && unit.trim() ? unit.trim() : null,
      }
      if (initial) await characteristicValuesApi.patch(initial.id, body)
      else         await characteristicValuesApi.create(characteristic.id, body)
      toast.success(initial ? 'Valor atualizado.' : 'Valor criado.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar valor.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: initial ? 'var(--color-edit)' : 'var(--color-create)', color: initial ? 'var(--on-color-edit)' : 'var(--on-color-create)' }}>
              {initial ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
              {initial ? 'Editar valor' : 'Novo valor'} <span className="text-sm font-normal text-gray-500">de {characteristic.name}</span>
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Rótulo<span className="text-red-500 ml-0.5">*</span></span>
            <input value={value} onChange={e => setValue(e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: Preto, P, 220V" />
          </label>
          {characteristic.type === 'color' && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Cor</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="color" value={hex} onChange={e => applyHex(e.target.value)}
                  className="h-10 w-14 rounded border border-gray-200 dark:border-gray-600 bg-transparent cursor-pointer" />
                <input value={hex} onChange={e => applyHex(e.target.value)} className={`${fieldCls} font-mono`} placeholder="#000000" />
              </div>
            </label>
          )}
          {characteristic.type === 'number' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Valor numérico</span>
                {/* numeric_value NUMERIC(14,4) → cap em 10 dig int (DB max). */}
                <div className="mt-1">
                  <DecimalInput value={num || null} onChange={v => setNum(v ?? '')}
                    decimals={4} maxIntDigits={10} />
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Unidade</span>
                <input value={unit} onChange={e => setUnit(e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: ml, V, W" />
              </label>
            </div>
          )}
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


export default function CharacteristicsPage() {
  const [items, setItems] = useState<CharacteristicRead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<CharacteristicRead | null>(null)
  const [openChar, setOpenChar] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [valuesByChar, setValuesByChar] = useState<Map<number, CharacteristicValueRead[]>>(new Map())
  const [loadingChars, setLoadingChars] = useState<Set<number>>(new Set())
  const [valueModalChar, setValueModalChar] = useState<CharacteristicRead | null>(null)
  const [editingValue, setEditingValue] = useState<CharacteristicValueRead | null>(null)

  function reload() {
    setLoading(true)
    characteristicsApi.list({ only_active: false })
      .then(setItems)
      .catch(() => toast.error('Erro ao carregar características.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  function reloadValuesFor(id: number) {
    setLoadingChars(s => { const n = new Set(s); n.add(id); return n })
    characteristicValuesApi.listByCharacteristic(id, { only_active: false })
      .then(vs => setValuesByChar(m => { const n = new Map(m); n.set(id, vs); return n }))
      .catch(() => toast.error('Erro ao carregar valores.'))
      .finally(() => setLoadingChars(s => { const n = new Set(s); n.delete(id); return n }))
  }

  function toggleExpand(c: CharacteristicRead) {
    setExpanded(s => {
      const n = new Set(s)
      if (n.has(c.id)) { n.delete(c.id); return n }
      n.add(c.id)
      if (!valuesByChar.has(c.id)) reloadValuesFor(c.id)
      return n
    })
  }

  const filtered = useMemo(
    () => items.filter(c => c.name.toLowerCase().includes(filter.toLowerCase())),
    [items, filter],
  )

  async function handleSoftDeleteChar(c: CharacteristicRead) {
    if (!confirm(`Desativar "${c.name}"?\n\nTodos os valores ficarão indisponíveis para novos vínculos.`)) return
    try { await characteristicsApi.softDelete(c.id); toast.success('Característica desativada.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }
  async function handleSoftDeleteValue(v: CharacteristicValueRead) {
    if (!confirm(`Desativar valor "${v.value}"?`)) return
    try { await characteristicValuesApi.softDelete(v.id); toast.success('Valor desativado.'); reloadValuesFor(v.characteristic_id) }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Características</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Atributos faceted (Cor, Tamanho, Voltagem…) e seus valores. Use no editor de produto para criar variações.</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setOpenChar(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova característica
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhuma característica.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">Tipo</th>
              <th className="text-center py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
              <th className="w-20" />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((c) => {
                const isOpen = expanded.has(c.id)
                const vs = valuesByChar.get(c.id) ?? []
                const isLoadingV = loadingChars.has(c.id)
                return (
                  <Fragment key={c.id}>
                    <tr onClick={() => toggleExpand(c)}
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="py-3 pl-3 font-semibold text-gray-800 dark:text-gray-100">
                        <span className="inline-flex items-center gap-2">
                          {isOpen ? <CaretDown size={14} className="text-gray-400" /> : <CaretRight size={14} className="text-gray-400" />}
                          {c.name}
                        </span>
                      </td>
                      <td className="py-3"><TypeBadge type={c.type} /></td>
                      <td className="py-3 text-center">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: c.active ? 'var(--color-success)' : '#cbd5e1', color: c.active ? 'var(--on-color-success)' : '#475569' }}>
                          {c.active ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <button onClick={e => { e.stopPropagation(); setEditing(c); setOpenChar(true) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar"><Pencil size={16} /></button>
                        {c.active && <button onClick={e => { e.stopPropagation(); handleSoftDeleteChar(c) }} className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-1" title="Desativar"><Trash size={16} /></button>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/70 dark:bg-gray-900/30">
                        <td colSpan={4} className="px-6 pb-4 pt-2">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Valores</p>
                            <button onClick={e => { e.stopPropagation(); setValueModalChar(c); setEditingValue(null) }}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded text-[11px] font-semibold border-none"
                              style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
                              <Plus size={11} /> Novo valor
                            </button>
                          </div>
                          {isLoadingV ? <p className="text-xs text-gray-400">Carregando...</p>
                            : vs.length === 0 ? <p className="text-xs text-gray-400">Nenhum valor cadastrado.</p>
                            : (
                              <ul className="divide-y divide-gray-100 dark:divide-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800">
                                {vs.map(v => (
                                  <li key={v.id} className="flex items-center gap-3 px-3 py-2">
                                    <span className="flex-1 inline-flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                                      {c.type === 'color' && v.hex_color && (
                                        <span className="w-4 h-4 rounded border border-gray-300" style={{ background: v.hex_color }} />
                                      )}
                                      {v.value}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                      {c.type === 'color' ? (v.hex_color ?? '')
                                        : c.type === 'number' ? [v.numeric_value, v.unit].filter(Boolean).join(' ')
                                        : ''}
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: v.active ? 'var(--color-success)' : '#cbd5e1', color: v.active ? 'var(--on-color-success)' : '#475569' }}>
                                      {v.active ? 'Ativo' : 'Inativo'}
                                    </span>
                                    <button onClick={() => { setValueModalChar(c); setEditingValue(v) }} className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar"><Pencil size={14} /></button>
                                    {v.active && <button onClick={() => handleSoftDeleteValue(v)} className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Desativar"><Trash size={14} /></button>}
                                  </li>
                                ))}
                              </ul>
                            )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {openChar && <CharacteristicModal initial={editing} onClose={() => setOpenChar(false)} onSaved={() => { setOpenChar(false); reload() }} />}
      {valueModalChar && (
        <ValueModal characteristic={valueModalChar} initial={editingValue}
          onClose={() => { setValueModalChar(null); setEditingValue(null) }}
          onSaved={() => { const cid = valueModalChar.id; setValueModalChar(null); setEditingValue(null); reloadValuesFor(cid) }} />
      )}
    </div>
  )
}
