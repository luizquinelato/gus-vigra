import { useEffect, useMemo, useState } from 'react'
import { FloppyDisk, MagnifyingGlass, Palette, Pencil, Plus, TextT, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  characteristicValuesApi, characteristicsApi,
  type CharacteristicRead, type CharacteristicType, type CharacteristicValueRead,
  type CharacteristicValueWrite, type CharacteristicWrite,
} from '../services/cadastrosApi'

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
  const [sortOrder, setSortOrder] = useState<string>(String(initial?.sort_order ?? 0))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) { toast.error('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      const body: CharacteristicWrite = { name: name.trim(), type, sort_order: Number(sortOrder) || 0 }
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
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar característica' : 'Nova característica'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome</span>
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
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Ordem</span>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
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
  const [sortOrder, setSortOrder] = useState<string>(String(initial?.sort_order ?? 0))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!value.trim()) { toast.error('Valor é obrigatório.'); return }
    setSaving(true)
    try {
      const body: CharacteristicValueWrite = {
        value: value.trim(),
        hex_color: characteristic.type === 'color' ? hex : null,
        numeric_value: characteristic.type === 'number' && num.trim() ? num.trim() : null,
        unit: characteristic.type === 'number' && unit.trim() ? unit.trim() : null,
        sort_order: Number(sortOrder) || 0,
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
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
            {initial ? 'Editar valor' : 'Novo valor'} <span className="text-sm font-normal text-gray-500">de {characteristic.name}</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Rótulo</span>
            <input value={value} onChange={e => setValue(e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: Preto, P, 220V" />
          </label>
          {characteristic.type === 'color' && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Cor</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="color" value={hex} onChange={e => setHex(e.target.value)}
                  className="h-10 w-14 rounded border border-gray-200 dark:border-gray-600 bg-transparent cursor-pointer" />
                <input value={hex} onChange={e => setHex(e.target.value)} className={`${fieldCls} font-mono`} placeholder="#000000" />
              </div>
            </label>
          )}
          {characteristic.type === 'number' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Valor numérico</span>
                <input value={num} onChange={e => setNum(e.target.value)} inputMode="decimal" className={`${fieldCls} mt-1`} placeholder="ex: 250" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Unidade</span>
                <input value={unit} onChange={e => setUnit(e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: ml, V, W" />
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Ordem</span>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
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
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [values, setValues] = useState<CharacteristicValueRead[]>([])
  const [loadingValues, setLoadingValues] = useState(false)
  const [editingValue, setEditingValue] = useState<CharacteristicValueRead | null>(null)
  const [openValue, setOpenValue] = useState(false)

  function reload() {
    setLoading(true)
    characteristicsApi.list({ only_active: false })
      .then(setItems)
      .catch(() => toast.error('Erro ao carregar características.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  function reloadValues(id: number) {
    setLoadingValues(true)
    characteristicValuesApi.listByCharacteristic(id, { only_active: false })
      .then(setValues)
      .catch(() => toast.error('Erro ao carregar valores.'))
      .finally(() => setLoadingValues(false))
  }
  useEffect(() => { if (selectedId != null) reloadValues(selectedId); else setValues([]) }, [selectedId])

  const filtered = useMemo(
    () => items.filter(c => c.name.toLowerCase().includes(filter.toLowerCase())),
    [items, filter],
  )

  const selected = useMemo(() => items.find(c => c.id === selectedId) ?? null, [items, selectedId])

  async function handleSoftDeleteChar(c: CharacteristicRead) {
    if (!confirm(`Desativar "${c.name}"?\n\nTodos os valores ficarão indisponíveis para novos vínculos.`)) return
    try { await characteristicsApi.softDelete(c.id); toast.success('Característica desativada.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }
  async function handleSoftDeleteValue(v: CharacteristicValueRead) {
    if (!confirm(`Desativar valor "${v.value}"?`)) return
    try { await characteristicValuesApi.softDelete(v.id); toast.success('Valor desativado.'); if (selectedId != null) reloadValues(selectedId) }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Características</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Atributos faceted (Cor, Tamanho, Voltagem…) e seus valores. Use no editor de produto para criar variações.</p>
        </div>
        <button onClick={() => { setEditing(null); setOpenChar(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova característica
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhuma característica.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 dark:border-gray-700">
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">Tipo</th>
              <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Ordem</th>
              <th className="text-center pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
              <th className="w-20" />
            </tr></thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`cursor-pointer ${selectedId === c.id ? 'bg-[var(--color-1)]/10' : i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''} hover:bg-gray-100 dark:hover:bg-gray-700/50`}>
                  <td className="py-3 pl-3 font-semibold text-gray-800 dark:text-gray-100">{c.name}</td>
                  <td className="py-3"><TypeBadge type={c.type} /></td>
                  <td className="py-3 text-right text-gray-500 dark:text-gray-400">{c.sort_order}</td>
                  <td className="py-3 text-center">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: c.active ? 'var(--color-success)' : '#cbd5e1', color: c.active ? 'var(--on-color-success)' : '#475569' }}>
                      {c.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button onClick={e => { e.stopPropagation(); setEditing(c); setOpenChar(true) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" title="Editar"><Pencil size={16} /></button>
                    {c.active && <button onClick={e => { e.stopPropagation(); handleSoftDeleteChar(c) }} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Desativar"><Trash size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && (
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Valores de {selected.name}</h2>
              <TypeBadge type={selected.type} />
            </div>
            <button onClick={() => { setEditingValue(null); setOpenValue(true) }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold border-none"
              style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
              <Plus size={13} /> Novo valor
            </button>
          </div>
          {loadingValues ? <p className="text-sm text-gray-400">Carregando...</p> : values.length === 0 ? <p className="text-sm text-gray-400">Nenhum valor cadastrado.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 dark:border-gray-700">
                <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Rótulo</th>
                <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Detalhes</th>
                <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Ordem</th>
                <th className="text-center pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
                <th className="w-20" />
              </tr></thead>
              <tbody>
                {values.map((v, i) => (
                  <tr key={v.id} className={`hover:bg-gray-100 dark:hover:bg-gray-700/50 ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}`}>
                    <td className="py-3 pl-3">
                      <span className="inline-flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
                        {selected.type === 'color' && v.hex_color && (
                          <span className="w-4 h-4 rounded border border-gray-300" style={{ background: v.hex_color }} />
                        )}
                        {v.value}
                      </span>
                    </td>
                    <td className="py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">
                      {selected.type === 'color' ? (v.hex_color ?? '—')
                        : selected.type === 'number' ? [v.numeric_value, v.unit].filter(Boolean).join(' ') || '—'
                        : '—'}
                    </td>
                    <td className="py-3 text-right text-gray-500 dark:text-gray-400">{v.sort_order}</td>
                    <td className="py-3 text-center">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: v.active ? 'var(--color-success)' : '#cbd5e1', color: v.active ? 'var(--on-color-success)' : '#475569' }}>
                        {v.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <button onClick={() => { setEditingValue(v); setOpenValue(true) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" title="Editar"><Pencil size={16} /></button>
                      {v.active && <button onClick={() => handleSoftDeleteValue(v)} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Desativar"><Trash size={16} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {openChar && <CharacteristicModal initial={editing} onClose={() => setOpenChar(false)} onSaved={() => { setOpenChar(false); reload() }} />}
      {openValue && selected && (
        <ValueModal characteristic={selected} initial={editingValue}
          onClose={() => setOpenValue(false)}
          onSaved={() => { setOpenValue(false); if (selectedId != null) reloadValues(selectedId) }} />
      )}
    </div>
  )
}
