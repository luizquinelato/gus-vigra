import { useEffect, useMemo, useState } from 'react'
import { FloppyDisk, MagnifyingGlass, Pencil, Plus, Trash, X, Star } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  warehousesApi,
  type WarehouseRead, type WarehouseWrite, type WarehouseType,
} from '../services/estoqueApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'
import { useConfirm } from '../contexts/ConfirmContext'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

const TYPE_LABEL: Record<WarehouseType, string> = {
  physical: 'Físico', virtual: 'Virtual', marketplace: 'Marketplace', consignment: 'Consignado',
}

function WarehouseModal({ initial, onClose, onSaved }: { initial: WarehouseRead | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode]         = useState(initial?.code ?? '')
  const [name, setName]         = useState(initial?.name ?? '')
  const [type, setType]         = useState<WarehouseType>(initial?.type ?? 'physical')
  const [city, setCity]         = useState(initial?.city ?? '')
  const [stateUf, setStateUf]   = useState(initial?.state ?? '')
  const [zipCode, setZipCode]   = useState(initial?.zip_code ?? '')
  const [addressLine, setAddr]  = useState(initial?.address_line ?? '')
  const [isDefault, setIsDef]   = useState(initial?.is_default ?? false)
  const [notes, setNotes]       = useState(initial?.notes ?? '')
  const [saving, setSaving]     = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!code.trim() || !name.trim()) { toast.error('Código e nome são obrigatórios.'); return }
    setSaving(true)
    try {
      const body: WarehouseWrite = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        type,
        city:         city.trim()        || null,
        state:        stateUf.trim()     || null,
        zip_code:     zipCode.trim()     || null,
        address_line: addressLine.trim() || null,
        is_default:   isDefault,
        notes:        notes.trim() || null,
      }
      if (initial) await warehousesApi.patch(initial.id, body)
      else         await warehousesApi.create(body)
      toast.success(initial ? 'Depósito atualizado.' : 'Depósito criado.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar depósito.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: initial ? 'var(--color-edit)' : 'var(--color-create)', color: initial ? 'var(--on-color-edit)' : 'var(--on-color-create)' }}>
              {initial ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar depósito' : 'Novo depósito'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Código<span className="text-red-500 ml-0.5">*</span></span>
            <input value={code} onChange={e => setCode(e.target.value)} className={`${fieldCls} mt-1 uppercase`} maxLength={20} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo</span>
            <select value={type} onChange={e => setType(e.target.value as WarehouseType)} className={`${fieldCls} mt-1`}>
              {(Object.keys(TYPE_LABEL) as WarehouseType[]).map(k => (
                <option key={k} value={k}>{TYPE_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome<span className="text-red-500 ml-0.5">*</span></span>
            <input value={name} onChange={e => setName(e.target.value)} className={`${fieldCls} mt-1`} maxLength={100} />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Endereço</span>
            <input value={addressLine} onChange={e => setAddr(e.target.value)} className={`${fieldCls} mt-1`} maxLength={200} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Cidade</span>
            <input value={city} onChange={e => setCity(e.target.value)} className={`${fieldCls} mt-1`} maxLength={100} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">UF</span>
              <input value={stateUf} onChange={e => setStateUf(e.target.value.toUpperCase())} className={`${fieldCls} mt-1 uppercase`} maxLength={2} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">CEP</span>
              <input value={zipCode} onChange={e => setZipCode(e.target.value)} className={`${fieldCls} mt-1`} maxLength={10} />
            </label>
          </div>
          <label className="flex items-center gap-2 col-span-2 mt-1">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDef(e.target.checked)} className="accent-[var(--color-1)]" />
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Definir como depósito padrão</span>
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Observações</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className={`${fieldCls} mt-1 min-h-[60px]`} />
          </label>
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

export default function WarehousesPage() {
  const [items, setItems]     = useState<WarehouseRead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('')
  const [editing, setEditing] = useState<WarehouseRead | null>(null)
  const [open, setOpen]       = useState(false)
  const confirm = useConfirm()

  function reload() {
    setLoading(true)
    warehousesApi.list({ only_active: false })
      .then(setItems)
      .catch(() => toast.error('Erro ao carregar depósitos.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return items.filter(w =>
      w.code.toLowerCase().includes(q) ||
      w.name.toLowerCase().includes(q) ||
      (w.city ?? '').toLowerCase().includes(q),
    )
  }, [items, filter])

  async function handleSoftDelete(w: WarehouseRead) {
    const ok = await confirm({
      variant: 'danger',
      title:   'Desativar depósito?',
      message: <>Isto desativará <strong>{w.name}</strong>. Saldos existentes não serão removidos.</>,
      confirmLabel: 'Desativar',
    })
    if (!ok) return
    try { await warehousesApi.softDelete(w.id); toast.success('Depósito desativado.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Depósitos</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Locais físicos ou virtuais onde o estoque é mantido.</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Novo depósito
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? <p className="text-sm text-gray-400 p-6">Carregando...</p>
         : filtered.length === 0 ? <p className="text-sm text-gray-400 p-6">Nenhum depósito.</p>
         : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="w-1 p-0" aria-hidden />
                  <th className="px-3 py-3 w-12 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">#</th>
                  <th className="px-3 py-3 w-32 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Código</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Nome</th>
                  <th className="px-3 py-3 w-32 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Tipo</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Cidade/UF</th>
                  <th className="px-3 py-3 w-24 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-center">Status</th>
                  <th className="px-3 py-3 w-28 text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300 text-left">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filtered.map((w, i) => (
                  <tr key={w.id}
                    className="group hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-[inset_4px_0_0_0_#d1d5db] dark:shadow-[inset_4px_0_0_0_#4b5563]"
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = 'inset 4px 0 0 0 var(--color-1)' }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}>
                    <td className="w-1 p-0" aria-hidden />
                    <td className="px-3 py-3.5 text-left">
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{i + 1}</span>
                    </td>
                    <td className="px-3 py-3.5 font-mono text-gray-800 dark:text-gray-100">{w.code}</td>
                    <td className="px-3 py-3.5 font-semibold text-gray-800 dark:text-gray-100">
                      <div className="flex items-center gap-2">
                        {w.is_default && <Star size={14} weight="fill" className="text-amber-500" />}
                        {w.name}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400">{TYPE_LABEL[w.type as WarehouseType]}</td>
                    <td className="px-3 py-3.5 text-gray-500 dark:text-gray-400">{[w.city, w.state].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-3.5 text-center">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: w.active ? 'var(--color-success)' : '#cbd5e1', color: w.active ? 'var(--on-color-success)' : '#475569' }}>
                        {w.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <button onClick={() => { setEditing(w); setOpen(true) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar"><Pencil size={16} /></button>
                      {w.active && <button onClick={() => handleSoftDelete(w)} className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-1" title="Desativar"><Trash size={16} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && <WarehouseModal initial={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </div>
  )
}
