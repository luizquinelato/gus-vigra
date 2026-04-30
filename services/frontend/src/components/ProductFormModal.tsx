import { useEffect, useMemo, useState } from 'react'
import {
  CaretDown, CaretRight, FloppyDisk, Image as ImageIcon, ListPlus,
  Package, Pencil, Plus, Trash, X,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  familiesApi, kitItemsApi, productCharacteristicsApi, productImagesApi, productsApi,
  type CategoryRead, type CharacteristicLinkWrite, type CharacteristicRead,
  type FamilyRead, type KitItemRead, type ProductImageRead,
  type ProductRead, type ProductType, type ProductWrite,
} from '../services/cadastrosApi'
import { slugify } from '../utils/slug'
import { CharacteristicEditor } from './CharacteristicEditor'
import { FamilyCombobox } from './FamilyCombobox'
import { ImageCropModal } from './ImageCropModal'
import { RichTextEditor } from './RichTextEditor'
import { useModalShortcuts } from '../hooks/useModalShortcuts'
import { sanitizeHtml } from '../utils/htmlSanitizer'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]'
// Wrapper sem padding (input interno traz o seu) — evita altura dobrada.
const fieldClsNoPadding = 'w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus-within:border-[var(--color-1)]'

// Marker para família "pendente" (digitada mas não persistida): id negativo.
const PENDING_FAMILY_ID = -1

// Input de moeda BRL, fill da direita-pra-esquerda, sem negativos.
// Internamente devolve string decimal compatível com DECIMAL do backend (ex: "12.34").
// `maxIntDigits` define o limite de dígitos da parte inteira (8 = R$ 99.999.999,99).
// Quando o usuário tenta exceder o cap, o valor é fixado no máximo (9999...,99)
// em vez de truncar dígitos arbitrariamente.
export function CurrencyInput({ value, onChange, maxIntDigits = 8 }: {
  value: string; onChange: (v: string) => void; maxIntDigits?: number
}) {
  const cents = Math.max(0, Math.round((Number(value) || 0) * 100))
  const reais = Math.floor(cents / 100)
  const cs = String(cents % 100).padStart(2, '0')
  const display = `R$ ${reais.toLocaleString('pt-BR')},${cs}`
  const maxTotalDigits = maxIntDigits + 2
  return (
    <input value={display} inputMode="numeric" className={fieldCls}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, '')
        const digits = raw.length > maxTotalDigits ? '9'.repeat(maxTotalDigits) : raw
        const newCents = Number(digits || '0')
        onChange((newCents / 100).toFixed(2))
      }} />
  )
}

// Medida não-negativa PT-BR (peso, dimensões), com mesma UX de CurrencyInput:
// fill da direita-pra-esquerda, sempre formatado, sufixo de unidade opcional.
// Internamente devolve string decimal com PONTO compatível com NUMERIC do backend.
// Quando o usuário tenta exceder o cap, fixa no máximo (9999...,99) em vez de truncar.
export function MeasureInput({ value, onChange, unit, decimals = 2, maxIntDigits = 8 }: {
  value: string | null; onChange: (v: string | null) => void
  unit?: string; decimals?: number; maxIntDigits?: number
}) {
  const factor = Math.pow(10, decimals)
  const small = Math.max(0, Math.round((Number(value) || 0) * factor))
  const intPart = Math.floor(small / factor)
  const decPart = String(small % factor).padStart(decimals, '0')
  const display = `${intPart.toLocaleString('pt-BR')},${decPart}`
  const maxTotal = maxIntDigits + decimals
  return (
    <div className={`${fieldClsNoPadding} flex items-center gap-2`}>
      <input value={display} inputMode="numeric"
        className="w-full bg-transparent outline-none px-3 py-2 text-sm"
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9]/g, '')
          const digits = raw.length > maxTotal ? '9'.repeat(maxTotal) : raw
          const newSmall = Number(digits || '0')
          // 0 → null (campo opcional "não informado"); demais → toFixed.
          onChange(newSmall === 0 ? null : (newSmall / factor).toFixed(decimals))
        }} />
      {unit && <span className="pr-3 text-xs text-gray-400">{unit}</span>}
    </div>
  )
}

// NCM no formato fiscal XXXX.XX.XX (8 dígitos).
function NcmInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const digits = (value ?? '').replace(/[^0-9]/g, '').slice(0, 8)
  const display = digits.length > 6 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`
                : digits.length > 4 ? `${digits.slice(0, 4)}.${digits.slice(4)}`
                : digits
  return (
    <input value={display} inputMode="numeric" placeholder="0000.00.00" className={fieldCls}
      onChange={e => {
        const d = e.target.value.replace(/[^0-9]/g, '').slice(0, 8)
        onChange(d.length === 0 ? null : d.length > 6 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`
                : d.length > 4 ? `${d.slice(0, 4)}.${d.slice(4)}` : d)
      }} />
  )
}

// Decimal não-negativo PT-BR (vírgula como separador). Devolve string com PONTO
// para o backend (ex.: "1.234"), exibe com VÍRGULA. Bloqueia negativos.
// Quando a parte inteira excede `maxIntDigits`, o valor inteiro é fixado no
// máximo (9999... e decimais 999) em vez de truncar dígitos arbitrariamente.
export function DecimalInput({ value, onChange, unit, decimals = 3, maxIntDigits = 7 }: {
  value: string | null; onChange: (v: string | null) => void
  unit?: string; decimals?: number; maxIntDigits?: number
}) {
  // Aceita digitação livre; preserva o que o usuário está digitando até blur.
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value == null || value === '' ? '' : String(value).replace('.', ','))
  function commit(raw: string) {
    const cleaned = raw.replace(/[^0-9.,]/g, '').replace(/\./g, ',')
    if (!cleaned) { onChange(null); setDraft(null); return }
    const parts = cleaned.split(',')
    const rawInt = (parts[0].replace(/^0+(?=\d)/, '')) || '0'
    const overflow = rawInt.length > maxIntDigits
    const intPart = overflow ? '9'.repeat(maxIntDigits) : rawInt
    const decPart = overflow ? '9'.repeat(decimals) : (parts[1] ?? '').slice(0, decimals)
    const normalized = decPart ? `${intPart}.${decPart}` : intPart
    const num = Math.max(0, Number(normalized) || 0)
    onChange(num.toString())
    setDraft(null)
  }
  return (
    <div className={`${fieldClsNoPadding} flex items-center gap-2`}>
      <input value={display} inputMode="decimal" placeholder="0,000"
        className="w-full bg-transparent outline-none px-3 py-2 text-sm"
        onChange={e => setDraft(e.target.value.replace(/[^0-9.,]/g, ''))}
        onBlur={e => commit(e.target.value)} />
      {unit && <span className="pr-3 text-xs text-gray-400">{unit}</span>}
    </div>
  )
}

// Achata categorias em lista com profundidade para exibir hierarquia indentada.
function flattenCategories(cats: CategoryRead[]): Array<{ cat: CategoryRead; depth: number }> {
  const active = cats.filter(c => c.active)
  const byParent = new Map<number | null, CategoryRead[]>()
  for (const c of active) {
    const list = byParent.get(c.parent_id) ?? []
    list.push(c)
    byParent.set(c.parent_id, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  const out: Array<{ cat: CategoryRead; depth: number }> = []
  function walk(parent: number | null, depth: number) {
    for (const c of byParent.get(parent) ?? []) { out.push({ cat: c, depth }); walk(c.id, depth + 1) }
  }
  walk(null, 0)
  // Categorias órfãs (parent_id aponta para inativa/inexistente) entram no fim.
  for (const c of active) if (!out.some(o => o.cat.id === c.id)) out.push({ cat: c, depth: 0 })
  return out
}

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

function Field({ label, children, full = false, required = false }: { label: string; children: React.ReactNode; full?: boolean; required?: boolean }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

// Campo de SEO (meta_title / meta_description) com contador colorido por faixa
// ideal. Verde dentro do intervalo recomendado, âmbar abaixo, vermelho acima.
function SeoField({ label, value, onChange, min, max, multiline, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  min: number; max: number; multiline?: boolean; placeholder?: string
}) {
  const len = value.length
  const status = len === 0 ? 'empty' : len < min ? 'short' : len <= max ? 'ok' : 'long'
  const color = status === 'ok' ? 'text-green-600 dark:text-green-400'
              : status === 'long' ? 'text-red-600 dark:text-red-400'
              : status === 'short' ? 'text-amber-600 dark:text-amber-400'
              : 'text-gray-400 dark:text-gray-500'
  return (
    <label className="block col-span-2">
      <span className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-300">
        <span>{label}</span>
        <span className={color}>{len}/{max} <span className="font-normal opacity-70">(ideal {min}–{max})</span></span>
      </span>
      <div className="mt-1">
        {multiline
          ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={2} className={fieldCls} placeholder={placeholder} />
          : <input value={value} onChange={e => onChange(e.target.value)} className={fieldCls} placeholder={placeholder} />}
      </div>
    </label>
  )
}

function Section({ icon: Icon, title, children, defaultOpen = true }: {
  icon: React.ComponentType<{ size?: number | string }>; title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 bg-gray-100 dark:bg-gray-700/60 border-l-4 border-[var(--color-1)] hover:bg-gray-200/70 dark:hover:bg-gray-700 ${open ? 'rounded-t-lg' : 'rounded-lg'}`}>
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
        {/* Cap em 99.999.999,999 (8 dig int): muito além de qualquer kit real;
            quantity NUMERIC(15,3) no banco. */}
        <div className="w-24">
          <DecimalInput value={picking.quantity || null}
            onChange={v => setPicking(p => ({ ...p, quantity: v ?? '' }))}
            decimals={3} maxIntDigits={8} />
        </div>
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
// Em rascunho (modo "criar produto"): URL já no storage, mas o vínculo com o
// produto só é criado em handleSave. O escopo (produto vs família) é decidido
// no Salvar, com base no estado `shareWithFamily` controlado pelo pai.
export interface DraftImage { url: string }

function ImageGallery({ productId, familyId, familyName, draft, onDraftChange,
  shareWithFamily, onShareWithFamilyChange }: {
  productId: number | null; familyId: number | null; familyName: string | null
  // Modo rascunho (productId == null): parent controla a lista pendente.
  draft?: DraftImage[]; onDraftChange?: (next: DraftImage[]) => void
  // Flag global (controlada pelo pai) — vale para uploads imediatos no modo
  // edição e para todos os anexos no Salvar (criação + edição).
  shareWithFamily: boolean
  onShareWithFamilyChange: (v: boolean) => void
}) {
  const isDraft = productId == null
  const [stored, setStored] = useState<ProductImageRead[]>([])
  const [pending, setPending] = useState<{ src: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  function reload() {
    if (isDraft) return
    productImagesApi.listByProduct(productId!, { only_active: false })
      .then(setStored).catch(() => toast.error('Erro ao listar imagens.'))
  }
  useEffect(reload, [productId, isDraft])

  function handlePick(file: File) {
    const reader = new FileReader()
    reader.onload = () => setPending({ src: String(reader.result), name: file.name })
    reader.readAsDataURL(file)
  }

  async function handleCropConfirm(file: File) {
    setBusy(true)
    try {
      const { url } = await productImagesApi.upload(file)
      if (isDraft) {
        // Em criação: só guarda a URL. O escopo (produto/família) é decidido
        // em handleSave usando a flag global vigente naquele momento.
        onDraftChange?.([...(draft ?? []), { url }])
      } else {
        const fid = shareWithFamily ? familyId : null
        await productImagesApi.attach(productId!, { url, family_id: fid, sort_order: stored.length })
        reload()
      }
      setPending(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar imagem.')
    } finally { setBusy(false) }
  }

  async function removeStored(img: ProductImageRead) {
    if (!confirm('Remover imagem?')) return
    await productImagesApi.softDelete(img.id); reload()
  }
  function removeDraft(idx: number) {
    if (!confirm('Remover imagem?')) return
    onDraftChange?.((draft ?? []).filter((_, i) => i !== idx))
  }

  const visibleStored = stored.filter(i => i.active)
  const visibleDraft = draft ?? []
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {!isDraft && visibleStored.map(img => (
          <div key={img.id} className="relative aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden group">
            <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
            {img.family_id != null && (
              <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">família</span>
            )}
            <button type="button" onClick={() => removeStored(img)}
              className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
              <Trash size={12} />
            </button>
          </div>
        ))}
        {isDraft && visibleDraft.map((img, idx) => (
          <div key={img.url} className="relative aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden group">
            <img src={img.url} alt="" className="w-full h-full object-cover" />
            {shareWithFamily && familyId != null && (
              <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">família</span>
            )}
            <button type="button" onClick={() => removeDraft(idx)}
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
      {/* Flag sempre visível para evitar shift no layout do modal ao mudar a
          família. Habilita só quando há ao menos uma imagem E uma família
          selecionada — senão não haveria efeito ao salvar. */}
      {(() => {
        const hasAnyImage = visibleStored.length + visibleDraft.length > 0
        const disabled = !hasAnyImage || familyId == null
        const title = familyId == null
          ? 'Selecione uma família para compartilhar imagens.'
          : !hasAnyImage ? 'Adicione uma imagem para habilitar.' : undefined
        return (
          <label title={title}
            className={`inline-flex items-center gap-2 text-xs ${disabled ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300'}`}>
            <input type="checkbox" checked={shareWithFamily && !disabled} disabled={disabled}
              onChange={e => onShareWithFamilyChange(e.target.checked)}
              className="accent-[var(--color-1)] disabled:cursor-not-allowed" />
            Aplicar a todos os produtos da família{familyId != null ? ` "${familyName ?? `#${familyId}`}"` : ''}
          </label>
        )
      })()}
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
  // Família "pendente": digitada e marcada para criar, mas só persiste no Salvar.
  const [pendingFamilyName, setPendingFamilyName] = useState<string | null>(null)
  // Imagens em rascunho (modo criar): URLs já no storage, attach acontece após
  // o create do produto.
  const [draftImages, setDraftImages] = useState<DraftImage[]>([])
  // Flag global "compartilhar com a família": no Salvar, todas as imagens
  // (rascunho ou já vinculadas direto ao produto) passam a ser de família.
  const [shareWithFamily, setShareWithFamily] = useState(false)

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

  // Família pendente: combobox enxerga um item virtual com id PENDING_FAMILY_ID.
  const familyOptions = useMemo<FamilyRead[]>(() => {
    if (!pendingFamilyName) return families
    return [...families, {
      id: PENDING_FAMILY_ID, name: pendingFamilyName,
      tenant_id: 0, active: true, created_at: '', last_updated_at: '',
    }]
  }, [families, pendingFamilyName])

  // Categorias indentadas por hierarquia para o select.
  const categoryRows = useMemo(() => flattenCategories(categories), [categories])

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() } })

  async function handleSave() {
    if (!draft.code.trim() || !draft.name.trim() || !draft.slug.trim()) {
      toast.error('Código, nome e slug são obrigatórios.'); return
    }
    setSaving(true)
    try {
      // Se há família pendente selecionada, persiste agora e usa o id real.
      let familyId = draft.family_id
      if (familyId === PENDING_FAMILY_ID && pendingFamilyName) {
        const created = await familiesApi.create({ name: pendingFamilyName.trim() })
        onFamilyCreated?.(created)
        familyId = created.id
        setPendingFamilyName(null)
      }
      const body: ProductWrite = {
        ...draft,
        family_id: familyId,
        code: draft.code.trim(), name: draft.name.trim(), slug: draft.slug.trim(),
        barcode: draft.barcode?.toString().trim() || null,
        brand: draft.brand?.toString().trim() || null,
        ncm: draft.ncm?.toString().trim() || null,
        description: sanitizeHtml(draft.description ?? '') || null,
        short_description: draft.short_description?.toString().trim() || null,
      }
      const saved = initial
        ? await productsApi.patch(initial.id, body)
        : await productsApi.create(body)
      // Persiste characteristic-links via PUT em lote (substitui os existentes).
      await productCharacteristicsApi.replace(saved.id, links)
      // Escopo de imagem: o flag global vigente no Salvar decide se todos os
      // anexos vão para o produto (default) ou para a família (compartilhado).
      const effectiveShare = shareWithFamily && familyId != null
      // Anexa imagens do rascunho (apenas em criação): upload já foi feito,
      // agora cria o vínculo product_image com o escopo escolhido.
      if (!initial && draftImages.length > 0) {
        for (let i = 0; i < draftImages.length; i++) {
          const img = draftImages[i]
          await productImagesApi.attach(saved.id, {
            url: img.url,
            family_id: effectiveShare ? familyId : null,
            sort_order: i,
          })
        }
      }
      // Edição: se o flag estiver ligado, migra todas as imagens hoje vinculadas
      // direto a este produto (product_id != null, family_id == null) para o
      // escopo de família — assim os outros produtos da família passam a vê-las.
      // Sem endpoint de UPDATE para family_id, fazemos softDelete + reattach.
      if (initial && effectiveShare) {
        const existing = await productImagesApi.listByProduct(initial.id, { only_active: true })
        const directOnly = existing.filter(i => i.product_id === initial.id && i.family_id == null)
        for (const img of directOnly) {
          await productImagesApi.softDelete(img.id)
          await productImagesApi.attach(initial.id, {
            url: img.url,
            alt_text: img.alt_text,
            family_id: familyId,
            sort_order: img.sort_order,
          })
        }
      }
      toast.success(initial ? 'Produto atualizado.' : 'Produto criado.')
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar produto.')
    } finally { setSaving(false) }
  }

  const currentFamilyName = draft.family_id != null
    ? familyOptions.find(f => f.id === draft.family_id)?.name ?? null
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: initial ? 'var(--color-edit)' : 'var(--color-create)', color: initial ? 'var(--on-color-edit)' : 'var(--on-color-create)' }}>
              {initial ? <Pencil size={18} /> : <Plus size={18} />}
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{initial ? 'Editar produto' : 'Novo produto'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>

        <div className="space-y-3">
          {/* Imagens primeiro: oferece feedback visual desde o começo, tanto
              em criar (modo rascunho) quanto em editar (modo persistido). */}
          <Section icon={ImageIcon} title="Imagens">
            <ImageGallery
              productId={initial?.id ?? null}
              familyId={draft.family_id ?? null}
              familyName={currentFamilyName}
              draft={draftImages}
              onDraftChange={setDraftImages}
              shareWithFamily={shareWithFamily}
              onShareWithFamilyChange={setShareWithFamily} />
          </Section>

          <Section icon={Package} title="Básico">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Código" required>
                <input value={draft.code} onChange={e => set('code', e.target.value)} className={fieldCls} placeholder="ex: CAFE-500-M" />
              </Field>
              <Field label="Nome" required>
                <input value={draft.name} onChange={e => onChangeName(e.target.value)} className={fieldCls} />
              </Field>
              {/* Cap em R$ 99.999.999,99 (8 dig int): suficiente para MEI/MPE
                  e bem abaixo dos limites do banco (price NUMERIC(15,2),
                  cost NUMERIC(15,4)). */}
              <Field label="Preço de venda">
                <CurrencyInput value={draft.price ?? '0'} onChange={v => set('price', v)} maxIntDigits={8} />
              </Field>
              <Field label="Custo">
                <CurrencyInput value={draft.cost ?? '0'} onChange={v => set('cost', v)} maxIntDigits={8} />
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
                  {categoryRows.map(({ cat, depth }) => (
                    <option key={cat.id} value={cat.id}>
                      {'\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '↳ ' : '') + cat.name}
                    </option>
                  ))}
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

          <Section icon={ListPlus} title="Características & Família">
            <div className="space-y-3">
              <div>
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Características</span>
                <div className="mt-1">
                  <CharacteristicEditor value={links} onChange={setLinks}
                    characteristics={characteristics}
                    onCharacteristicCreated={onCharacteristicCreated} />
                </div>
              </div>
              <Field label="Família (agrupa variações)" full>
                <FamilyCombobox value={draft.family_id ?? null}
                  onChange={id => set('family_id', id)}
                  options={familyOptions}
                  onCreate={async (name) => {
                    setPendingFamilyName(name)
                    return { id: PENDING_FAMILY_ID, name, tenant_id: 0, active: true, created_at: '', last_updated_at: '' }
                  }}
                  placeholder="Buscar ou criar família…" />
              </Field>
            </div>
          </Section>

          {initial && draft.type === 'kit' && (
            <Section icon={Package} title="Composição do Kit">
              <KitEditor kitId={initial.id} allProducts={allProducts} />
            </Section>
          )}

          <Section icon={Package} title="Mais opções (NF, SEO, dimensões)" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Slug" full required>
                <input value={draft.slug} onChange={e => onChangeSlug(e.target.value)} className={fieldCls} />
              </Field>
              <Field label="NCM"><NcmInput value={draft.ncm ?? null} onChange={v => set('ncm', v)} /></Field>
              {/* Limites alinhados com o banco: weight_kg NUMERIC(10,3) → 7 int digits;
                  height/width/depth_cm NUMERIC(10,2) → 8 int digits. MeasureInput
                  usa fill da direita-pra-esquerda (mesma UX de preço/custo). */}
              <Field label="Peso"><MeasureInput value={draft.weight_kg ?? null} onChange={v => set('weight_kg', v)} unit="kg" decimals={3} maxIntDigits={7} /></Field>
              <Field label="Altura"><MeasureInput value={draft.height_cm ?? null} onChange={v => set('height_cm', v)} unit="cm" decimals={2} maxIntDigits={8} /></Field>
              <Field label="Largura"><MeasureInput value={draft.width_cm ?? null} onChange={v => set('width_cm', v)} unit="cm" decimals={2} maxIntDigits={8} /></Field>
              <Field label="Profundidade"><MeasureInput value={draft.depth_cm ?? null} onChange={v => set('depth_cm', v)} unit="cm" decimals={2} maxIntDigits={8} /></Field>
              <Field label="Descrição curta" full>
                <input value={draft.short_description ?? ''} onChange={e => set('short_description', e.target.value)}
                  className={fieldCls} placeholder="Resumo de 1–2 linhas que aparece em listagens." />
              </Field>
              <Field label="Descrição completa" full>
                <RichTextEditor value={draft.description ?? ''} onChange={v => set('description', v)}
                  placeholder="Descreva o produto: características, diferenciais, modo de uso…" />
              </Field>
              <SeoField label="Meta title" value={draft.meta_title ?? ''} onChange={v => set('meta_title', v)}
                min={50} max={60}
                placeholder="Ex: Café especial 500g — torrado e moído | Loja do João" />
              <SeoField label="Meta description" value={draft.meta_description ?? ''} onChange={v => set('meta_description', v)}
                min={150} max={160} multiline
                placeholder="Ex: Café especial 100% arábica, torrado e moído na hora. Notas de chocolate e caramelo. Frete grátis acima de R$ 80." />
            </div>
          </Section>
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
