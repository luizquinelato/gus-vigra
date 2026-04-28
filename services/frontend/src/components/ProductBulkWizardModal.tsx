import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, FloppyDisk, MagicWand, Plus, Trash, Warning, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  productsBulkApi, type CategoryRead, type ProductWrite,
} from '../services/cadastrosApi'
import { slugify } from '../utils/slug'
import { FamilyCombobox } from './FamilyCombobox'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

interface Props {
  categories: CategoryRead[]
  existingFamilies: string[]
  onClose: () => void
  onSaved: () => void
}

interface Axis { name: string; values: string }                    // values é csv
interface Base { family: string; codePrefix: string; namePrefix: string; price: string; cost: string; unit: string; brand: string; category_id: number | null }

interface Row { code: string; name: string; price: string; cost: string; attributes: Record<string, string> }

function cartesian(axes: Axis[]): Record<string, string>[] {
  const cleaned = axes
    .map(a => ({ name: a.name.trim(), vals: a.values.split(',').map(v => v.trim()).filter(Boolean) }))
    .filter(a => a.name && a.vals.length > 0)
  if (cleaned.length === 0) return []
  let acc: Record<string, string>[] = [{}]
  for (const a of cleaned) {
    const next: Record<string, string>[] = []
    for (const prev of acc) for (const v of a.vals) next.push({ ...prev, [a.name]: v })
    acc = next
  }
  return acc
}

export function ProductBulkWizardModal({ categories, existingFamilies, onClose, onSaved }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [base, setBase] = useState<Base>({
    family: '', codePrefix: '', namePrefix: '', price: '0', cost: '0', unit: 'un',
    brand: '', category_id: null,
  })
  const [axes, setAxes] = useState<Axis[]>([{ name: '', values: '' }])
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)

  const combos = useMemo(() => cartesian(axes), [axes])

  const dupAxes = useMemo(() => {
    const seen = new Map<string, number>()
    axes.forEach(a => {
      const norm = a.name.trim().toLowerCase()
      if (!norm) return
      seen.set(norm, (seen.get(norm) ?? 0) + 1)
    })
    return new Set(Array.from(seen.entries()).filter(([, c]) => c > 1).map(([k]) => k))
  }, [axes])

  function buildRows() {
    if (!base.family.trim()) { toast.error('Família é obrigatória.'); return }
    if (dupAxes.size > 0) { toast.error('Há características repetidas. Renomeie ou remova as duplicatas.'); return }
    if (combos.length === 0) { toast.error('Defina ao menos uma característica com valores.'); return }
    const next: Row[] = combos.map(attrs => {
      const suffix = Object.values(attrs).map(v => v.toUpperCase().replace(/\s+/g, '')).join('-')
      const nameSuf = Object.values(attrs).join(' / ')
      return {
        code: `${base.codePrefix.trim()}${base.codePrefix.trim() ? '-' : ''}${suffix}`,
        name: `${base.namePrefix.trim()} ${nameSuf}`.trim(),
        price: base.price, cost: base.cost,
        attributes: attrs,
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
      const items: ProductWrite[] = rows.map(r => ({
        code: r.code.trim(), name: r.name.trim(), slug: slugify(`${base.family}-${r.code}`),
        family: base.family.trim(), attributes: r.attributes,
        price: r.price, cost: r.cost, unit: base.unit, type: 'simple',
        brand: base.brand.trim() || null, category_id: base.category_id,
      }))
      await productsBulkApi.create({ family: base.family.trim(), items })
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
                  <FamilyCombobox value={base.family} onChange={v => setBase(b => ({ ...b, family: v }))}
                    options={existingFamilies} placeholder="Buscar ou criar família…" />
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
              <div className="space-y-2">
                {axes.map((a, i) => {
                  const isDup = dupAxes.has(a.name.trim().toLowerCase())
                  return (
                    <div key={i} className="flex gap-2">
                      <input value={a.name} onChange={e => setAxes(xs => xs.map((x, k) => k === i ? { ...x, name: e.target.value } : x))}
                        placeholder="ex: tamanho"
                        className={`${fieldCls} w-40 ${isDup ? 'border-amber-400 dark:border-amber-500' : ''}`} />
                      <input value={a.values} onChange={e => setAxes(xs => xs.map((x, k) => k === i ? { ...x, values: e.target.value } : x))} placeholder="P, M, G (separar por vírgula)" className={fieldCls} />
                      <button type="button" onClick={() => setAxes(xs => xs.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600 px-2"><Trash size={15} /></button>
                    </div>
                  )
                })}
                <button type="button" onClick={() => setAxes(xs => [...xs, { name: '', values: '' }])} className="text-xs inline-flex items-center gap-1 text-[var(--color-1)] hover:underline">
                  <Plus size={12} /> Adicionar característica
                </button>
              </div>
              {dupAxes.size > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 inline-flex items-center gap-1 mt-2">
                  <Warning size={12} /> Características repetidas — renomeie ou remova antes de avançar.
                </p>
              )}
              <p className="text-xs text-gray-400 mt-2">Combinações geradas: <strong>{combos.length}</strong></p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Revisar e ajustar cada produto. Ao salvar, todos serão criados com a família <strong>{base.family}</strong>.
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
                        {Object.entries(r.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')}
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
