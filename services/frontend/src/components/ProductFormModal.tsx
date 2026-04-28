import { useEffect, useState } from 'react'
import {
  CaretDown, CaretRight, FloppyDisk, Image as ImageIcon, ListPlus,
  Package, Plus, Trash, X,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  kitItemsApi, productCharacteristicsApi, productImagesApi, productsApi,
  type CategoryRead, type CharacteristicLinkWrite, type CharacteristicRead,
  type FamilyRead, type KitItemRead, type ProductImageRead,
  type ProductRead, type ProductType, type ProductWrite,
} from '../services/cadastrosApi'
import { slugify } from '../utils/slug'
import { CharacteristicEditor } from './CharacteristicEditor'
import { FamilyCombobox } from './FamilyCombobox'
import { ImageCropModal } from './ImageCropModal'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]'

interface Props {
  initial: ProductRead | null
  categories: CategoryRead[]
  allProducts: ProductRead[]
  families: FamilyRead[]
  characteristics: CharacteristicRead[]
  onFamilyCreated?: (created: FamilyRead) => void
  onCharacteristicCreated?: (created: CharacteristicRead) => void
  onClose: () => void
  onSaved: () => void
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Section({ icon: Icon, title, children, defaultOpen = true }: {
  icon: React.ComponentType<{ size?: number }>; title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/30">
        {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
        <Icon size={15} /> {title}
      </button>
      {open && <div className="p-3 border-t border-gray-200 dark:border-gray-700">{children}</div>}
    </div>
  )
}

// ── Editor de Kit (componentes do produto kit) ────────────────────────────────

function KitEditor({ kitId, allProducts }: { kitId: number; allProducts: ProductRead[] }) {
  const [items, setItems] = useState<KitItemRead[]>([])
  const [picking, setPicking] = useState<{ component_id: number; quantity: string }>({ component_id: 0, quantity: '1' })

  function reload() {
    kitItemsApi.listByKit(kitId, { only_active: false }).then(setItems).catch(() => toast.error('Erro ao listar kit.'))
  }
  useEffect(reload, [kitId])

  async function add() {
    if (!picking.component_id) { toast.error('Escolha um componente.'); return }
    if (picking.component_id === kitId) { toast.error('Kit não pode conter ele mesmo.'); return }
    try {
      await kitItemsApi.add(kitId, { component_id: picking.component_id, quantity: picking.quantity || '1' })
      setPicking({ component_id: 0, quantity: '1' }); reload()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao adicionar componente.')
    }
  }

  async function remove(item: KitItemRead) {
    if (!confirm('Remover componente?')) return
    await kitItemsApi.softDelete(item.id); reload()
  }

  const compsAvailable = allProducts.filter(p => p.id !== kitId && p.active)
  const byId = new Map(allProducts.map(p => [p.id, p] as const))

  return (
    <div className="space-y-3">
      {items.filter(i => i.active).length === 0 && <p className="text-xs text-gray-400">Nenhum componente. Adicione produtos abaixo.</p>}
      {items.filter(i => i.active).map(it => {
        const c = byId.get(it.component_id)
        return (
          <div key={it.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-gray-800 dark:text-gray-100">{c ? `${c.code} · ${c.name}` : `#${it.component_id}`}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">qtd. {Number(it.quantity).toString()}</span>
            <button type="button" onClick={() => remove(it)} className="text-gray-400 hover:text-red-600 px-1"><Trash size={14} /></button>
          </div>
        )
      })}
      <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        <select value={picking.component_id} onChange={e => setPicking(p => ({ ...p, component_id: Number(e.target.value) }))} className={`${fieldCls} flex-1`}>
          <option value={0}>— Escolher componente —</option>
          {compsAvailable.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
        <input type="number" step="0.01" min="0.01" value={picking.quantity}
          onChange={e => setPicking(p => ({ ...p, quantity: e.target.value }))} className={`${fieldCls} w-24`} />
        <button type="button" onClick={add}
          className="inline-flex items-center gap-1 px-3 rounded-lg text-sm font-semibold border-none"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
          <ListPlus size={14} /> Adicionar
        </button>
      </div>
    </div>
  )
}

// ── Galeria de imagens (com upload + crop + opção de aplicar à família) ──────

function ImageGallery({ productId, familyId, familyName }: {
  productId: number; familyId: number | null; familyName: string | null
}) {
  const [images, setImages] = useState<ProductImageRead[]>([])
  const [pending, setPending] = useState<{ src: string; name: string } | null>(null)
  const [shareWithFamily, setShareWithFamily] = useState(false)
  const [busy, setBusy] = useState(false)

  function reload() {
    productImagesApi.listByProduct(productId, { only_active: false })
      .then(setImages).catch(() => toast.error('Erro ao listar imagens.'))
  }
  useEffect(reload, [productId])

  function handlePick(file: File) {
    const reader = new FileReader()
    reader.onload = () => setPending({ src: String(reader.result), name: file.name })
    reader.readAsDataURL(file)
  }

  async function handleCropConfirm(file: File) {
    setBusy(true)
    try {
      const { url } = await productImagesApi.upload(file)
      const fid = shareWithFamily ? familyId : null
      await productImagesApi.attach(productId, { url, family_id: fid, sort_order: images.length })
      setPending(null); reload()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar imagem.')
    } finally { setBusy(false) }
  }

  async function remove(img: ProductImageRead) {
    if (!confirm('Remover imagem?')) return
    await productImagesApi.softDelete(img.id); reload()
  }

  const visible = images.filter(i => i.active)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {visible.map(img => (
          <div key={img.id} className="relative aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden group">
            <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
            {img.family_id != null && (
              <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">família</span>
            )}
            <button type="button" onClick={() => remove(img)}
              className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
              <Trash size={12} />
            </button>
          </div>
        ))}
        <label className="aspect-square border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-[var(--color-1)] hover:text-[var(--color-1)] cursor-pointer">
          <Plus size={20} />
          <span className="text-[11px] mt-1">Adicionar</span>
          <input type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && handlePick(e.target.files[0])} />
        </label>
      </div>
      {familyId != null && (
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={shareWithFamily} onChange={e => setShareWithFamily(e.target.checked)}
            className="accent-[var(--color-1)]" />
          Aplicar a todos os produtos da família "{familyName ?? `#${familyId}`}"
        </label>
      )}
      {pending && (
        <ImageCropModal src={pending.src} fileName={pending.name}
          onClose={() => !busy && setPending(null)} onConfirm={handleCropConfirm} />
      )}
    </div>
  )
}

// ── Modal principal ──────────────────────────────────────────────────────────

export function ProductFormModal({
  initial, categories, allProducts, families, characteristics,
  onFamilyCreated, onCharacteristicCreated, onClose, onSaved,
}: Props) {
  const [draft, setDraft] = useState<ProductWrite>({
    code: initial?.code ?? '', name: initial?.name ?? '', slug: initial?.slug ?? '',
    family_id: initial?.family_id ?? null,
    barcode: initial?.barcode ?? null,
    price: initial?.price ?? '0', cost: initial?.cost ?? '0',
    unit: initial?.unit ?? 'un',
    type: (initial?.type as ProductType) ?? 'simple',
    brand: initial?.brand ?? null,
    description: initial?.description ?? null,
    short_description: initial?.short_description ?? null,
    ncm: initial?.ncm ?? null,
    weight_kg: initial?.weight_kg ?? null,
    height_cm: initial?.height_cm ?? null,
    width_cm: initial?.width_cm ?? null,
    depth_cm: initial?.depth_cm ?? null,
    meta_title: initial?.meta_title ?? null,
    meta_description: initial?.meta_description ?? null,
    category_id: initial?.category_id ?? null,
  })
  const [slugLinked, setSlugLinked] = useState(!initial?.slug)
  const [saving, setSaving] = useState(false)
  // Links de characteristic-value: carrega do backend ao editar.
  const [links, setLinks] = useState<CharacteristicLinkWrite[]>([])

  useEffect(() => {
    if (!initial) { setLinks([]); return }
    productCharacteristicsApi.list(initial.id)
      .then(rows => setLinks(rows.map(r => ({ characteristic_id: r.characteristic_id, value_id: r.value_id }))))
      .catch(() => toast.error('Erro ao carregar características.'))
  }, [initial])

  function set<K extends keyof ProductWrite>(k: K, v: ProductWrite[K]) { setDraft(p => ({ ...p, [k]: v })) }
  function onChangeName(v: string) {
    setDraft(p => ({ ...p, name: v, ...(slugLinked ? { slug: slugify(v) } : {}) }))
  }
  function onChangeSlug(v: string) { setDraft(p => ({ ...p, slug: slugify(v) })); setSlugLinked(false) }

  async function handleSave() {
    if (!draft.code.trim() || !draft.name.trim() || !draft.slug.trim()) {
      toast.error('Código, nome e slug são obrigatórios.'); return
    }
    setSaving(true)
    try {
      const body: ProductWrite = {
        ...draft,
        code: draft.code.trim(), name: draft.name.trim(), slug: draft.slug.trim(),
        barcode: draft.barcode?.toString().trim() || null,
        brand: draft.brand?.toString().trim() || null,
        ncm: draft.ncm?.toString().trim() || null,
        description: draft.description?.toString().trim() || null,
        short_description: draft.short_description?.toString().trim() || null,
      }
      const saved = initial
        ? await productsApi.patch(initial.id, body)
        : await productsApi.create(body)
      // Persiste characteristic-links via PUT em lote (substitui os existentes).
      await productCharacteristicsApi.replace(saved.id, links)
      toast.success(initial ? 'Produto atualizado.' : 'Produto criado.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar produto.')
    } finally { setSaving(false) }
  }

  const currentFamilyName = draft.family_id != null
    ? families.find(f => f.id === draft.family_id)?.name ?? null
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar produto' : 'Novo produto'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="space-y-3">
          <Section icon={Package} title="Básico">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código">
                <input value={draft.code} onChange={e => set('code', e.target.value)} className={fieldCls} placeholder="ex: CAFE-500-M" />
              </Field>
              <Field label="Nome">
                <input value={draft.name} onChange={e => onChangeName(e.target.value)} className={fieldCls} />
              </Field>
              <Field label="Preço de venda">
                <input type="number" step="0.01" value={draft.price ?? '0'} onChange={e => set('price', e.target.value)} className={fieldCls} />
              </Field>
              <Field label="Custo">
                <input type="number" step="0.01" value={draft.cost ?? '0'} onChange={e => set('cost', e.target.value)} className={fieldCls} />
              </Field>
              <Field label="Unidade">
                <input value={draft.unit ?? 'un'} onChange={e => set('unit', e.target.value)} className={fieldCls} placeholder="un, kg, L…" />
              </Field>
              <Field label="Tipo">
                <select value={draft.type ?? 'simple'} onChange={e => set('type', e.target.value as ProductType)} className={fieldCls}>
                  <option value="simple">Simples</option>
                  <option value="kit">Kit</option>
                </select>
              </Field>
              <Field label="Categoria">
                <select value={draft.category_id ?? ''} onChange={e => set('category_id', e.target.value === '' ? null : Number(e.target.value))} className={fieldCls}>
                  <option value="">— Sem categoria —</option>
                  {categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Marca">
                <input value={draft.brand ?? ''} onChange={e => set('brand', e.target.value)} className={fieldCls} />
              </Field>
              <Field label="Código de barras (EAN)" full>
                <input value={draft.barcode ?? ''} onChange={e => set('barcode', e.target.value)} className={fieldCls} placeholder="7891234567890" />
              </Field>
            </div>
          </Section>

          <Section icon={ListPlus} title="Família & Características">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="Família (agrupa variações)">
                <FamilyCombobox value={draft.family_id ?? null}
                  onChange={id => set('family_id', id)}
                  options={families} onCreated={onFamilyCreated}
                  placeholder="Buscar ou criar família…" />
              </Field>
            </div>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Características</span>
            <div className="mt-1">
              <CharacteristicEditor value={links} onChange={setLinks}
                characteristics={characteristics}
                onCharacteristicCreated={onCharacteristicCreated} />
            </div>
          </Section>

          {initial && draft.type === 'kit' && (
            <Section icon={Package} title="Composição do Kit">
              <KitEditor kitId={initial.id} allProducts={allProducts} />
            </Section>
          )}

          {initial && (
            <Section icon={ImageIcon} title="Imagens">
              <ImageGallery productId={initial.id}
                familyId={draft.family_id ?? null} familyName={currentFamilyName} />
            </Section>
          )}

          <Section icon={Package} title="Mais opções (NF, SEO, dimensões)" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Slug" full>
                <input value={draft.slug} onChange={e => onChangeSlug(e.target.value)} className={fieldCls} />
              </Field>
              <Field label="NCM"><input value={draft.ncm ?? ''} onChange={e => set('ncm', e.target.value)} className={fieldCls} placeholder="0000.00.00" /></Field>
              <Field label="Peso (kg)"><input type="number" step="0.001" value={draft.weight_kg ?? ''} onChange={e => set('weight_kg', e.target.value || null)} className={fieldCls} /></Field>
              <Field label="Altura (cm)"><input type="number" step="0.1" value={draft.height_cm ?? ''} onChange={e => set('height_cm', e.target.value || null)} className={fieldCls} /></Field>
              <Field label="Largura (cm)"><input type="number" step="0.1" value={draft.width_cm ?? ''} onChange={e => set('width_cm', e.target.value || null)} className={fieldCls} /></Field>
              <Field label="Profundidade (cm)"><input type="number" step="0.1" value={draft.depth_cm ?? ''} onChange={e => set('depth_cm', e.target.value || null)} className={fieldCls} /></Field>
              <Field label="Descrição curta" full><input value={draft.short_description ?? ''} onChange={e => set('short_description', e.target.value)} className={fieldCls} /></Field>
              <Field label="Descrição completa" full><textarea value={draft.description ?? ''} onChange={e => set('description', e.target.value)} rows={3} className={fieldCls} /></Field>
              <Field label="Meta title" full><input value={draft.meta_title ?? ''} onChange={e => set('meta_title', e.target.value)} className={fieldCls} /></Field>
              <Field label="Meta description" full><textarea value={draft.meta_description ?? ''} onChange={e => set('meta_description', e.target.value)} rows={2} className={fieldCls} /></Field>
            </div>
          </Section>
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
