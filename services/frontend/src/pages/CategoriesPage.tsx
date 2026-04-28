import { useEffect, useMemo, useState } from 'react'
import { FloppyDisk, MagnifyingGlass, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { categoriesApi, type CategoryRead, type CategoryWrite } from '../services/cadastrosApi'
import { slugify } from '../utils/slug'
import { IconPicker } from '../components/IconPicker'
import { getCategoryIcon } from '../utils/categoryIcons'

// ── Modal de criar/editar ─────────────────────────────────────────────────────

interface ModalProps {
  initial: CategoryRead | null
  parents: CategoryRead[]
  onClose: () => void
  onSaved: () => void
}

function CategoryModal({ initial, parents, onClose, onSaved }: ModalProps) {
  const [name,       setName]       = useState(initial?.name ?? '')
  const [slug,       setSlug]       = useState(initial?.slug ?? '')
  const [slugLinked, setSlugLinked] = useState(!initial?.slug)
  const [icon,       setIcon]       = useState<string | null>(initial?.icon ?? null)
  const [parentId,   setParentId]   = useState<number | ''>(initial?.parent_id ?? '')
  const [saving,     setSaving]     = useState(false)

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
      const body: CategoryWrite = {
        name: name.trim(),
        slug: slug.trim(),
        icon: icon,
        parent_id: parentId === '' ? null : Number(parentId),
      }
      if (initial) await categoriesApi.patch(initial.id, body)
      else         await categoriesApi.create(body)
      toast.success(initial ? 'Categoria atualizada.' : 'Categoria criada.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar categoria.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
            {initial ? 'Editar categoria' : 'Nova categoria'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <Field label="Nome">
            <input value={name} onChange={e => onChangeName(e.target.value)} className={fieldCls} />
          </Field>
          <Field label="Slug">
            <input value={slug} onChange={e => onChangeSlug(e.target.value)} className={fieldCls} placeholder="ex: bebidas-quentes" />
          </Field>
          <Field label="Ícone (opcional)">
            <IconPicker value={icon} onChange={setIcon} />
          </Field>
          <Field label="Categoria pai (opcional)">
            <select value={parentId} onChange={e => setParentId(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls}>
              <option value="">— Nenhuma —</option>
              {parents.filter(p => p.id !== initial?.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
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

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

interface TreeRow { cat: CategoryRead; depth: number }

function buildTree(items: CategoryRead[]): TreeRow[] {
  const childrenOf = new Map<number | null, CategoryRead[]>()
  for (const c of items) {
    const k = c.parent_id ?? null
    if (!childrenOf.has(k)) childrenOf.set(k, [])
    childrenOf.get(k)!.push(c)
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const out: TreeRow[] = []
  const visited = new Set<number>()
  function walk(parentId: number | null, depth: number) {
    for (const c of childrenOf.get(parentId) ?? []) {
      out.push({ cat: c, depth })
      visited.add(c.id)
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const c of items) if (!visited.has(c.id)) out.push({ cat: c, depth: 0 })
  return out
}

export default function CategoriesPage() {
  const [items,   setItems]   = useState<CategoryRead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('')
  const [editing, setEditing] = useState<CategoryRead | null>(null)
  const [open,    setOpen]    = useState(false)

  function reload() {
    setLoading(true)
    categoriesApi.list({ only_active: false })
      .then(setItems)
      .catch(() => toast.error('Erro ao carregar categorias.'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const filtered = useMemo<TreeRow[]>(() => {
    const tree = buildTree(items)
    const q = filter.trim().toLowerCase()
    if (!q) return tree
    const byId = new Map(items.map(c => [c.id, c]))
    const keep = new Set<number>()
    for (const c of items) {
      if (c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)) {
        keep.add(c.id)
        let p = c.parent_id
        while (p != null && byId.has(p)) { keep.add(p); p = byId.get(p)!.parent_id ?? null }
      }
    }
    return tree.filter(r => keep.has(r.cat.id))
  }, [items, filter])

  async function handleSoftDelete(c: CategoryRead) {
    if (!confirm(`Desativar "${c.name}"?`)) return
    try {
      await categoriesApi.softDelete(c.id)
      toast.success('Categoria desativada.')
      reload()
    } catch { toast.error('Erro ao desativar.') }
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Categorias</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Organize seus produtos em uma árvore de categorias.</p>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true) }}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <Plus size={15} /> Nova categoria
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Filtrar por nome ou slug…" value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]" />
      </div>

      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        {loading ? <p className="text-sm text-gray-400">Carregando...</p> : filtered.length === 0 ? <p className="text-sm text-gray-400">Nenhuma categoria.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 dark:border-gray-700">
              <th className="text-left pb-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome</th>
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Slug</th>
              <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Pai</th>
              <th className="text-center pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
              <th className="w-20" />
            </tr></thead>
            <tbody>
              {filtered.map(({ cat: c, depth }, i) => {
                const parent = items.find(p => p.id === c.parent_id)
                const Icon = getCategoryIcon(c.icon)
                return (
                  <tr key={c.id} className={`hover:bg-gray-100 dark:hover:bg-gray-700/50 ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}`}>
                    <td className="py-3 pl-3 font-semibold text-gray-800 dark:text-gray-100">
                      <span className="inline-flex items-center" style={{ paddingLeft: depth * 20 }}>
                        {depth > 0 && <span className="text-gray-300 dark:text-gray-500 mr-1.5 select-none">└─</span>}
                        {Icon
                          ? <Icon size={16} weight="duotone" className="mr-2 text-gray-600 dark:text-gray-300 shrink-0" />
                          : <span className="mr-2 text-gray-300 select-none">·</span>}
                        {c.name}
                      </span>
                    </td>
                    <td className="py-3 text-gray-500 dark:text-gray-400">{c.slug}</td>
                    <td className="py-3 text-gray-500 dark:text-gray-400">{parent?.name ?? '—'}</td>
                    <td className="py-3 text-center">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: c.active ? 'var(--color-success)' : '#cbd5e1', color: c.active ? 'var(--on-color-success)' : '#475569' }}>
                        {c.active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <button onClick={() => { setEditing(c); setOpen(true) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1" title="Editar"><Pencil size={16} /></button>
                      {c.active && <button onClick={() => handleSoftDelete(c)} className="text-gray-400 hover:text-red-600 p-1 ml-1" title="Desativar"><Trash size={16} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {open && <CategoryModal initial={editing} parents={items} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />}
    </div>
  )
}
