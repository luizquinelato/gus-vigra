import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleNotch, FloppyDisk, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  categoriesApi, characteristicsApi, familiesApi, productImagesApi,
  type CategoryRead, type CharacteristicRead, type FamilyDefaults,
  type FamilyManagedFieldOption, type FamilyRead, type FamilyWrite,
} from '../services/cadastrosApi'
import { CurrencyInput, MeasureInput, NcmInput, flattenCategories } from './ProductFormModal'
import { ImageCropModal } from './ImageCropModal'
import { RichTextEditor } from './RichTextEditor'
import { useModalShortcuts } from '../hooks/useModalShortcuts'
import { useConfirm } from '../contexts/ConfirmContext'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)]'
const sectionCls = 'border border-gray-200 dark:border-gray-700 rounded-lg p-4'
const sectionTitleCls = 'text-sm font-bold text-gray-800 dark:text-gray-100'
const sectionHintCls = 'text-xs text-gray-600 dark:text-gray-400 mt-0.5'
const managedCheckboxCls = 'h-4 w-4 rounded cursor-pointer accent-[var(--color-1)] [color-scheme:light] dark:[color-scheme:dark]'

// Item da galeria em rascunho. id=null indica upload pendente (já no storage,
// mas ainda não vinculado à família) — só persiste no "Salvar".
interface DraftImageItem {
  id:       number | null
  url:      string
  alt_text: string | null
}

interface Props {
  initial: FamilyRead | null
  // Contagem de produtos vinculados — usada no confirm de impacto e no
  // texto de aviso da seção de campos gerenciados (modo edição).
  productsCount?: number
  onClose: () => void
  onSaved: (saved: FamilyRead) => void
}

export default function FamilyFormModal({ initial, productsCount = 0, onClose, onSaved }: Props) {
  const isEdit = initial != null
  const confirm = useConfirm()

  // Drafts editáveis (sem auto-save; persiste pelo botão "Salvar").
  const [name, setName] = useState(initial?.name ?? '')
  const [defaults, setDefaults] = useState<FamilyDefaults>(initial?.defaults ?? {})
  const [characteristicIds, setCharacteristicIds] = useState<number[]>(initial?.characteristic_ids ?? [])

  const [options, setOptions] = useState<FamilyManagedFieldOption[]>([])
  const [categories, setCategories] = useState<CategoryRead[]>([])
  const [characteristics, setCharacteristics] = useState<CharacteristicRead[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Imagens em rascunho — entradas com id=null são uploads pendentes (ainda
  // não vinculados à família). Persistência só acontece em "Salvar",
  // espelhando o comportamento dos outros campos do formulário.
  const [imagesDraft, setImagesDraft] = useState<DraftImageItem[]>([])
  const [removedImageIds, setRemovedImageIds] = useState<Set<number>>(new Set())
  const [pending, setPending] = useState<{ src: string; name: string } | null>(null)
  const [busyImg, setBusyImg] = useState(false)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)

  useModalShortcuts({ onClose, onSubmit: () => { void handleSave() }, enabled: !saving })

  useEffect(() => {
    setLoading(true)
    const tasks: Promise<unknown>[] = [
      familiesApi.getManagedFieldOptions().then(setOptions),
      categoriesApi.list({ only_active: true }).then(setCategories),
      characteristicsApi.list({ only_active: true }).then(setCharacteristics),
    ]
    if (isEdit) {
      tasks.push(
        productImagesApi.listByFamily(initial!.id, { only_active: true })
          .then(imgs => setImagesDraft(imgs.map(i => ({ id: i.id, url: i.url, alt_text: i.alt_text })))),
      )
    }
    Promise.all(tasks)
      .catch(() => toast.error('Erro ao carregar família.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categoryRows = useMemo(() => flattenCategories(categories), [categories])
  const managedCount = Object.keys(defaults).length

  function toggleManaged(key: string, on: boolean) {
    setDefaults(prev => {
      const next = { ...prev }
      if (on) { if (!(key in next)) next[key] = '' } else { delete next[key] }
      return next
    })
  }
  function setDefault(key: string, value: string | number | null) {
    setDefaults(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('Nome é obrigatório.'); return }
    // Em edição, qualquer salvamento propaga os campos gerenciados a todos os
    // produtos vinculados — confirma antes para evitar mudanças acidentais em
    // massa. Sem produtos vinculados ou sem campos gerenciados, nenhum impacto
    // a anunciar.
    if (isEdit && productsCount > 0 && managedCount > 0) {
      const ok = await confirm({
        variant: 'warning',
        title:   'Confirmar atualização em massa',
        message: (
          <>
            Salvar irá sobrescrever <strong>{managedCount} campo{managedCount !== 1 ? 's' : ''} gerenciado{managedCount !== 1 ? 's' : ''}</strong> em <strong>{productsCount} produto{productsCount !== 1 ? 's' : ''} vinculado{productsCount !== 1 ? 's' : ''}</strong> a esta família.
            <br /><br />
            Os valores atuais nesses produtos serão substituídos pelos defaults da família.
          </>
        ),
        confirmLabel: 'Salvar e propagar',
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const body: FamilyWrite = { name: name.trim(), defaults, characteristic_ids: characteristicIds }
      const saved = isEdit
        ? await familiesApi.patch(initial!.id, body)
        : await familiesApi.create(body)
      // Persiste alterações da galeria: 1) softDelete dos removidos (só edição
      // — em criação não há ids reais); 2) attach dos novos pendentes (id=null)
      // preservando a ordem visual.
      for (const id of removedImageIds) {
        try { await productImagesApi.softDelete(id) } catch { /* tolerante */ }
      }
      for (let idx = 0; idx < imagesDraft.length; idx++) {
        const it = imagesDraft[idx]
        if (it.id != null) continue
        await productImagesApi.attachToFamily(saved.id, { url: it.url, alt_text: it.alt_text, sort_order: idx })
      }
      // Auto-aplica os campos gerenciados em edição. Não quebra o save se a
      // propagação falhar — apenas avisa: a família já foi persistida.
      if (isEdit && managedCount > 0) {
        try {
          const r = await familiesApi.applyDefaults(saved.id)
          toast.success(`Família atualizada e ${r.products_count} produto(s) sincronizados.`)
        } catch {
          toast.warning('Família salva, mas a propagação aos produtos falhou. Tente novamente.')
        }
      } else {
        toast.success(isEdit ? 'Família atualizada.' : 'Família criada.')
      }
      onSaved(saved)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar família.')
    } finally { setSaving(false) }
  }

  function handlePick(file: File) {
    const reader = new FileReader()
    reader.onload = () => setPending({ src: String(reader.result), name: file.name })
    reader.readAsDataURL(file)
  }
  async function handleCropConfirm(file: File) {
    setBusyImg(true)
    try {
      // Sobe o blob para o storage (precisamos da URL agora), mas só registra
      // no rascunho — o vínculo com a família é criado em "Salvar".
      const { url } = await productImagesApi.upload(file)
      setImagesDraft(prev => [...prev, { id: null, url, alt_text: null }])
      setPending(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao enviar imagem.')
    } finally { setBusyImg(false) }
  }

  function removeImage(item: DraftImageItem) {
    if (!confirm('Remover imagem?')) return
    // Remove visualmente e, se já estava persistida, marca para softDelete no
    // próximo "Salvar". Se era um upload pendente (id=null), só some (o blob
    // fica órfão no storage e é varrido pelo --cleanup-uploads).
    setImagesDraft(prev => prev.filter(i => i !== item))
    if (item.id != null) setRemovedImageIds(prev => { const n = new Set(prev); n.add(item.id!); return n })
  }

  // Renderiza o input apropriado por tipo lógico. `disabled` reflete o estado
  // do checkbox da família — o input fica visível mesmo desativado para evitar
  // reflow ao alternar o controle.
  function renderInput(opt: FamilyManagedFieldOption, disabled: boolean) {
    const value = defaults[opt.key]
    const noop = () => {}
    if (opt.type === 'category') {
      return (
        <select value={value == null ? '' : String(value)} disabled={disabled}
          onChange={e => setDefault(opt.key, e.target.value === '' ? null : Number(e.target.value))}
          className={`${fieldCls} disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-800`}>
          <option value="">— Sem categoria —</option>
          {categoryRows.map(({ cat, depth }) => (
            <option key={cat.id} value={cat.id}>
              {'\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '↳ ' : '') + cat.name}
            </option>
          ))}
        </select>
      )
    }
    if (opt.type === 'currency') {
      return <CurrencyInput value={value == null ? '0' : String(value)}
        onChange={disabled ? noop : v => setDefault(opt.key, v)} maxIntDigits={8} disabled={disabled} />
    }
    if (opt.type === 'decimal') {
      return <MeasureInput value={value == null ? null : String(value)}
        onChange={disabled ? noop : v => setDefault(opt.key, v)}
        unit={opt.key === 'weight_kg' ? 'kg' : 'cm'}
        decimals={opt.key === 'weight_kg' ? 3 : 2}
        maxIntDigits={opt.key === 'weight_kg' ? 7 : 8}
        disabled={disabled} />
    }
    if (opt.type === 'html') {
      return (
        <div className={disabled ? 'opacity-60 pointer-events-none select-none' : ''}>
          <RichTextEditor value={value == null ? '' : String(value)}
            onChange={v => setDefault(opt.key, v)}
            placeholder="Descrição padrão da família, propagada a todos os produtos vinculados…" />
        </div>
      )
    }
    if (opt.type === 'text') {
      return (
        <textarea rows={2} disabled={disabled}
          value={value == null ? '' : String(value)}
          onChange={e => setDefault(opt.key, e.target.value)}
          className={`${fieldCls} resize-y disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-800`} />
      )
    }
    // Casos específicos por chave (input com máscara) antes do fallback texto.
    if (opt.key === 'ncm') {
      return <NcmInput value={value == null ? null : String(value)}
        onChange={v => setDefault(opt.key, v)} disabled={disabled} />
    }
    return (
      <input value={value == null ? '' : String(value)} disabled={disabled}
        onChange={e => setDefault(opt.key, e.target.value)}
        className={`${fieldCls} disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-800`} />
    )
  }

  // Tipos de campo que ocupam a largura inteira do grid (3 colunas) por
  // serem texto longo — ficam ruins espremidos numa coluna só.
  function isWideField(opt: FamilyManagedFieldOption) {
    return opt.type === 'html' || opt.type === 'text' || opt.key === 'meta_description'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header fixo: título + indicador de obrigatórios não rolam junto com
            o conteúdo, evitando que seções deslizem por cima deles. */}
        <div className="flex-shrink-0 px-6 pt-6 pb-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: isEdit ? 'var(--color-edit)' : 'var(--color-1)', color: isEdit ? 'var(--on-color-edit)' : 'var(--on-color-1)' }}>
                {isEdit ? <Pencil size={18} /> : <Plus size={18} />}
              </div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{isEdit ? 'Editar família' : 'Nova família'}</h2>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2"><span className="text-red-500">*</span> campos obrigatórios</p>
        </div>

        {loading ? (
          /* Skeleton com a mesma estrutura das seções reais — preserva a
             altura do modal e dá feedback visual de progresso em vez de uma
             linha de texto solta. */
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
              <CircleNotch size={16} className="animate-spin" />
              <span>Carregando família…</span>
            </div>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`${sectionCls} animate-pulse`}>
                <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
                <div className="h-2 w-64 bg-gray-100 dark:bg-gray-800 rounded mb-4" />
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-9 bg-gray-100 dark:bg-gray-800 rounded" />
                  <div className="h-9 bg-gray-100 dark:bg-gray-800 rounded" />
                  <div className="h-9 bg-gray-100 dark:bg-gray-800 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Básico — nome */}
            <section className={sectionCls}>
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Nome<span className="text-red-500 ml-0.5">*</span></span>
                <input value={name} onChange={e => setName(e.target.value)} className={`${fieldCls} mt-1`} autoFocus />
              </label>
            </section>

            {/* Campos genéricos — checkbox + label; quando marcado, input aparece.
                Em edição, salvar propaga automaticamente os campos marcados a
                todos os produtos vinculados (com confirmação). */}
            <section className={sectionCls}>
              <div className="mb-4">
                <h3 className={sectionTitleCls}>Campos genéricos</h3>
                <p className={sectionHintCls}>
                  Marque os campos que a família controla e defina o valor padrão.
                  {isEdit && productsCount > 0 && (
                    <> Ao salvar, esses valores serão aplicados aos <strong>{productsCount} produto{productsCount !== 1 ? 's' : ''} vinculado{productsCount !== 1 ? 's' : ''}</strong>.</>
                  )}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                {options.map(opt => {
                  const checked = opt.key in defaults
                  const wide = isWideField(opt)
                  return (
                    <div key={opt.key} className={wide ? 'lg:col-span-3 md:col-span-2' : ''}>
                      <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={checked}
                          onChange={e => toggleManaged(opt.key, e.target.checked)}
                          className={managedCheckboxCls} />
                        <span className={`text-xs font-semibold uppercase tracking-wider ${checked ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-500'}`}>
                          {opt.label}
                        </span>
                      </label>
                      {renderInput(opt, !checked)}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Características — chips toggleáveis. */}
            <section className={sectionCls}>
              <h3 className={sectionTitleCls}>Características</h3>
              <p className={sectionHintCls}>Define quais eixos (Cor, Tamanho…) a família espera. Os valores são escolhidos por produto.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {characteristics.map(c => {
                  const active = characteristicIds.includes(c.id)
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setCharacteristicIds(prev => active ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? 'text-[var(--on-color-1)]' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                      style={active ? { background: 'var(--color-1)' } : undefined}>
                      {c.name}
                    </button>
                  )
                })}
                {characteristics.length === 0 && (
                  <span className="text-sm text-gray-600 dark:text-gray-400">Nenhuma característica ativa. Crie em <Link to="/cadastros/caracteristicas" className="text-[var(--color-1)] hover:underline" onClick={onClose}>Cadastros · Características</Link>.</span>
                )}
              </div>
            </section>

            {/* Imagens compartilhadas — tiles fixos 96×96. */}
            <section className={sectionCls}>
              <h3 className={sectionTitleCls}>Imagens compartilhadas</h3>
              <p className={sectionHintCls}>Visíveis a todos os produtos da família. Cada produto pode ter imagens próprias adicionais. Alterações persistem ao clicar em <strong>Salvar</strong>.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {imagesDraft.map((img, idx) => (
                  <div key={img.id ?? `draft-${idx}`} className="relative w-24 h-24 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900 group border border-gray-200 dark:border-gray-700">
                    <img src={img.url} alt={img.alt_text ?? ''}
                      className="w-full h-full object-cover cursor-zoom-in"
                      onClick={() => setPreviewIdx(idx)} />
                    {img.id == null && (
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-white text-[9px] font-semibold uppercase tracking-wider"
                        title="Pendente — será vinculada ao salvar">Pendente</span>
                    )}
                    <button onClick={() => removeImage(img)}
                      className="absolute top-1 right-1 p-1 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remover"><Trash size={12} /></button>
                  </div>
                ))}
                <label className="w-24 h-24 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-[var(--color-1)] hover:text-[var(--color-1)] cursor-pointer transition-colors">
                  <Plus size={18} />
                  <span className="text-[10px] mt-0.5">Adicionar</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => e.target.files?.[0] && handlePick(e.target.files[0])} />
                </label>
              </div>
            </section>
          </div>
        )}

        {/* Footer fixo. */}
        <div className="flex-shrink-0 px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || loading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: (saving || loading) ? 0.6 : 1, cursor: (saving || loading) ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>

        {/* ImageCropModal compartilhado pela galeria. */}
        {pending && (
          <ImageCropModal src={pending.src} fileName={pending.name}
            onClose={() => setPending(null)} onConfirm={handleCropConfirm} />
        )}

        {/* Lightbox simples para preview das imagens da família. */}
        {previewIdx != null && imagesDraft[previewIdx] && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
            onClick={() => setPreviewIdx(null)}>
            <button onClick={() => setPreviewIdx(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
              title="Fechar"><X size={20} /></button>
            <img src={imagesDraft[previewIdx].url} alt={imagesDraft[previewIdx].alt_text ?? ''}
              className="block max-w-[85vw] max-h-[85vh] rounded-lg shadow-2xl"
              onClick={e => e.stopPropagation()} />
          </div>
        )}

        {busyImg && (
          <div className="fixed bottom-6 right-6 px-4 py-2 rounded-lg bg-gray-800 text-white text-xs shadow-lg">Enviando…</div>
        )}
      </div>
    </div>
  )
}
