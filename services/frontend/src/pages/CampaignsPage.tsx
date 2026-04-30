import { useEffect, useState } from 'react'
import { FloppyDisk, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  campaignsApi, promotionsApi,
  type CampaignChannel, type CampaignRead, type CampaignStatus, type CampaignType, type CampaignWrite,
  type PromotionRead,
} from '../services/cadastrosApi'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function CampaignModal({ initial, promotions, onClose, onSaved }: {
  initial: CampaignRead | null; promotions: PromotionRead[]; onClose: () => void; onSaved: () => void
}) {
  const [draft, setDraft] = useState<CampaignWrite>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'launch',
    channel: initial?.channel ?? 'whatsapp',
    status: initial?.status ?? 'draft',
    scheduled_at: initial?.scheduled_at ?? null,
    promotion_id: initial?.promotion_id ?? null,
    segment_id: initial?.segment_id ?? null,
    created_by_agent: initial?.created_by_agent ?? false,
  })
  const [saving, setSaving] = useState(false)

  function set<K extends keyof CampaignWrite>(k: K, v: CampaignWrite[K]) { setDraft(p => ({ ...p, [k]: v })) }

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!draft.name.trim()) { toast.error('Nome é obrigatório.'); return }
    setSaving(true)
    try {
      const body: CampaignWrite = {
        ...draft,
        name: draft.name.trim(),
        scheduled_at: draft.scheduled_at || null,
      }
      if (initial) await campaignsApi.patch(initial.id, body)
      else         await campaignsApi.create(body)
      toast.success(initial ? 'Campanha atualizada.' : 'Campanha criada.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: initial ? 'var(--color-edit)' : 'var(--color-create)', color: initial ? 'var(--on-color-edit)' : 'var(--on-color-create)' }}>
              {initial ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar campanha' : 'Nova campanha'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome<span className="text-red-500 ml-0.5">*</span></span>
            <input value={draft.name} onChange={e => set('name', e.target.value)} className={`${fieldCls} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Tipo</span>
            <select value={draft.type} onChange={e => set('type', e.target.value as CampaignType)} className={`${fieldCls} mt-1`}>
              <option value="launch">Lançamento</option>
              <option value="sale">Liquidação</option>
              <option value="reactivation">Reativação</option>
              <option value="seasonal">Sazonal</option>
            </select></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Canal</span>
            <select value={draft.channel} onChange={e => set('channel', e.target.value as CampaignChannel)} className={`${fieldCls} mt-1`}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="marketplace">Marketplace</option>
              <option value="store">Loja física</option>
            </select></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Status</span>
            <select value={draft.status ?? 'draft'} onChange={e => set('status', e.target.value as CampaignStatus)} className={`${fieldCls} mt-1`}>
              <option value="draft">Rascunho</option>
              <option value="scheduled">Agendada</option>
              <option value="running">Executando</option>
              <option value="done">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </select></label>
          <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Agendar para</span>
            <input type="datetime-local" value={draft.scheduled_at?.slice(0, 16) ?? ''} onChange={e => set('scheduled_at', e.target.value || null)} className={`${fieldCls} mt-1`} /></label>
          <label className="block col-span-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Promoção vinculada</span>
            <select value={draft.promotion_id ?? ''} onChange={e => set('promotion_id', e.target.value === '' ? null : Number(e.target.value))} className={`${fieldCls} mt-1`}>
              <option value="">— Sem promoção —</option>
              {promotions.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}{p.coupon_code ? ` (${p.coupon_code})` : ''}</option>)}
            </select></label>
          <label className="flex items-center gap-2 cursor-pointer col-span-2 mt-2">
            <input type="checkbox" checked={draft.created_by_agent ?? false} onChange={e => set('created_by_agent', e.target.checked)} />
            <span className="text-sm text-gray-700 dark:text-gray-300">Criada por agente IA</span>
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

const STATUS_COLORS: Record<CampaignStatus, { bg: string; fg: string }> = {
  draft:     { bg: '#e2e8f0', fg: '#475569' },
  scheduled: { bg: '#fef3c7', fg: '#92400e' },
  running:   { bg: 'var(--color-1)', fg: 'var(--on-color-1)' },
  done:      { bg: 'var(--color-success)', fg: 'var(--on-color-success)' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' },
}

export default function CampaignsPage() {
  const [items, setItems] = useState<CampaignRead[]>([])
  const [promotions, setPromotions] = useState<PromotionRead[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CampaignRead | null>(null)
  const [open, setOpen] = useState(false)

  function reload() {
    setLoading(true)
    Promise.all([
      campaignsApi.list({ only_active: false, limit: 200 }),
      promotionsApi.list({ only_active: false }),
    ])
      .then(([c, p]) => { setItems(c); setPromotions(p) })
      .catch(() => toast.error('Erro ao carregar campanhas.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  async function handleSoftDelete(c: CampaignRead) {
    if (!confirm(`Desativar "${c.name}"?`)) return
    try { await campaignsApi.softDelete(c.id); toast.success('Campanha desativada.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Campanhas</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Ações de marketing por canal (WhatsApp, e-mail, marketplace).</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova campanha
        </button>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : items.length === 0 ? <p className="text-sm text-gray-400">Nenhuma campanha cadastrada.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">Tipo</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Canal</th>
              <th className="text-center py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-28">Status</th>
              <th className="text-right py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Conv.</th>
              <th className="w-20" />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {items.map((c) => {
                const sc = STATUS_COLORS[c.status]
                return (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="py-3 pl-3">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">{c.name}</p>
                      {c.created_by_agent && <p className="text-[10px] text-gray-400">criada por agente</p>}
                    </td>
                    <td className="py-3 text-gray-500 dark:text-gray-400">{c.type}</td>
                    <td className="py-3 text-gray-500 dark:text-gray-400">{c.channel}</td>
                    <td className="py-3 text-center">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: sc.bg, color: sc.fg }}>{c.status}</span>
                    </td>
                    <td className="py-3 text-right text-gray-700 dark:text-gray-200">{c.conversion_count}/{c.reach_count}</td>
                    <td className="py-3 pr-3 text-right">
                      <button onClick={() => { setEditing(c); setOpen(true) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar"><Pencil size={16} /></button>
                      {c.active && <button onClick={() => handleSoftDelete(c)} className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-1" title="Desativar"><Trash size={16} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {open && <CampaignModal initial={editing} promotions={promotions} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </div>
  )
}
