import { useEffect, useMemo, useState } from 'react'
import { FloppyDisk, MagnifyingGlass, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { tagsApi, type TagRead, type TagWrite } from '../services/cadastrosApi'
import { slugify } from '../utils/slug'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function TagModal({ initial, onClose, onSaved }: { initial: TagRead | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [slugLinked, setSlugLinked] = useState(!initial?.slug)
  const [saving, setSaving] = useState(false)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  function onChangeName(v: string) {
    setName(v)
    if (slugLinked) setSlug(slugify(v))
  }
  function onChangeSlug(v: string) {
    setSlug(slugify(v))
    setSlugLinked(false)
  }

  async function handleSave() {
    if (!name.trim() || !slug.trim()) { toast.error('Nome e slug são obrigatórios.'); return }
    setSaving(true)
    try {
      const body: TagWrite = { name: name.trim(), slug: slug.trim() }
      if (initial) await tagsApi.patch(initial.id, body)
      else         await tagsApi.create(body)
      toast.success(initial ? 'Tag atualizada.' : 'Tag criada.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar tag.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: initial ? 'var(--color-edit)' : 'var(--color-create)', color: initial ? 'var(--on-color-edit)' : 'var(--on-color-create)' }}>
              {initial ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar tag' : 'Nova tag'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome<span className="text-red-500 ml-0.5">*</span></span>
            <input value={name} onChange={e => onChangeName(e.target.value)} className={`${fieldCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Slug<span className="text-red-500 ml-0.5">*</span></span>
            <input value={slug} onChange={e => onChangeSlug(e.target.value)} className={`${fieldCls} mt-1`} placeholder="ex: lancamento" />
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

export default function TagsPage() {
  const [items, setItems] = useState<TagRead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<TagRead | null>(null)
  const [open, setOpen] = useState(false)

  function reload() {
    setLoading(true)
    tagsApi.list({ only_active: false })
      .then(setItems)
      .catch(() => toast.error('Erro ao carregar tags.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const filtered = useMemo(
    () => items.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()) || t.slug.toLowerCase().includes(filter.toLowerCase())),
    [items, filter],
  )

  async function handleSoftDelete(t: TagRead) {
    if (!confirm(`Desativar "${t.name}"?`)) return
    try { await tagsApi.softDelete(t.id); toast.success('Tag desativada.'); reload() }
    catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tags</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Etiquetas para organização e busca de produtos.</p>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova tag
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhuma tag.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
              <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Slug</th>
              <th className="text-center py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
              <th className="w-20" />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="py-3 pl-3 font-semibold text-gray-800 dark:text-gray-100">{t.name}</td>
                  <td className="py-3 text-gray-500 dark:text-gray-400">{t.slug}</td>
                  <td className="py-3 text-center">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: t.active ? 'var(--color-success)' : '#cbd5e1', color: t.active ? 'var(--on-color-success)' : '#475569' }}>
                      {t.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button onClick={() => { setEditing(t); setOpen(true) }} className="p-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Editar"><Pencil size={16} /></button>
                    {t.active && <button onClick={() => handleSoftDelete(t)} className="p-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-1" title="Desativar"><Trash size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {open && <TagModal initial={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </div>
  )
}
