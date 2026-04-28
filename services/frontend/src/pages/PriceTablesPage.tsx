import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FloppyDisk, Pencil, Plus, Stack, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { priceTablesApi, type PriceTableRead, type PriceTableType, type PriceTableWrite } from '../services/cadastrosApi'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function PriceTableModal({ initial, onClose, onSaved }: { initial: PriceTableRead | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<PriceTableType>(initial?.type ?? 'fixed')
  const [discountPct, setDiscountPct] = useState(initial?.discount_pct ?? '0')
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) { toast.error('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      const body: PriceTableWrite = { name: name.trim(), type, discount_pct: discountPct || '0', is_default: isDefault }
      if (initial) await priceTablesApi.patch(initial.id, body)
      else         await priceTablesApi.create(body)
      toast.success(initial ? 'Tabela atualizada.' : 'Tabela criada.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  function onChangeDiscount(v: string) {
    if (v === '') { setDiscountPct(''); return }
    const n = Number(v)
    if (Number.isNaN(n)) return
    const clamped = Math.min(100, Math.max(0, n))
    setDiscountPct(String(clamped))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar tabela' : 'Nova tabela de preço'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome</span>
            <input value={name} onChange={e => setName(e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: Atacado" /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo</span>
            <select value={type} onChange={e => setType(e.target.value as PriceTableType)} className={`${fieldCls} mt-1`}>
              <option value="fixed">Preços fixos por SKU</option>
              <option value="percentage_off">Desconto percentual sobre preço base</option>
            </select></label>
          {type === 'percentage_off' && (
            <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">% de desconto</span>
              <input type="number" step="0.01" min={0} max={100} value={discountPct}
                onChange={e => onChangeDiscount(e.target.value)} className={`${fieldCls} mt-1`} /></label>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
            <span className="text-sm text-gray-700 dark:text-gray-300">Tabela padrão (usada quando nenhuma outra é informada)</span>
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

export default function PriceTablesPage() {
  const [items, setItems] = useState<PriceTableRead[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PriceTableRead | null>(null)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  function reload() {
    setLoading(true)
    priceTablesApi.list({ only_active: false })
      .then(setItems)
      .catch(() => toast.error('Erro ao carregar tabelas.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  async function handleSoftDelete(t: PriceTableRead) {
    if (!confirm(`Desativar "${t.name}"?`)) return
    try { await priceTablesApi.softDelete(t.id); toast.success('Tabela desativada.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tabelas de Preço</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Crie políticas de preço (atacado, vip, varejo) que se aplicam aos SKUs.</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova tabela
        </button>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : items.length === 0 ? <p className="text-sm text-gray-400">Nenhuma tabela cadastrada.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 dark:border-gray-700">
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-44">Tipo</th>
              <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">Desconto</th>
              <th className="text-center pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Padrão</th>
              <th className="text-center pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
              <th className="w-32" />
            </tr></thead>
            <tbody>
              {items.map((t, i) => (
                <tr key={t.id} className={`hover:bg-gray-100 dark:hover:bg-gray-700/50 ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}`}>
                  <td className="py-3 pl-3 font-semibold text-gray-800 dark:text-gray-100">{t.name}</td>
                  <td className="py-3 text-gray-500 dark:text-gray-400">{t.type === 'fixed' ? 'Preços fixos' : '% off'}</td>
                  <td className="py-3 text-right text-gray-700 dark:text-gray-200">{t.type === 'percentage_off' ? `${Number(t.discount_pct).toFixed(2)}%` : '—'}</td>
                  <td className="py-3 text-center text-gray-500">{t.is_default ? '✓' : '—'}</td>
                  <td className="py-3 text-center">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: t.active ? 'var(--color-success)' : '#cbd5e1', color: t.active ? 'var(--on-color-success)' : '#475569' }}>
                      {t.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right whitespace-nowrap">
                    {t.type === 'fixed' && (
                      <button onClick={() => navigate(`/cadastros/tabelas-preco/${t.id}/items`)}
                        className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" title="Preços por SKU">
                        <Stack size={16} />
                      </button>
                    )}
                    <button onClick={() => { setEditing(t); setOpen(true) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 ml-1" title="Editar"><Pencil size={16} /></button>
                    {t.active && <button onClick={() => handleSoftDelete(t)} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Desativar"><Trash size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {open && <PriceTableModal initial={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </div>
  )
}
