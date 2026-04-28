import { useEffect, useState } from 'react'
import { FloppyDisk, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  promotionsApi,
  type PromotionAppliesTo, type PromotionRead, type PromotionType, type PromotionWrite,
} from '../services/cadastrosApi'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function PromoModal({ initial, onClose, onSaved }: { initial: PromotionRead | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<PromotionWrite>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'pct_off',
    value: initial?.value ?? '0',
    min_order_amount: initial?.min_order_amount ?? null,
    min_quantity: initial?.min_quantity ?? null,
    applies_to: initial?.applies_to ?? 'all',
    coupon_code: initial?.coupon_code ?? null,
    max_uses: initial?.max_uses ?? null,
    max_uses_per_client: initial?.max_uses_per_client ?? 0,
    stackable: initial?.stackable ?? false,
    starts_at: initial?.starts_at ?? null,
    ends_at: initial?.ends_at ?? null,
  })
  const [saving, setSaving] = useState(false)

  function set<K extends keyof PromotionWrite>(k: K, v: PromotionWrite[K]) { setDraft(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!draft.name.trim()) { toast.error('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      const body: PromotionWrite = {
        ...draft,
        name: draft.name.trim(),
        coupon_code: draft.coupon_code?.toString().trim() || null,
        starts_at: draft.starts_at || null,
        ends_at: draft.ends_at || null,
      }
      if (initial) await promotionsApi.patch(initial.id, body)
      else         await promotionsApi.create(body)
      toast.success(initial ? 'Promoção atualizada.' : 'Promoção criada.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar promoção' : 'Nova promoção'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome</span>
            <input value={draft.name} onChange={e => set('name', e.target.value)} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo</span>
            <select value={draft.type} onChange={e => set('type', e.target.value as PromotionType)} className={`${fieldCls} mt-1`}>
              <option value="pct_off">% off</option>
              <option value="fixed_off">Valor fixo off</option>
              <option value="buy_x_get_y">Leve X pague Y</option>
              <option value="free_shipping">Frete grátis</option>
            </select></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Valor</span>
            <input type="number" step="0.01" value={draft.value ?? ''} onChange={e => set('value', e.target.value || null)} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Pedido mínimo (R$)</span>
            <input type="number" step="0.01" value={draft.min_order_amount ?? ''} onChange={e => set('min_order_amount', e.target.value || null)} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Qtd. mínima</span>
            <input type="number" value={draft.min_quantity ?? ''} onChange={e => set('min_quantity', e.target.value ? Number(e.target.value) : null)} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Aplica-se a</span>
            <select value={draft.applies_to ?? 'all'} onChange={e => set('applies_to', e.target.value as PromotionAppliesTo)} className={`${fieldCls} mt-1`}>
              <option value="all">Todos os produtos</option>
              <option value="product">Produtos específicos</option>
              <option value="category">Categorias específicas</option>
            </select></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Cupom (opcional)</span>
            <input value={draft.coupon_code ?? ''} onChange={e => set('coupon_code', e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: BLACK10" /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Máx. usos (total)</span>
            <input type="number" value={draft.max_uses ?? ''} onChange={e => set('max_uses', e.target.value ? Number(e.target.value) : null)} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Máx. por cliente (0 = ilimitado)</span>
            <input type="number" value={draft.max_uses_per_client ?? 0} onChange={e => set('max_uses_per_client', Number(e.target.value || 0))} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Início</span>
            <input type="datetime-local" value={draft.starts_at?.slice(0, 16) ?? ''} onChange={e => set('starts_at', e.target.value || null)} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Término</span>
            <input type="datetime-local" value={draft.ends_at?.slice(0, 16) ?? ''} onChange={e => set('ends_at', e.target.value || null)} className={`${fieldCls} mt-1`} /></label>
          <label className="flex items-center gap-2 cursor-pointer col-span-2 mt-2">
            <input type="checkbox" checked={draft.stackable ?? false} onChange={e => set('stackable', e.target.checked)} />
            <span className="text-sm text-gray-700 dark:text-gray-300">Pode ser combinada com outras promoções</span>
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

export default function PromotionsPage() {
  const [items, setItems] = useState<PromotionRead[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PromotionRead | null>(null)
  const [open, setOpen] = useState(false)

  function reload() {
    setLoading(true)
    promotionsApi.list({ only_active: false })
      .then(setItems)
      .catch(() => toast.error('Erro ao carregar promoções.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  async function handleSoftDelete(p: PromotionRead) {
    if (!confirm(`Desativar "${p.name}"?`)) return
    try { await promotionsApi.softDelete(p.id); toast.success('Promoção desativada.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Promoções</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Descontos, cupons e regras promocionais aplicáveis a pedidos.</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova promoção
        </button>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : items.length === 0 ? <p className="text-sm text-gray-400">Nenhuma promoção cadastrada.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 dark:border-gray-700">
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Tipo</th>
              <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Valor</th>
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Cupom</th>
              <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-20">Usos</th>
              <th className="text-center pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
              <th className="w-20" />
            </tr></thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={p.id} className={`hover:bg-gray-100 dark:hover:bg-gray-700/50 ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}`}>
                  <td className="py-3 pl-3 font-semibold text-gray-800 dark:text-gray-100">{p.name}</td>
                  <td className="py-3 text-gray-500 dark:text-gray-400">{p.type}</td>
                  <td className="py-3 text-right text-gray-700 dark:text-gray-200">{p.value ? Number(p.value).toFixed(2) : '—'}</td>
                  <td className="py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{p.coupon_code ?? '—'}</td>
                  <td className="py-3 text-right text-gray-500 dark:text-gray-400">{p.uses_count}{p.max_uses ? `/${p.max_uses}` : ''}</td>
                  <td className="py-3 text-center">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: p.active ? 'var(--color-success)' : '#cbd5e1', color: p.active ? 'var(--on-color-success)' : '#475569' }}>
                      {p.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button onClick={() => { setEditing(p); setOpen(true) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" title="Editar"><Pencil size={16} /></button>
                    {p.active && <button onClick={() => handleSoftDelete(p)} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Desativar"><Trash size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {open && <PromoModal initial={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </div>
  )
}
