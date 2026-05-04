import { useEffect, useMemo, useState } from 'react'
import { Eye, FloppyDisk, MagnifyingGlass, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  quotationsApi, suppliersApi,
  type QuotationRead, type QuotationItemRead, type QuotationResponseRead,
  type QuotationStatus, type SupplierRead,
} from '../services/comprasApi'
import { productsApi, type ProductRead } from '../services/cadastrosApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'
const fieldSm  = 'w-full px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

const STATUS_LABEL: Record<QuotationStatus, string> = {
  open: 'Aberta', responded: 'Respondida', approved: 'Aprovada', cancelled: 'Cancelada',
}
const STATUS_COLOR: Record<QuotationStatus, string> = {
  open: 'var(--color-info)', responded: 'var(--color-warning)', approved: 'var(--color-success)', cancelled: '#9ca3af',
}

function fmtDt(s: string | null) { return s ? new Date(s).toLocaleString('pt-BR') : '—' }

interface DraftItem { product_id: number | ''; requested_quantity: string; notes: string }
const blankItem: DraftItem = { product_id: '', requested_quantity: '1', notes: '' }

function CreateModal({ products, onClose, onSaved }: {
  products: ProductRead[]; onClose: () => void; onSaved: () => void
}) {
  const [notes, setNotes]     = useState('')
  const [expiresAt, setExp]   = useState('')
  const [items, setItems]     = useState<DraftItem[]>([{ ...blankItem }])
  const [saving, setSaving]   = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() }, enabled: !saving })

  async function handleSave() {
    const valid = items.filter(it => it.product_id && Number(it.requested_quantity) > 0)
    if (valid.length === 0) { toast.error('Adicione ao menos um item.'); return }
    setSaving(true)
    try {
      await quotationsApi.create({
        notes: notes.trim() || null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        items: valid.map(it => ({
          product_id: it.product_id as number,
          requested_quantity: it.requested_quantity,
          notes: it.notes.trim() || null,
        })),
      })
      toast.success('Cotação criada.'); onSaved()
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Erro ao criar cotação.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-create)', color: 'var(--on-color-create)' }}>
              <Plus size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Nova cotação (RFQ)</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Validade</span>
            <input type="datetime-local" value={expiresAt} onChange={e => setExp(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Observações</span>
            <input value={notes} onChange={e => setNotes(e.target.value)} className={`${fieldCls} mt-1`} maxLength={500} />
          </label>
        </div>

        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Itens</h3>
          <button onClick={() => setItems(p => [...p, { ...blankItem }])} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border-none"
            style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
            <Plus size={13} /> Adicionar
          </button>
        </div>
        <table className="w-full text-sm mb-3">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
            <th className="text-left py-2 pl-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Qtd</th>
            <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Notas</th>
            <th className="w-10" />
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1.5 pl-2">
                  <select value={it.product_id} onChange={e => setItems(p => p.map((x, i) => i === idx ? { ...x, product_id: Number(e.target.value) || '' } : x))} className={fieldSm}>
                    <option value="">Selecione…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </td>
                <td className="py-1.5"><input type="number" step="0.0001" min="0" value={it.requested_quantity}
                  onChange={e => setItems(p => p.map((x, i) => i === idx ? { ...x, requested_quantity: e.target.value } : x))}
                  className={`${fieldSm} text-right`} /></td>
                <td className="py-1.5"><input value={it.notes}
                  onChange={e => setItems(p => p.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))}
                  className={fieldSm} /></td>
                <td className="py-1.5 pr-1 text-right">
                  <button onClick={() => setItems(p => p.filter((_, i) => i !== idx))} disabled={items.length === 1} className="p-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30">
                    <Trash size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Criar cotação
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailsModal({ quotation, suppliers, products, onClose, onChanged }: {
  quotation: QuotationRead
  suppliers: SupplierRead[]
  products: ProductRead[]
  onClose: () => void
  onChanged: () => void
}) {
  const [items, setItems]         = useState<QuotationItemRead[]>([])
  const [responses, setResponses] = useState<QuotationResponseRead[]>([])
  const [loading, setLoading]     = useState(true)
  const [respSupplier, setSupplier] = useState<number | ''>('')
  const [respPrice, setRespPrice]   = useState('')
  const [respDays, setRespDays]     = useState('')
  const [respTerms, setRespTerms]   = useState('')
  const [respNotes, setRespNotes]   = useState('')
  const [saving, setSaving]         = useState(false)

  function reload() {
    setLoading(true)
    Promise.all([
      quotationsApi.listItems(quotation.id),
      quotationsApi.listResponses(quotation.id),
    ])
      .then(([its, rs]) => { setItems(its); setResponses(rs) })
      .catch(() => toast.error('Erro ao carregar cotação.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [quotation.id])

  const productById  = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])

  async function addResponse() {
    if (!respSupplier) { toast.error('Selecione um fornecedor.'); return }
    setSaving(true)
    try {
      await quotationsApi.addResponse(quotation.id, {
        supplier_id: Number(respSupplier),
        unit_price: respPrice || null,
        delivery_days: respDays ? Number(respDays) : null,
        payment_terms: respTerms.trim() || null,
        notes: respNotes.trim() || null,
      })
      toast.success('Resposta registrada.')
      setSupplier(''); setRespPrice(''); setRespDays(''); setRespTerms(''); setRespNotes('')
      reload(); onChanged()
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Erro ao registrar resposta.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ background: STATUS_COLOR[quotation.status], color: 'white' }}>
              <Eye size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Cotação #{quotation.id}</h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: STATUS_COLOR[quotation.status], color: 'white' }}>
                {STATUS_LABEL[quotation.status]}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div><span className="text-xs text-gray-500">Criada</span><div className="font-semibold text-gray-800 dark:text-gray-100">{fmtDt(quotation.created_at)}</div></div>
          <div><span className="text-xs text-gray-500">Validade</span><div className="font-semibold text-gray-800 dark:text-gray-100">{fmtDt(quotation.expires_at)}</div></div>
        </div>

        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">Itens solicitados</h3>
        {loading ? <p className="text-sm text-gray-400">Carregando…</p> : (
          <table className="w-full text-sm mb-4">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Qtd</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Notas</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map(it => {
                const p = productById.get(it.product_id)
                return (
                  <tr key={it.id}>
                    <td className="py-2 pl-2 text-gray-700 dark:text-gray-200">{p ? `${p.code} — ${p.name}` : `#${it.product_id}`}</td>
                    <td className="py-2 text-right font-mono">{Number(it.requested_quantity).toLocaleString('pt-BR')}</td>
                    <td className="py-2 text-gray-500 text-[12px]">{it.notes ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">Respostas dos fornecedores</h3>
        {responses.length === 0 ? <p className="text-sm text-gray-400 mb-3">Nenhuma resposta ainda.</p> : (
          <table className="w-full text-sm mb-4">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Fornecedor</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Preço</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Prazo</th>
              <th className="text-left py-2 pl-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Pagamento</th>
              <th className="text-left py-2 pl-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Notas</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {responses.map(r => (
                <tr key={r.id}>
                  <td className="py-2 pl-2 text-gray-700 dark:text-gray-200">{supplierById.get(r.supplier_id)?.name ?? `#${r.supplier_id}`}</td>
                  <td className="py-2 text-right font-mono">{r.unit_price ? Number(r.unit_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
                  <td className="py-2 text-right font-mono">{r.delivery_days ? `${r.delivery_days}d` : '—'}</td>
                  <td className="py-2 pl-2 text-gray-500 text-[12px]">{r.payment_terms ?? '—'}</td>
                  <td className="py-2 pl-2 text-gray-500 text-[12px]">{r.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {quotation.status !== 'cancelled' && quotation.status !== 'approved' && (
          <div className="border-t pt-4 border-gray-200 dark:border-gray-700">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">Adicionar resposta</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <select value={respSupplier} onChange={e => setSupplier(e.target.value ? Number(e.target.value) : '')} className={`${fieldSm} col-span-2`}>
                <option value="">Fornecedor…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input type="number" step="0.01" min="0" placeholder="Preço unit." value={respPrice} onChange={e => setRespPrice(e.target.value)} className={`${fieldSm} text-right`} />
              <input type="number" min="0" placeholder="Prazo (dias)" value={respDays} onChange={e => setRespDays(e.target.value)} className={`${fieldSm} text-right`} />
              <button onClick={addResponse} disabled={saving} className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border-none"
                style={{ background: 'var(--color-1)', color: 'var(--on-color-1)', opacity: saving ? 0.6 : 1 }}>
                <Plus size={12} /> Adicionar
              </button>
              <input placeholder="Pagamento" value={respTerms} onChange={e => setRespTerms(e.target.value)} className={`${fieldSm} col-span-2`} />
              <input placeholder="Notas" value={respNotes} onChange={e => setRespNotes(e.target.value)} className={`${fieldSm} col-span-3`} />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-cancel)' }}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

export default function QuotationsPage() {
  const [items, setItems]         = useState<QuotationRead[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRead[]>([])
  const [products, setProducts]   = useState<ProductRead[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('')
  const [statusFilter, setStatus] = useState<QuotationStatus | ''>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [details, setDetails]     = useState<QuotationRead | null>(null)

  function reload() {
    setLoading(true)
    Promise.all([
      quotationsApi.list(),
      suppliersApi.list({ only_active: true }),
      productsApi.list({ only_active: true, limit: 500 }),
    ])
      .then(([q, s, p]) => { setItems(q); setSuppliers(s); setProducts(p) })
      .catch(() => toast.error('Erro ao carregar cotações.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return items.filter(i => {
      if (statusFilter && i.status !== statusFilter) return false
      if (!q) return true
      return String(i.id).includes(q) || (i.notes ?? '').toLowerCase().includes(q)
    })
  }, [items, filter, statusFilter])

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Cotações (RFQ)</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Solicite preços a múltiplos fornecedores e compare propostas.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-[240px]">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Filtrar por id ou observações…" value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
        </div>
        <select value={statusFilter} onChange={e => setStatus(e.target.value as QuotationStatus | '')} className={`${fieldCls} max-w-[200px]`}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as QuotationStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova cotação
        </button>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        {loading ? <p className="text-sm text-gray-400">Carregando…</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhuma cotação.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">ID</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Criada</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Validade</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Observações</th>
              <th className="text-center py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Status</th>
              <th className="w-16" />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(q => (
                <tr key={q.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer" onClick={() => setDetails(q)}>
                  <td className="py-3 pl-3 font-mono font-semibold text-gray-800 dark:text-gray-100">#{q.id}</td>
                  <td className="py-3 text-gray-500 dark:text-gray-400 text-[12px]">{fmtDt(q.created_at)}</td>
                  <td className="py-3 text-gray-500 dark:text-gray-400 text-[12px]">{fmtDt(q.expires_at)}</td>
                  <td className="py-3 text-gray-600 dark:text-gray-300 text-[12px] truncate max-w-[300px]">{q.notes ?? '—'}</td>
                  <td className="py-3 text-center">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: STATUS_COLOR[q.status], color: 'white' }}>
                      {STATUS_LABEL[q.status]}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button onClick={e => { e.stopPropagation(); setDetails(q) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Detalhes"><Eye size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {createOpen && <CreateModal products={products} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
      {details && <DetailsModal quotation={details} suppliers={suppliers} products={products}
        onClose={() => setDetails(null)} onChanged={reload} />}
    </div>
  )
}
