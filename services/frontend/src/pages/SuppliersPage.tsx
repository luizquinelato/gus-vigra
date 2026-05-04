import { useEffect, useMemo, useState } from 'react'
import { FloppyDisk, MagnifyingGlass, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  suppliersApi,
  type SupplierRead, type SupplierWrite, type SupplierType,
} from '../services/comprasApi'
import { warehousesApi, type WarehouseRead } from '../services/estoqueApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'
import { useConfirm } from '../contexts/ConfirmContext'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function fmtDoc(doc: string) {
  const d = doc.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc
}

function SupplierModal({ initial, warehouses, onClose, onSaved }: {
  initial: SupplierRead | null
  warehouses: WarehouseRead[]
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType]                   = useState<SupplierType>(initial?.type ?? 'pj')
  const [name, setName]                   = useState(initial?.name ?? '')
  const [tradeName, setTradeName]         = useState(initial?.trade_name ?? '')
  const [document, setDocument]           = useState(initial?.document ?? '')
  const [email, setEmail]                 = useState(initial?.email ?? '')
  const [phone, setPhone]                 = useState(initial?.phone ?? '')
  const [paymentTerms, setPaymentTerms]   = useState(initial?.payment_terms_days?.toString() ?? '30')
  const [discountPct, setDiscountPct]     = useState(initial?.discount_pct ?? '0')
  const [defaultWh, setDefaultWh]         = useState<number | ''>(initial?.default_warehouse_id ?? '')
  const [notes, setNotes]                 = useState(initial?.notes ?? '')
  const [saving, setSaving]               = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!name.trim() || !document.trim()) { toast.error('Nome e documento são obrigatórios.'); return }
    setSaving(true)
    try {
      const body: SupplierWrite = {
        type, name: name.trim(), trade_name: tradeName.trim() || null,
        document: document.replace(/\D/g, ''),
        email: email.trim() || null, phone: phone.trim() || null,
        payment_terms_days: paymentTerms ? Number(paymentTerms) : null,
        discount_pct: discountPct || '0',
        default_warehouse_id: defaultWh ? Number(defaultWh) : null,
        notes: notes.trim() || null,
      }
      if (initial) await suppliersApi.patch(initial.id, body)
      else         await suppliersApi.create(body)
      toast.success(initial ? 'Fornecedor atualizado.' : 'Fornecedor criado.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar fornecedor.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: initial ? 'var(--color-edit)' : 'var(--color-create)', color: initial ? 'var(--on-color-edit)' : 'var(--on-color-create)' }}>
              {initial ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo</span>
            <select value={type} onChange={e => setType(e.target.value as SupplierType)} className={`${fieldCls} mt-1`}>
              <option value="pj">Pessoa jurídica</option>
              <option value="pf">Pessoa física</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{type === 'pj' ? 'CNPJ' : 'CPF'}<span className="text-red-500 ml-0.5">*</span></span>
            <input value={document} onChange={e => setDocument(e.target.value)} className={`${fieldCls} mt-1`} maxLength={18} />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{type === 'pj' ? 'Razão social' : 'Nome'}<span className="text-red-500 ml-0.5">*</span></span>
            <input value={name} onChange={e => setName(e.target.value)} className={`${fieldCls} mt-1`} maxLength={200} />
          </label>
          {type === 'pj' && (
            <label className="block col-span-2">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome fantasia</span>
              <input value={tradeName} onChange={e => setTradeName(e.target.value)} className={`${fieldCls} mt-1`} maxLength={200} />
            </label>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">E-mail</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={`${fieldCls} mt-1`} maxLength={200} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Telefone</span>
            <input value={phone} onChange={e => setPhone(e.target.value)} className={`${fieldCls} mt-1`} maxLength={20} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Prazo padrão (dias)</span>
            <input type="number" min="0" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Desconto padrão (%)</span>
            <input type="number" step="0.01" min="0" max="100" value={discountPct} onChange={e => setDiscountPct(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Depósito padrão</span>
            <select value={defaultWh} onChange={e => setDefaultWh(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">— nenhum —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
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

export default function SuppliersPage() {
  const [items, setItems]           = useState<SupplierRead[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRead[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('')
  const [editing, setEditing]       = useState<SupplierRead | null>(null)
  const [open, setOpen]             = useState(false)
  const confirm = useConfirm()

  function reload() {
    setLoading(true)
    Promise.all([
      suppliersApi.list({ only_active: false }),
      warehousesApi.list({ only_active: true }),
    ])
      .then(([s, w]) => { setItems(s); setWarehouses(w) })
      .catch(() => toast.error('Erro ao carregar fornecedores.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return items.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.trade_name ?? '').toLowerCase().includes(q) ||
      s.document.includes(q.replace(/\D/g, '')),
    )
  }, [items, filter])

  async function handleSoftDelete(s: SupplierRead) {
    const ok = await confirm({
      variant: 'danger',
      title: 'Desativar fornecedor?',
      message: <>Isto desativará <strong>{s.name}</strong>. Pedidos existentes serão preservados.</>,
      confirmLabel: 'Desativar',
    })
    if (!ok) return
    try { await suppliersApi.softDelete(s.id); toast.success('Fornecedor desativado.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Fornecedores</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Cadastro de fornecedores para pedidos de compra.</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Novo fornecedor
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar por nome ou documento…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhum fornecedor.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Documento</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Contato</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Prazo</th>
              <th className="text-center py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
              <th className="w-20" />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="py-3 pl-3 font-semibold text-gray-800 dark:text-gray-100">
                    {s.name}
                    {s.trade_name && <span className="block text-[11px] font-normal text-gray-500">{s.trade_name}</span>}
                  </td>
                  <td className="py-3 font-mono text-gray-500 dark:text-gray-400">{fmtDoc(s.document)}</td>
                  <td className="py-3 text-gray-500 dark:text-gray-400 text-[12px]">
                    {s.email && <div>{s.email}</div>}
                    {s.phone && <div>{s.phone}</div>}
                    {!s.email && !s.phone && '—'}
                  </td>
                  <td className="py-3 text-right font-mono text-gray-500 dark:text-gray-400">{s.payment_terms_days ?? '—'}d</td>
                  <td className="py-3 text-center">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: s.active ? 'var(--color-success)' : '#cbd5e1', color: s.active ? 'var(--on-color-success)' : '#475569' }}>
                      {s.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button onClick={() => { setEditing(s); setOpen(true) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar"><Pencil size={16} /></button>
                    {s.active && <button onClick={() => handleSoftDelete(s)} className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-1" title="Desativar"><Trash size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {open && <SupplierModal initial={editing} warehouses={warehouses} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </div>
  )
}
