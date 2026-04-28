import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, FloppyDisk, MagicWand, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  characteristicValuesApi, characteristicsApi, productsBulkApi,
  type CategoryRead, type CharacteristicRead, type CharacteristicType,
  type CharacteristicValueRead, type FamilyRead, type ProductBulkItem,
} from '../services/cadastrosApi'
import { slugify } from '../utils/slug'
import { CharacteristicCombobox } from './CharacteristicCombobox'
import { CharacteristicValueCombobox } from './CharacteristicValueCombobox'
import { FamilyCombobox } from './FamilyCombobox'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

interface Props {
  categories: CategoryRead[]
  families: FamilyRead[]
  characteristics: CharacteristicRead[]
  onFamilyCreated?: (created: FamilyRead) => void
  onCharacteristicCreated?: (created: CharacteristicRead) => void
  onClose: () => void
  onSaved: () => void
}

// Eixo da combinatória: characteristic + N valores (ids do catálogo).
interface Axis { characteristic_id: number | null; value_ids: number[] }

interface Base {
  family_id: number | null; codePrefix: string; namePrefix: string
  price: string; cost: string; unit: string; brand: string; category_id: number | null
}

interface Row {
  code: string; name: string; price: string; cost: string
  // Cada combinação: { characteristic_id, value_id } pré-resolvido para o backend.
  links: Array<{ characteristic_id: number; value_id: number }>
  // Cache de labels para exibir na revisão.
  labels: string[]
}

function cartesian(axes: Axis[]): Array<Array<{ characteristic_id: number; value_id: number }>> {
  const cleaned = axes.filter(a => a.characteristic_id != null && a.value_ids.length > 0)
  if (cleaned.length === 0) return []
  let acc: Array<Array<{ characteristic_id: number; value_id: number }>> = [[]]
  for (const a of cleaned) {
    const next: Array<Array<{ characteristic_id: number; value_id: number }>> = []
    for (const prev of acc) {
      for (const vid of a.value_ids) {
        next.push([...prev, { characteristic_id: a.characteristic_id!, value_id: vid }])
      }
    }
    acc = next
  }
  return acc
}

export function ProductBulkWizardModal({
  categories, families, characteristics,
  onFamilyCreated, onCharacteristicCreated, onClose, onSaved,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [base, setBase] = useState<Base>({
    family_id: null, codePrefix: '', namePrefix: '', price: '0', cost: '0', unit: 'un',
    brand: '', category_id: null,
  })
  const [axes, setAxes] = useState<Axis[]>([{ characteristic_id: null, value_ids: [] }])
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  // Cache de valores por characteristic_id (compartilhado entre axes).
  const [valuesCache, setValuesCache] = useState<Record<number, CharacteristicValueRead[]>>({})

  async function ensureValuesLoaded(characteristicId: number) {
    if (valuesCache[characteristicId]) return
    try {
      const list = await characteristicValuesApi.listByCharacteristic(characteristicId, { only_active: true })
      setValuesCache(prev => ({ ...prev, [characteristicId]: list }))
    } catch { /* silencioso */ }
  }

  useEffect(() => {
    axes.forEach(a => { if (a.characteristic_id != null) void ensureValuesLoaded(a.characteristic_id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usedCharIds = useMemo(
    () => new Set(axes.map(a => a.characteristic_id).filter((v): v is number => v != null)),
    [axes],
  )

  const familyName = base.family_id != null
    ? families.find(f => f.id === base.family_id)?.name ?? ''
    : ''

  const combos = useMemo(() => cartesian(axes), [axes])

  function setAxisCharacteristic(idx: number, charId: number | null) {
    if (charId != null) {
      const dupIdx = axes.findIndex((a, i) => i !== idx && a.characteristic_id === charId)
      if (dupIdx !== -1) {
        toast.info('Característica já adicionada — linha removida.')
        setAxes(prev => prev.filter((_, i) => i !== idx))
        return
      }
      void ensureValuesLoaded(charId)
    }
    setAxes(prev => prev.map((a, i) => i === idx ? { characteristic_id: charId, value_ids: [] } : a))
  }
  function addAxisValue(idx: number, valueId: number | null) {
    if (valueId == null) return
    setAxes(prev => prev.map((a, i) => {
      if (i !== idx) return a
      if (a.value_ids.includes(valueId)) return a
      return { ...a, value_ids: [...a.value_ids, valueId] }
    }))
  }
  function removeAxisValue(idx: number, valueId: number) {
    setAxes(prev => prev.map((a, i) => i === idx ? { ...a, value_ids: a.value_ids.filter(v => v !== valueId) } : a))
  }

  async function createCharacteristic(name: string, type: CharacteristicType) {
    const created = await characteristicsApi.create({ name, type })
    onCharacteristicCreated?.(created)
    return created
  }
  async function createValue(charId: number, body: { value: string; hex_color?: string | null; numeric_value?: string | null; unit?: string | null }) {
    const created = await characteristicValuesApi.create(charId, body)
    setValuesCache(prev => ({ ...prev, [charId]: [...(prev[charId] ?? []), created] }))
    return created
  }

  function buildRows() {
    if (base.family_id == null) { toast.error('Família é obrigatória.'); return }
    if (combos.length === 0) { toast.error('Defina ao menos uma característica com valores.'); return }
    const next: Row[] = combos.map(combo => {
      const labels = combo.map(({ characteristic_id, value_id }) => {
        const c = characteristics.find(x => x.id === characteristic_id)
        const v = valuesCache[characteristic_id]?.find(x => x.id === value_id)
        return `${c?.name ?? '?'}: ${v?.value ?? '?'}`
      })
      const codeSuffix = combo.map(({ value_id }) => {
        const allValues = Object.values(valuesCache).flat()
        const v = allValues.find(x => x.id === value_id)
        return (v?.value ?? '').toUpperCase().replace(/\s+/g, '')
      }).filter(Boolean).join('-')
      const nameSuffix = combo.map(({ value_id }) => {
        const allValues = Object.values(valuesCache).flat()
        return allValues.find(x => x.id === value_id)?.value ?? ''
      }).filter(Boolean).join(' / ')
      return {
        code: `${base.codePrefix.trim()}${base.codePrefix.trim() ? '-' : ''}${codeSuffix}`,
        name: `${base.namePrefix.trim()} ${nameSuffix}`.trim(),
        price: base.price, cost: base.cost,
        links: combo, labels,
      }
    })
    setRows(next); setStep(2)
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows(rs => rs.map((r, k) => k === i ? { ...r, ...patch } : r))
  }
  function removeRow(i: number) { setRows(rs => rs.filter((_, k) => k !== i)) }

  async function handleSave() {
    if (rows.length === 0) { toast.error('Nenhum produto para criar.'); return }
    if (rows.some(r => !r.code.trim() || !r.name.trim())) { toast.error('Todos precisam de código e nome.'); return }
    setSaving(true)
    try {
      const items: ProductBulkItem[] = rows.map(r => ({
        code: r.code.trim(), name: r.name.trim(),
        slug: slugify(`${familyName}-${r.code}`),
        family_id: base.family_id, characteristics: r.links,
        price: r.price, cost: r.cost, unit: base.unit, type: 'simple',
        brand: base.brand.trim() || null, category_id: base.category_id,
      }))
      await productsBulkApi.create({ family_id: base.family_id, items })
      toast.success(`${items.length} produtos criados.`)
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao criar produtos.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 inline-flex items-center gap-2">
            <MagicWand size={18} /> Wizard de combinações {step === 2 && <span className="text-xs text-gray-400 font-normal">· revisar</span>}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Família</span>
                <div className="mt-1">
                  <FamilyCombobox value={base.family_id}
                    onChange={id => setBase(b => ({ ...b, family_id: id }))}
                    options={families} onCreated={onFamilyCreated}
                    placeholder="Buscar ou criar família…" />
                </div>
              </div>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Prefixo do código</span>
                <input value={base.codePrefix} onChange={e => setBase(b => ({ ...b, codePrefix: e.target.value }))} className={`${fieldCls} mt-1`} placeholder="ex: CAFE" /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Prefixo do nome</span>
                <input value={base.namePrefix} onChange={e => setBase(b => ({ ...b, namePrefix: e.target.value }))} className={`${fieldCls} mt-1`} placeholder="ex: Café Especial" /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Preço base</span>
                <input type="number" step="0.01" value={base.price} onChange={e => setBase(b => ({ ...b, price: e.target.value }))} className={`${fieldCls} mt-1`} /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Custo base</span>
                <input type="number" step="0.01" value={base.cost} onChange={e => setBase(b => ({ ...b, cost: e.target.value }))} className={`${fieldCls} mt-1`} /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Unidade</span>
                <input value={base.unit} onChange={e => setBase(b => ({ ...b, unit: e.target.value }))} className={`${fieldCls} mt-1`} /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Categoria</span>
                <select value={base.category_id ?? ''} onChange={e => setBase(b => ({ ...b, category_id: e.target.value === '' ? null : Number(e.target.value) }))} className={`${fieldCls} mt-1`}>
                  <option value="">— Sem categoria —</option>
                  {categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
              <label className="block col-span-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Marca</span>
                <input value={base.brand} onChange={e => setBase(b => ({ ...b, brand: e.target.value }))} className={`${fieldCls} mt-1`} /></label>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Características (eixos da combinatória)</p>
              <div className="space-y-3">
                {axes.map((a, i) => {
                  const charType = a.characteristic_id != null
                    ? (characteristics.find(c => c.id === a.characteristic_id)?.type as CharacteristicType | undefined)
                    : undefined
                  const cachedValues = a.characteristic_id != null ? (valuesCache[a.characteristic_id] ?? []) : []
                  const remainingValues = cachedValues.filter(v => !a.value_ids.includes(v.id))
                  return (
                    <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <CharacteristicCombobox value={a.characteristic_id}
                            onChange={id => setAxisCharacteristic(i, id)}
                            options={characteristics}
                            excludeIds={Array.from(usedCharIds).filter(id => id !== a.characteristic_id)}
                            onCreate={createCharacteristic} />
                        </div>
                        <button type="button" onClick={() => setAxes(xs => xs.filter((_, k) => k !== i))}
                          className="text-gray-400 hover:text-red-600 px-2"><Trash size={15} /></button>
                      </div>
                      {a.characteristic_id != null && (
                        <>
                          <div className="flex flex-wrap gap-1">
                            {a.value_ids.map(vid => {
                              const v = cachedValues.find(x => x.id === vid)
                              return (
                                <span key={vid} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                  {charType === 'color' && v?.hex_color && (
                                    <span className="inline-block w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600" style={{ backgroundColor: v.hex_color }} />
                                  )}
                                  {v?.value ?? `#${vid}`}
                                  {charType === 'number' && v?.unit && <span className="text-gray-400">{v.unit}</span>}
                                  <button type="button" onClick={() => removeAxisValue(i, vid)} className="text-gray-400 hover:text-red-500"><X size={10} /></button>
                                </span>
                              )
                            })}
                            {a.value_ids.length === 0 && (
                              <span className="text-[11px] text-gray-400">Nenhum valor selecionado.</span>
                            )}
                          </div>
                          <CharacteristicValueCombobox value={null}
                            onChange={vid => addAxisValue(i, vid)}
                            options={remainingValues}
                            characteristicType={charType ?? 'text'}
                            onCreate={body => createValue(a.characteristic_id!, body)} />
                        </>
                      )}
                    </div>
                  )
                })}
                <button type="button" onClick={() => setAxes(xs => [...xs, { characteristic_id: null, value_ids: [] }])}
                  className="text-xs inline-flex items-center gap-1 text-[var(--color-1)] hover:underline">
                  <Plus size={12} /> Adicionar característica
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">Combinações geradas: <strong>{combos.length}</strong></p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Revisar e ajustar cada produto. Ao salvar, todos serão criados com a família <strong>{familyName || `#${base.family_id}`}</strong>.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Características</th>
                  <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-40">Código</th>
                  <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
                  <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Preço</th>
                  <th className="w-10" />
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}>
                      <td className="py-2 pl-2 text-xs text-gray-500 dark:text-gray-400">
                        {r.labels.join(', ')}
                      </td>
                      <td className="py-2"><input value={r.code} onChange={e => updateRow(i, { code: e.target.value })} className={`${fieldCls} text-xs font-mono`} /></td>
                      <td className="py-2"><input value={r.name} onChange={e => updateRow(i, { name: e.target.value })} className={`${fieldCls} text-xs`} /></td>
                      <td className="py-2"><input type="number" step="0.01" value={r.price} onChange={e => updateRow(i, { price: e.target.value })} className={`${fieldCls} text-xs text-right`} /></td>
                      <td className="py-2 text-right pr-2"><button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-600"><Trash size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 mt-6">
          {step === 2 ? (
            <button onClick={() => setStep(1)} className="inline-flex items-center gap-1 px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
              <ArrowLeft size={14} /> Voltar
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancelar</button>
            {step === 1 ? (
              <button onClick={buildRows}
                className="inline-flex items-center gap-1 px-5 py-2 rounded-lg text-sm font-semibold border-none"
                style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
                Avançar <ArrowRight size={14} />
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
                style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
                <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Criar {rows.length} produtos
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
