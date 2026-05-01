import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowsClockwise, FloppyDisk, Pencil, Plus, Trash,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  categoriesApi, characteristicsApi, familiesApi, productImagesApi, productsApi,
  type CategoryRead, type CharacteristicRead, type FamilyDefaults,
  type FamilyManagedFieldOption, type FamilyRead, type ProductImageRead,
  type ProductRead,
} from '../services/cadastrosApi'
import { flattenCategories } from '../components/ProductFormModal'
import { ImageCropModal } from '../components/ImageCropModal'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]'
const sectionCls = 'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-colors hover:border-[var(--color-1)]'
const sectionTitleCls = 'text-base font-bold text-gray-800 dark:text-gray-100 mb-1'
const sectionHintCls = 'text-xs text-gray-500 dark:text-gray-400 mb-4'

export default function FamilyDetailPage() {
  const { familyId } = useParams<{ familyId: string }>()
  const fid = Number(familyId)

  const [family, setFamily] = useState<FamilyRead | null>(null)
  const [options, setOptions] = useState<FamilyManagedFieldOption[]>([])
  const [categories, setCategories] = useState<CategoryRead[]>([])
  const [characteristics, setCharacteristics] = useState<CharacteristicRead[]>([])
  const [products, setProducts] = useState<ProductRead[]>([])
  const [images, setImages] = useState<ProductImageRead[]>([])
  const [loading, setLoading] = useState(true)

  // Drafts editáveis (a página persiste explicitamente — sem auto-save).
  const [name, setName] = useState('')
  const [defaults, setDefaults] = useState<FamilyDefaults>({})
  const [characteristicIds, setCharacteristicIds] = useState<number[]>([])
  const [savingMeta, setSavingMeta] = useState(false)
  const [applying, setApplying] = useState(false)

  // Upload com crop.
  const [pending, setPending] = useState<{ src: string; name: string } | null>(null)
  const [busyImg, setBusyImg] = useState(false)

  function reload() {
    setLoading(true)
    Promise.all([
      familiesApi.get(fid),
      familiesApi.getManagedFieldOptions(),
      categoriesApi.list({ only_active: true }),
      characteristicsApi.list({ only_active: true }),
      productsApi.list({ only_active: false, limit: 500 }),
      productImagesApi.listByFamily(fid, { only_active: true }),
    ])
      .then(([fam, opts, cats, chs, ps, imgs]) => {
        setFamily(fam); setName(fam.name)
        setDefaults(fam.defaults ?? {})
        setCharacteristicIds(fam.characteristic_ids ?? [])
        setOptions(opts); setCategories(cats); setCharacteristics(chs)
        setProducts(ps); setImages(imgs)
      })
      .catch(() => toast.error('Erro ao carregar família.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (fid) reload() }, [fid]) // eslint-disable-line react-hooks/exhaustive-deps

  const familyProducts = useMemo(
    () => products.filter(p => p.family_id === fid),
    [products, fid],
  )
  const categoryRows = useMemo(() => flattenCategories(categories), [categories])

  // ── Managed fields ─────────────────────────────────────────────────────────
  function toggleManaged(key: string, on: boolean) {
    setDefaults(prev => {
      const next = { ...prev }
      if (on) { if (!(key in next)) next[key] = '' }
      else    { delete next[key] }
      return next
    })
  }
  function setDefault(key: string, value: string | number | null) {
    setDefaults(prev => ({ ...prev, [key]: value }))
  }

  async function saveMeta() {
    if (!name.trim()) { toast.error('Nome é obrigatório.'); return }
    setSavingMeta(true)
    try {
      const updated = await familiesApi.patch(fid, {
        name: name.trim(), defaults, characteristic_ids: characteristicIds,
      })
      setFamily(updated)
      toast.success('Família salva.')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar família.')
    } finally { setSavingMeta(false) }
  }

  async function applyDefaults() {
    const managedKeys = Object.keys(defaults)
    if (managedKeys.length === 0) { toast.error('Nenhum campo gerenciado.'); return }
    if (familyProducts.length === 0) { toast.error('Família sem produtos.'); return }
    const confirmMsg = `Propagar ${managedKeys.length} campo(s) para ${familyProducts.length} produto(s)? Os valores atuais nesses campos serão sobrescritos.`
    if (!confirm(confirmMsg)) return
    setApplying(true)
    try {
      const r = await familiesApi.applyDefaults(fid)
      toast.success(`Aplicado em ${r.products_count} produto(s).`)
      reload()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao aplicar.')
    } finally { setApplying(false) }
  }

  // ── Imagens ────────────────────────────────────────────────────────────────
  function handlePick(file: File) {
    const reader = new FileReader()
    reader.onload = () => setPending({ src: String(reader.result), name: file.name })
    reader.readAsDataURL(file)
  }
  async function handleCropConfirm(file: File) {
    setBusyImg(true)
    try {
      const { url } = await productImagesApi.upload(file)
      await productImagesApi.attachToFamily(fid, { url, sort_order: images.length })
      setPending(null)
      reload()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar imagem.')
    } finally { setBusyImg(false) }
  }
  async function removeImage(img: ProductImageRead) {
    if (!confirm('Remover imagem?')) return
    try { await productImagesApi.softDelete(img.id); reload() }
    catch { toast.error('Erro ao remover imagem.') }
  }

  if (loading || !family) {
    return <div className="min-h-full p-8"><p className="text-sm text-gray-400">Carregando…</p></div>
  }

  return (
    <div className="min-h-full p-8 space-y-6">
      <div>
        <Link to="/cadastros/familias" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <ArrowLeft size={14} /> Voltar para famílias
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{family.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Configure os campos genéricos da família e propague-os a todos os produtos vinculados.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
              style={{ background: family.active ? 'var(--color-success)' : '#cbd5e1', color: family.active ? 'var(--on-color-success)' : '#475569' }}>
              {family.active ? 'Ativa' : 'Inativa'}
            </span>
            <button onClick={saveMeta} disabled={savingMeta}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
              style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: savingMeta ? 0.6 : 1, cursor: savingMeta ? 'not-allowed' : 'pointer' }}>
              <FloppyDisk size={15} className={savingMeta ? 'animate-spin' : undefined} /> Salvar família
            </button>
          </div>
        </div>
      </div>

      <section className={sectionCls}>
        <h2 className={sectionTitleCls}>Identificação</h2>
        <p className={sectionHintCls}>Nome usado em listagens, comboboxes e como rótulo do agrupamento de produtos.</p>
        <label className="block max-w-md">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome<span className="text-red-500 ml-0.5">*</span></span>
          <input value={name} onChange={e => setName(e.target.value)} className={`${fieldCls} mt-1`} />
        </label>
      </section>

      <ManagedFieldsSection
        options={options} defaults={defaults} categoryRows={categoryRows}
        toggleManaged={toggleManaged} setDefault={setDefault}
        applyDefaults={applyDefaults} applying={applying}
        productsCount={familyProducts.length} />

      <CharacteristicsSection
        all={characteristics} selected={characteristicIds} onChange={setCharacteristicIds} />

      <ImagesSection
        images={images} onPick={handlePick} onRemove={removeImage}
        pending={pending} busy={busyImg}
        onCropConfirm={handleCropConfirm} onCropClose={() => !busyImg && setPending(null)} />

      <ProductsSection products={familyProducts} familyId={fid} />
    </div>
  )
}


// ── Seção: campos genéricos ──────────────────────────────────────────────────

function ManagedFieldsSection({ options, defaults, categoryRows, toggleManaged, setDefault, applyDefaults, applying, productsCount }: {
  options: FamilyManagedFieldOption[]
  defaults: FamilyDefaults
  categoryRows: Array<{ cat: CategoryRead; depth: number }>
  toggleManaged: (key: string, on: boolean) => void
  setDefault: (key: string, value: string | number | null) => void
  applyDefaults: () => void
  applying: boolean
  productsCount: number
}) {
  return (
    <section className={sectionCls}>
      <div className="flex items-start justify-between mb-1">
        <h2 className={sectionTitleCls}>Campos genéricos</h2>
        <button onClick={applyDefaults} disabled={applying || productsCount === 0}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold border-none disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}
          title={productsCount === 0 ? 'Adicione produtos à família para propagar.' : `Propagar para ${productsCount} produto(s).`}>
          <ArrowsClockwise size={13} className={applying ? 'animate-spin' : undefined} /> Aplicar a {productsCount} produto(s)
        </button>
      </div>
      <p className={sectionHintCls}>
        Marque os campos cujos valores são definidos pela família. Ao aplicar, os valores aqui sobrescrevem os atuais nos produtos vinculados.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {options.map(opt => {
          const managed = opt.key in defaults
          const value = defaults[opt.key]
          return (
            <div key={opt.key} className={`p-3 rounded-lg border ${managed ? 'border-[var(--color-1)] bg-[var(--color-1)]/5' : 'border-gray-200 dark:border-gray-700'}`}>
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer">
                <input type="checkbox" checked={managed} onChange={e => toggleManaged(opt.key, e.target.checked)}
                  className="accent-[var(--color-1)]" />
                {opt.label}
                <span className="ml-auto text-[10px] font-normal text-gray-400">{opt.type}</span>
              </label>
              {managed && (
                <div className="mt-2">
                  {opt.type === 'category' ? (
                    <select value={value == null ? '' : String(value)}
                      onChange={e => setDefault(opt.key, e.target.value === '' ? null : Number(e.target.value))}
                      className={fieldCls}>
                      <option value="">— Sem categoria —</option>
                      {categoryRows.map(({ cat, depth }) => (
                        <option key={cat.id} value={cat.id}>
                          {'\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '↳ ' : '') + cat.name}
                        </option>
                      ))}
                    </select>
                  ) : opt.type === 'decimal' ? (
                    <input type="number" step="0.01" value={value == null ? '' : String(value)}
                      onChange={e => setDefault(opt.key, e.target.value === '' ? null : e.target.value)}
                      className={fieldCls} />
                  ) : opt.type === 'html' || opt.type === 'text' ? (
                    <textarea rows={opt.type === 'html' ? 4 : 2}
                      value={value == null ? '' : String(value)}
                      onChange={e => setDefault(opt.key, e.target.value)}
                      className={fieldCls} />
                  ) : (
                    <input value={value == null ? '' : String(value)}
                      onChange={e => setDefault(opt.key, e.target.value)}
                      className={fieldCls} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Seção: características ───────────────────────────────────────────────────

function CharacteristicsSection({ all, selected, onChange }: {
  all: CharacteristicRead[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  return (
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>Características da família</h2>
      <p className={sectionHintCls}>
        Marque as características que definem variação dentro da família (ex.: cor, tamanho).
        Os produtos individuais escolhem quais valores possuem.
      </p>
      {all.length === 0 ? <p className="text-sm text-gray-400">Nenhuma característica cadastrada.</p> : (
        <div className="flex flex-wrap gap-2">
          {all.map(c => {
            const on = selected.includes(c.id)
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on ? 'border-[var(--color-1)] bg-[var(--color-1)] text-[var(--on-color-1)]' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[var(--color-1)]'}`}>
                {c.name}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}


// ── Seção: imagens compartilhadas ────────────────────────────────────────────

function ImagesSection({ images, onPick, onRemove, pending, busy, onCropConfirm, onCropClose }: {
  images: ProductImageRead[]
  onPick: (file: File) => void
  onRemove: (img: ProductImageRead) => void
  pending: { src: string; name: string } | null
  busy: boolean
  onCropConfirm: (file: File) => void
  onCropClose: () => void
}) {
  return (
    <section className={sectionCls}>
      <h2 className={sectionTitleCls}>Imagens compartilhadas</h2>
      <p className={sectionHintCls}>
        Estas imagens aparecem em todos os produtos da família. Imagens vinculadas direto a um produto têm prioridade sobre as da família.
      </p>
      <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
        {images.map(img => (
          <div key={img.id} className="relative aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden group">
            <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover" />
            <button type="button" onClick={() => onRemove(img)}
              className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
              <Trash size={12} />
            </button>
          </div>
        ))}
        <label className="aspect-square border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-[var(--color-1)] hover:text-[var(--color-1)] cursor-pointer">
          <Plus size={20} />
          <span className="text-[11px] mt-1">Adicionar</span>
          <input type="file" accept="image/*" className="hidden"
            onChange={e => e.target.files?.[0] && onPick(e.target.files[0])} />
        </label>
      </div>
      {pending && (
        <ImageCropModal src={pending.src} fileName={pending.name}
          onClose={onCropClose} onConfirm={onCropConfirm} />
      )}
      {busy && <p className="text-xs text-gray-400 mt-2">Enviando…</p>}
    </section>
  )
}

// ── Seção: produtos da família ───────────────────────────────────────────────

function ProductsSection({ products, familyId }: { products: ProductRead[]; familyId: number }) {
  return (
    <section className={sectionCls}>
      <div className="flex items-start justify-between mb-1">
        <h2 className={sectionTitleCls}>Produtos da família</h2>
        <Link to={`/cadastros/produtos?family=${familyId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-1)] hover:underline">
          <Pencil size={12} /> Gerenciar
        </Link>
      </div>
      <p className={sectionHintCls}>
        {products.length === 0
          ? 'Nenhum produto vinculado. Vincule produtos pela tela de produtos ou pelo wizard de combinações.'
          : `${products.length} produto(s) vinculado(s).`}
      </p>
      {products.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700"><tr>
            <th className="text-left py-2 pl-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-32">Código</th>
            <th className="text-left py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Produto</th>
            <th className="text-right py-2 pr-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <td className="py-2 pl-3 font-mono text-xs text-gray-600 dark:text-gray-300">{p.code}</td>
                <td className="py-2 font-semibold text-gray-800 dark:text-gray-100">{p.name}</td>
                <td className="py-2 pr-3 text-right">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
                    style={{ background: p.active ? 'var(--color-success)' : '#cbd5e1', color: p.active ? 'var(--on-color-success)' : '#475569' }}>
                    {p.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
