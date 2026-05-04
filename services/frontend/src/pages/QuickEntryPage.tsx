import { useEffect, useMemo, useState } from 'react'
import { Lightning, Plus, Trash, FloppyDisk } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  quickEntryApi, suppliersApi,
  type QuickEntryItem, type SupplierRead,
} from '../services/comprasApi'
import { warehousesApi, type WarehouseRead } from '../services/estoqueApi'
import { productsApi, type ProductRead } from '../services/cadastrosApi'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'
const fieldSm  = 'w-full px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

interface DraftItem { product_id: number | ''; quantity: string; unit_cost: string; discount_pct: string }

const blank: DraftItem = { product_id: '', quantity: '1', unit_cost: '0', discount_pct: '0' }

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function QuickEntryPage() {
  // Cabeçalho
  const [supplierMode, setSupplierMode] = useState<'existing' | 'new'>('existing')
  const [supplierId, setSupplierId]     = useState<number | ''>('')
  const [supplierDoc, setSupplierDoc]   = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [warehouseId, setWarehouseId]   = useState<number | ''>('')
  const [invoiceNumber, setInvoiceNum]  = useState('')
  const [invoiceDate, setInvoiceDate]   = useState('')
  const [paymentTerms, setPaymentTerms] = useState('30')
  const [discountAmt, setDiscountAmt]   = useState('0')
  const [shippingAmt, setShippingAmt]   = useState('0')
  const [notes, setNotes]               = useState('')
  // Itens
  const [items, setItems] = useState<DraftItem[]>([{ ...blank }])

  const [suppliers, setSuppliers]   = useState<SupplierRead[]>([])
  const [products, setProducts]     = useState<ProductRead[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRead[]>([])
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    Promise.all([
      suppliersApi.list({ only_active: true }),
      productsApi.list({ only_active: true, limit: 500 }),
      warehousesApi.list({ only_active: true }),
    ])
      .then(([s, p, w]) => {
        setSuppliers(s); setProducts(p); setWarehouses(w)
        const def = w.find(x => x.is_default) ?? w[0]
        if (def) setWarehouseId(def.id)
      })
      .catch(() => toast.error('Erro ao carregar dados.'))
  }, [])

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  const totals = useMemo(() => {
    let subtotal = 0
    items.forEach(it => {
      const q  = Number(it.quantity)   || 0
      const uc = Number(it.unit_cost)  || 0
      const dp = Number(it.discount_pct) || 0
      subtotal += q * uc * (1 - dp / 100)
    })
    const da = Number(discountAmt) || 0
    const sa = Number(shippingAmt) || 0
    const total = Math.max(0, subtotal - da + sa)
    return { subtotal, total }
  }, [items, discountAmt, shippingAmt])

  function setItem(idx: number, patch: Partial<DraftItem>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  function addItem() { setItems(prev => [...prev, { ...blank }]) }
  function removeItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  // Auto-preenche custo unitário com o cost do produto ao selecionar
  function selectProduct(idx: number, pid: number) {
    const p = productById.get(pid)
    setItem(idx, {
      product_id: pid,
      unit_cost: p?.cost && Number(p.cost) > 0 ? p.cost : items[idx].unit_cost,
    })
  }

  async function handleSubmit() {
    if (supplierMode === 'existing' && !supplierId) { toast.error('Selecione um fornecedor.'); return }
    if (supplierMode === 'new' && (!supplierDoc.trim() || !supplierName.trim())) {
      toast.error('Documento e nome do novo fornecedor são obrigatórios.'); return
    }
    if (!warehouseId) { toast.error('Selecione um depósito.'); return }
    const validItems = items.filter(it => it.product_id && Number(it.quantity) > 0)
    if (validItems.length === 0) { toast.error('Adicione pelo menos um item válido.'); return }

    const payloadItems: QuickEntryItem[] = validItems.map(it => ({
      product_id:   it.product_id as number,
      quantity:     it.quantity,
      unit_cost:    it.unit_cost || '0',
      discount_pct: it.discount_pct || '0',
    }))

    setSaving(true)
    try {
      const result = await quickEntryApi.create({
        supplier_id:        supplierMode === 'existing' ? Number(supplierId) : null,
        supplier_document:  supplierMode === 'new' ? supplierDoc.replace(/\D/g, '') : null,
        supplier_name:      supplierMode === 'new' ? supplierName.trim() : null,
        warehouse_id:       Number(warehouseId),
        invoice_number:     invoiceNumber.trim() || null,
        invoice_date:       invoiceDate || null,
        payment_terms_days: paymentTerms ? Number(paymentTerms) : null,
        notes:              notes.trim() || null,
        discount_amount:    discountAmt || '0',
        shipping_amount:    shippingAmt || '0',
        items:              payloadItems,
      })
      toast.success(`Entrada ${result.po_number} registrada — total ${fmtBRL(Number(result.total_amount))}.`)
      // Reset estado
      setItems([{ ...blank }])
      setInvoiceNum(''); setInvoiceDate(''); setNotes('')
      setDiscountAmt('0'); setShippingAmt('0')
      setSupplierDoc(''); setSupplierName('')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao registrar entrada.')
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-warning)', color: 'var(--on-color-warning)' }}>
          <Lightning size={22} weight="fill" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Entrada Rápida</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Lance a nota de entrada em um único formulário — gera pedido aprovado, recibo e atualiza estoque automaticamente.
          </p>
        </div>
      </div>

      {/* Cabeçalho */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Fornecedor</h2>
        <div className="flex gap-2">
          <button onClick={() => setSupplierMode('existing')}
            className="px-4 py-2 rounded-lg text-sm font-semibold border"
            style={{
              background: supplierMode === 'existing' ? 'var(--color-1)' : 'transparent',
              color:      supplierMode === 'existing' ? 'var(--on-color-1)' : 'inherit',
              borderColor: supplierMode === 'existing' ? 'var(--color-1)' : 'rgb(229,231,235)',
            }}>Existente</button>
          <button onClick={() => setSupplierMode('new')}
            className="px-4 py-2 rounded-lg text-sm font-semibold border"
            style={{
              background: supplierMode === 'new' ? 'var(--color-1)' : 'transparent',
              color:      supplierMode === 'new' ? 'var(--on-color-1)' : 'inherit',
              borderColor: supplierMode === 'new' ? 'var(--color-1)' : 'rgb(229,231,235)',
            }}>Novo (auto-criar)</button>
        </div>
        {supplierMode === 'existing' ? (
          <select value={supplierId} onChange={e => setSupplierId(e.target.value ? Number(e.target.value) : '')} className={fieldCls}>
            <option value="">Selecione…</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.document})</option>)}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">CPF / CNPJ<span className="text-red-500 ml-0.5">*</span></span>
              <input value={supplierDoc} onChange={e => setSupplierDoc(e.target.value)} className={`${fieldCls} mt-1`} maxLength={18} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome / Razão social<span className="text-red-500 ml-0.5">*</span></span>
              <input value={supplierName} onChange={e => setSupplierName(e.target.value)} className={`${fieldCls} mt-1`} maxLength={200} />
            </label>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 col-span-2">
              Se o documento ainda não existir no cadastro, um fornecedor stub será criado automaticamente.
            </p>
          </div>
        )}
      </section>

      {/* Nota / Depósito */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Depósito<span className="text-red-500 ml-0.5">*</span></span>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value ? Number(e.target.value) : '')} className={`${fieldCls} mt-1`}>
            <option value="">Selecione…</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}{w.is_default && ' (padrão)'}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nº da nota</span>
          <input value={invoiceNumber} onChange={e => setInvoiceNum(e.target.value)} className={`${fieldCls} mt-1`} maxLength={50} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Data da nota</span>
          <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={`${fieldCls} mt-1`} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Prazo (dias)</span>
          <input type="number" min="0" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className={`${fieldCls} mt-1`} />
        </label>
      </section>

      {/* Itens */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Itens</h2>
          <button onClick={addItem} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border-none"
            style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
            <Plus size={13} /> Adicionar item
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
            <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Qtd</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Custo unit.</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Desc. %</th>
            <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Subtotal</th>
            <th className="w-12" />
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((it, idx) => {
              const q  = Number(it.quantity) || 0
              const uc = Number(it.unit_cost) || 0
              const dp = Number(it.discount_pct) || 0
              const sub = q * uc * (1 - dp / 100)
              return (
                <tr key={idx}>
                  <td className="py-2 pl-3">
                    <select value={it.product_id} onChange={e => selectProduct(idx, Number(e.target.value))} className={fieldSm}>
                      <option value="">Selecione…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </select>
                  </td>
                  <td className="py-2"><input type="number" step="0.0001" min="0" value={it.quantity}    onChange={e => setItem(idx, { quantity: e.target.value })}    className={`${fieldSm} text-right`} /></td>
                  <td className="py-2"><input type="number" step="0.01"   min="0" value={it.unit_cost}   onChange={e => setItem(idx, { unit_cost: e.target.value })}   className={`${fieldSm} text-right`} /></td>
                  <td className="py-2"><input type="number" step="0.01"   min="0" max="100" value={it.discount_pct} onChange={e => setItem(idx, { discount_pct: e.target.value })} className={`${fieldSm} text-right`} /></td>
                  <td className="py-2 text-right font-mono text-gray-800 dark:text-gray-100">{fmtBRL(sub)}</td>
                  <td className="py-2 pr-3 text-right">
                    <button onClick={() => removeItem(idx)} disabled={items.length === 1} className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30" title="Remover">
                      <Trash size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Totais + finalizar */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="grid grid-cols-2 gap-3 md:col-span-2">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Desconto (R$)</span>
            <input type="number" step="0.01" min="0" value={discountAmt} onChange={e => setDiscountAmt(e.target.value)} className={`${fieldCls} mt-1 text-right`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Frete (R$)</span>
            <input type="number" step="0.01" min="0" value={shippingAmt} onChange={e => setShippingAmt(e.target.value)} className={`${fieldCls} mt-1 text-right`} />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Observações</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className={`${fieldCls} mt-1 min-h-[60px]`} />
          </label>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-4 space-y-1">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
              <span>Subtotal</span><span className="font-mono">{fmtBRL(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>– desconto + frete</span>
              <span className="font-mono">{fmtBRL((Number(shippingAmt) || 0) - (Number(discountAmt) || 0))}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-gray-800 dark:text-gray-100 border-t pt-1 mt-1 border-gray-200 dark:border-gray-700">
              <span>Total</span><span className="font-mono">{fmtBRL(totals.total)}</span>
            </div>
          </div>
          <button onClick={handleSubmit} disabled={saving}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-success)', color: 'var(--on-color-success)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={16} className={saving ? 'animate-spin' : undefined} /> Registrar entrada
          </button>
        </div>
      </section>
    </div>
  )
}
