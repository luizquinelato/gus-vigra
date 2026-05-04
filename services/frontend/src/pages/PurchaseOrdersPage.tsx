import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Eye, MagnifyingGlass, PaperPlaneTilt, Plus, Prohibit, Truck, X, FloppyDisk, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  purchaseOrdersApi, suppliersApi,
  type PurchaseOrderRead, type PurchaseOrderItemRead, type PurchaseOrderStatus,
  type PurchaseOrderWrite, type PurchaseOrderItemWrite,
  type PurchaseReceiptRead, type PurchaseReceiptItemWrite,
  type SupplierRead,
} from '../services/comprasApi'
import { warehousesApi, type WarehouseRead } from '../services/estoqueApi'
import { productsApi, type ProductRead } from '../services/cadastrosApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'
import { useConfirm } from '../contexts/ConfirmContext'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'
const fieldSm  = 'w-full px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Rascunho', pending_approval: 'Aguardando aprovação', approved: 'Aprovado', sent: 'Enviado',
  partial_received: 'Recebido parcial', received: 'Recebido', cancelled: 'Cancelado',
}
const STATUS_COLOR: Record<PurchaseOrderStatus, string> = {
  draft: '#9ca3af', pending_approval: 'var(--color-warning)', approved: 'var(--color-info)', sent: '#6366f1',
  partial_received: 'var(--color-warning)', received: 'var(--color-success)', cancelled: 'var(--color-danger)',
}

function fmtBRL(n: string | null) {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtDt(s: string | null) { return s ? new Date(s).toLocaleDateString('pt-BR') : '—' }

interface DraftItem { product_id: number | ''; quantity_ordered: string; unit_cost: string; discount_pct: string }
const blankItem: DraftItem = { product_id: '', quantity_ordered: '1', unit_cost: '0', discount_pct: '0' }

function CreateModal({ suppliers, warehouses, products, onClose, onSaved }: {
  suppliers: SupplierRead[]; warehouses: WarehouseRead[]; products: ProductRead[]
  onClose: () => void; onSaved: () => void
}) {
  const [supplierId, setSupplierId]     = useState<number | ''>('')
  const [warehouseId, setWarehouseId]   = useState<number | ''>(warehouses.find(w => w.is_default)?.id ?? '')
  const [paymentTerms, setPaymentTerms] = useState('30')
  const [expDate, setExpDate]           = useState('')
  const [discountAmt, setDiscountAmt]   = useState('0')
  const [shippingAmt, setShippingAmt]   = useState('0')
  const [notes, setNotes]               = useState('')
  const [items, setItems]               = useState<DraftItem[]>([{ ...blankItem }])
  const [saving, setSaving]             = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() }, enabled: !saving })

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  function selectProduct(idx: number, pid: number) {
    const p = productById.get(pid)
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, product_id: pid, unit_cost: p?.cost && Number(p.cost) > 0 ? p.cost : it.unit_cost } : it))
  }

  async function handleSave() {
    if (!supplierId || !warehouseId) { toast.error('Fornecedor e depósito são obrigatórios.'); return }
    const valid = items.filter(it => it.product_id && Number(it.quantity_ordered) > 0)
    if (valid.length === 0) { toast.error('Adicione ao menos um item.'); return }

    const payload: PurchaseOrderWrite = {
      supplier_id: Number(supplierId),
      warehouse_id: Number(warehouseId),
      payment_terms_days: paymentTerms ? Number(paymentTerms) : null,
      expected_delivery_date: expDate || null,
      discount_amount: discountAmt || '0',
      shipping_amount: shippingAmt || '0',
      notes: notes.trim() || null,
      items: valid.map<PurchaseOrderItemWrite>(it => ({
        product_id: it.product_id as number,
        quantity_ordered: it.quantity_ordered,
        unit_cost: it.unit_cost || '0',
        discount_pct: it.discount_pct || '0',
      })),
    }
    setSaving(true)
    try {
      const po = await purchaseOrdersApi.create(payload)
      toast.success(`Pedido ${po.po_number} criado (${STATUS_LABEL[po.status as PurchaseOrderStatus]}).`)
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao criar pedido.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-create)', color: 'var(--on-color-create)' }}>
              <Plus size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Novo pedido de compra</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Fornecedor<span className="text-red-500 ml-0.5">*</span></span>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Depósito<span className="text-red-500 ml-0.5">*</span></span>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
              <option value="">Selecione…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Prazo (dias)</span>
            <input type="number" min="0" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Entrega prevista</span>
            <input type="date" value={expDate} onChange={e => setExpDate(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Desconto (R$)</span>
            <input type="number" step="0.01" min="0" value={discountAmt} onChange={e => setDiscountAmt(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Frete (R$)</span>
            <input type="number" step="0.01" min="0" value={shippingAmt} onChange={e => setShippingAmt(e.target.value)} className={`${fieldCls} mt-1`} />
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
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Qtd</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">Custo unit.</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Desc. %</th>
            <th className="w-10" />
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1.5 pl-2">
                  <select value={it.product_id} onChange={e => selectProduct(idx, Number(e.target.value))} className={fieldSm}>
                    <option value="">Selecione…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </td>
                <td className="py-1.5"><input type="number" step="0.0001" min="0" value={it.quantity_ordered} onChange={e => setItems(p => p.map((x, i) => i === idx ? { ...x, quantity_ordered: e.target.value } : x))} className={`${fieldSm} text-right`} /></td>
                <td className="py-1.5"><input type="number" step="0.01" min="0" value={it.unit_cost} onChange={e => setItems(p => p.map((x, i) => i === idx ? { ...x, unit_cost: e.target.value } : x))} className={`${fieldSm} text-right`} /></td>
                <td className="py-1.5"><input type="number" step="0.01" min="0" max="100" value={it.discount_pct} onChange={e => setItems(p => p.map((x, i) => i === idx ? { ...x, discount_pct: e.target.value } : x))} className={`${fieldSm} text-right`} /></td>
                <td className="py-1.5 pr-1 text-right">
                  <button onClick={() => setItems(p => p.filter((_, i) => i !== idx))} disabled={items.length === 1} className="p-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30">
                    <Trash size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <label className="block mb-3">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Observações</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className={`${fieldCls} mt-1 min-h-[50px]`} />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Criar pedido
          </button>
        </div>
      </div>
    </div>
  )
}

function ReceiveModal({ po, items, onClose, onSaved }: {
  po: PurchaseOrderRead
  items: PurchaseOrderItemRead[]
  onClose: () => void
  onSaved: () => void
}) {
  const [invoiceNumber, setInvoiceNum] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [notes, setNotes]             = useState('')
  const [qtys, setQtys] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    items.forEach(it => {
      const pending = Number(it.quantity_ordered) - Number(it.quantity_received)
      init[it.id] = pending > 0 ? String(pending) : '0'
    })
    return init
  })
  const [saving, setSaving] = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() }, enabled: !saving })

  async function handleSave() {
    const payload: PurchaseReceiptItemWrite[] = items
      .filter(it => Number(qtys[it.id] ?? '0') > 0)
      .map(it => ({
        purchase_order_item_id: it.id,
        product_id: it.product_id,
        warehouse_id: it.warehouse_id ?? po.warehouse_id,
        quantity_received: qtys[it.id],
        unit_cost: it.unit_cost,
      }))
    if (payload.length === 0) { toast.error('Informe ao menos uma quantidade.'); return }
    setSaving(true)
    try {
      await purchaseOrdersApi.createReceipt(po.id, {
        invoice_number: invoiceNumber.trim() || null,
        invoice_date:   invoiceDate || null,
        notes:          notes.trim() || null,
        items:          payload,
      })
      toast.success('Recebimento registrado.'); onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao receber mercadoria.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-success)', color: 'var(--on-color-success)' }}>
              <Truck size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Receber mercadoria — {po.po_number}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nº da nota</span>
            <input value={invoiceNumber} onChange={e => setInvoiceNum(e.target.value)} className={`${fieldCls} mt-1`} maxLength={50} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Data da nota</span>
            <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
        </div>

        <table className="w-full text-sm mb-3">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
            <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Pedido</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Recebido</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Pendente</th>
            <th className="text-right py-2 pr-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">A receber</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map(it => {
              const pending = Number(it.quantity_ordered) - Number(it.quantity_received)
              return (
                <tr key={it.id}>
                  <td className="py-2 pl-3 text-gray-700 dark:text-gray-200">#{it.product_id}</td>
                  <td className="py-2 text-right font-mono">{Number(it.quantity_ordered).toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-right font-mono">{Number(it.quantity_received).toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-right font-mono">{pending.toLocaleString('pt-BR')}</td>
                  <td className="py-2 pr-3">
                    <input type="number" step="0.0001" min="0" max={pending} value={qtys[it.id] ?? '0'}
                      onChange={e => setQtys(prev => ({ ...prev, [it.id]: e.target.value }))}
                      disabled={pending <= 0}
                      className={`${fieldSm} text-right`} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <label className="block mb-3">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Observações</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className={`${fieldCls} mt-1 min-h-[50px]`} />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-success)', color: 'var(--on-color-success)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <Truck size={15} className={saving ? 'animate-spin' : undefined} /> Confirmar recebimento
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailsModal({ po, suppliers, warehouses, onClose, onChanged, onReceive }: {
  po: PurchaseOrderRead
  suppliers: SupplierRead[]
  warehouses: WarehouseRead[]
  onClose: () => void
  onChanged: () => void
  onReceive: (items: PurchaseOrderItemRead[]) => void
}) {
  const [items, setItems]       = useState<PurchaseOrderItemRead[]>([])
  const [receipts, setReceipts] = useState<PurchaseReceiptRead[]>([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const confirm = useConfirm()

  function reload() {
    setLoading(true)
    Promise.all([
      purchaseOrdersApi.listItems(po.id),
      purchaseOrdersApi.listReceipts(po.id),
    ])
      .then(([its, rcps]) => { setItems(its); setReceipts(rcps) })
      .catch(() => toast.error('Erro ao carregar pedido.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [po.id])

  const supplier  = suppliers.find(s => s.id === po.supplier_id)
  const warehouse = warehouses.find(w => w.id === po.warehouse_id)
  const canApprove = po.status === 'pending_approval'
  const canSend    = po.status === 'approved'
  const canCancel  = ['draft', 'pending_approval', 'approved', 'sent'].includes(po.status)
  const canReceive = ['approved', 'sent', 'partial_received'].includes(po.status)

  async function doApprove() {
    setBusy(true)
    try { await purchaseOrdersApi.approve(po.id); toast.success('Pedido aprovado.'); onChanged() }
    catch (e: unknown) { toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Erro ao aprovar.') }
    finally { setBusy(false) }
  }
  async function doSend() {
    setBusy(true)
    try { await purchaseOrdersApi.send(po.id); toast.success('Pedido enviado ao fornecedor.'); onChanged() }
    catch (e: unknown) { toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Erro ao enviar.') }
    finally { setBusy(false) }
  }
  async function doCancel() {
    const reason = window.prompt('Motivo do cancelamento:')
    if (!reason || !reason.trim()) return
    const ok = await confirm({ variant: 'danger', title: 'Cancelar pedido?', message: 'Esta ação não pode ser desfeita.', confirmLabel: 'Cancelar pedido' })
    if (!ok) return
    setBusy(true)
    try { await purchaseOrdersApi.cancel(po.id, reason.trim()); toast.success('Pedido cancelado.'); onChanged() }
    catch (e: unknown) { toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Erro ao cancelar.') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ background: STATUS_COLOR[po.status], color: 'white' }}>
              <Eye size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{po.po_number}</h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: STATUS_COLOR[po.status], color: 'white' }}>
                {STATUS_LABEL[po.status]}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
          <div><span className="text-xs text-gray-500">Fornecedor</span><div className="font-semibold text-gray-800 dark:text-gray-100">{supplier?.name ?? `#${po.supplier_id}`}</div></div>
          <div><span className="text-xs text-gray-500">Depósito</span><div className="font-semibold text-gray-800 dark:text-gray-100">{warehouse?.name ?? `#${po.warehouse_id}`}</div></div>
          <div><span className="text-xs text-gray-500">Entrega prevista</span><div className="font-semibold text-gray-800 dark:text-gray-100">{fmtDt(po.expected_delivery_date)}</div></div>
          <div><span className="text-xs text-gray-500">Total</span><div className="font-semibold font-mono text-gray-800 dark:text-gray-100">{fmtBRL(po.total_amount)}</div></div>
        </div>

        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">Itens</h3>
        {loading ? <p className="text-sm text-gray-400">Carregando…</p> : (
          <table className="w-full text-sm mb-4">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Qtd</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Recebido</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Custo</th>
              <th className="text-right py-2 pr-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Total</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map(it => (
                <tr key={it.id}>
                  <td className="py-2 pl-2 text-gray-700 dark:text-gray-200">#{it.product_id}</td>
                  <td className="py-2 text-right font-mono">{Number(it.quantity_ordered).toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-right font-mono">{Number(it.quantity_received).toLocaleString('pt-BR')}</td>
                  <td className="py-2 text-right font-mono">{fmtBRL(it.unit_cost)}</td>
                  <td className="py-2 pr-2 text-right font-mono">{fmtBRL(it.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {receipts.length > 0 && (
          <>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">Recebimentos</h3>
            <ul className="text-sm space-y-1 mb-4">
              {receipts.map(r => (
                <li key={r.id} className="flex justify-between border-b border-gray-100 dark:border-gray-700 py-1">
                  <span>{fmtDt(r.received_at)} {r.invoice_number && `— NF ${r.invoice_number}`}</span>
                  <span className="text-gray-500">{r.notes ?? ''}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex justify-end gap-2 flex-wrap pt-3 border-t border-gray-200 dark:border-gray-700">
          {canCancel && (
            <button onClick={doCancel} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border-none"
              style={{ background: 'var(--color-danger)', color: 'var(--on-color-danger)', opacity: busy ? 0.6 : 1 }}>
              <Prohibit size={14} /> Cancelar pedido
            </button>
          )}
          {canApprove && (
            <button onClick={doApprove} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border-none"
              style={{ background: 'var(--color-info)', color: 'var(--on-color-info)', opacity: busy ? 0.6 : 1 }}>
              <CheckCircle size={14} /> Aprovar
            </button>
          )}
          {canSend && (
            <button onClick={doSend} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border-none"
              style={{ background: '#6366f1', color: 'white', opacity: busy ? 0.6 : 1 }}>
              <PaperPlaneTilt size={14} /> Marcar enviado
            </button>
          )}
          {canReceive && (
            <button onClick={() => onReceive(items)} disabled={busy || items.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border-none"
              style={{ background: 'var(--color-success)', color: 'var(--on-color-success)', opacity: (busy || items.length === 0) ? 0.6 : 1 }}>
              <Truck size={14} /> Receber mercadoria
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-cancel)' }}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders]         = useState<PurchaseOrderRead[]>([])
  const [suppliers, setSuppliers]   = useState<SupplierRead[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRead[]>([])
  const [products, setProducts]     = useState<ProductRead[]>([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('')
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailsPo, setDetailsPo]   = useState<PurchaseOrderRead | null>(null)
  const [receiveCtx, setReceiveCtx] = useState<{ po: PurchaseOrderRead; items: PurchaseOrderItemRead[] } | null>(null)

  function reload() {
    setLoading(true)
    Promise.all([
      purchaseOrdersApi.list({ only_active: false }),
      suppliersApi.list({ only_active: true }),
      warehousesApi.list({ only_active: true }),
      productsApi.list({ only_active: true, limit: 500 }),
    ])
      .then(([o, s, w, p]) => { setOrders(o); setSuppliers(s); setWarehouses(w); setProducts(p) })
      .catch(() => toast.error('Erro ao carregar pedidos.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return orders.filter(o => {
      if (statusFilter && o.status !== statusFilter) return false
      if (!q) return true
      const sup = supplierById.get(o.supplier_id)
      return o.po_number.toLowerCase().includes(q) || (sup?.name ?? '').toLowerCase().includes(q)
    })
  }, [orders, filter, statusFilter, supplierById])

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Pedidos de Compra</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gerencie pedidos, aprovações e recebimentos.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-[240px]">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Filtrar por número ou fornecedor…" value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as PurchaseOrderStatus | '')} className={`${fieldCls} max-w-[220px]`}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as PurchaseOrderStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Novo pedido
        </button>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        {loading ? <p className="text-sm text-gray-400">Carregando…</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhum pedido.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Número</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Fornecedor</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Criado</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Total</th>
              <th className="text-center py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-40">Status</th>
              <th className="w-16" />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(po => (
                <tr key={po.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer" onClick={() => setDetailsPo(po)}>
                  <td className="py-3 pl-3 font-mono font-semibold text-gray-800 dark:text-gray-100">{po.po_number}</td>
                  <td className="py-3 text-gray-600 dark:text-gray-300">{supplierById.get(po.supplier_id)?.name ?? `#${po.supplier_id}`}</td>
                  <td className="py-3 text-gray-500 dark:text-gray-400 text-[12px]">{fmtDt(po.created_at)}</td>
                  <td className="py-3 text-right font-mono text-gray-800 dark:text-gray-100">{fmtBRL(po.total_amount)}</td>
                  <td className="py-3 text-center">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: STATUS_COLOR[po.status], color: 'white' }}>
                      {STATUS_LABEL[po.status]}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button onClick={e => { e.stopPropagation(); setDetailsPo(po) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Detalhes"><Eye size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {createOpen && <CreateModal suppliers={suppliers} warehouses={warehouses} products={products}
        onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload() }} />}
      {detailsPo && !receiveCtx && <DetailsModal po={detailsPo} suppliers={suppliers} warehouses={warehouses}
        onClose={() => setDetailsPo(null)}
        onChanged={() => { setDetailsPo(null); reload() }}
        onReceive={items => setReceiveCtx({ po: detailsPo, items })} />}
      {receiveCtx && <ReceiveModal po={receiveCtx.po} items={receiveCtx.items}
        onClose={() => setReceiveCtx(null)}
        onSaved={() => { setReceiveCtx(null); setDetailsPo(null); reload() }} />}
    </div>
  )
}
