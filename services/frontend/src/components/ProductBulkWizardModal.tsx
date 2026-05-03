import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, FloppyDisk, Image as ImageIcon, MagicWand, Plus, Trash, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  characteristicValuesApi, characteristicsApi, codeTemplatesApi,
  productImagesApi, productsBulkApi,
  type CategoryRead, type CharacteristicRead, type CharacteristicType,
  type CharacteristicValueRead, type CodeTemplatesRead,
  type FamilyRead, type ProductBulkItem,
  type ProductImageRead,
} from '../services/cadastrosApi'
import { slugify } from '../utils/slug'
import { CharacteristicCombobox } from './CharacteristicCombobox'
import { CharacteristicValueCombobox } from './CharacteristicValueCombobox'
import { FamilyCombobox } from './FamilyCombobox'
import { ImageCropModal } from './ImageCropModal'
import { CurrencyInput, flattenCategories } from './ProductFormModal'
import { TemplatedCodeInput, formatTemplate } from './TemplatedCodeInput'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

const fieldCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)] disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-800'

// Hint inline para campos travados pela família selecionada — mesmo padrão
// visual do ProductFormModal.
function ManagedHint() {
  return (
    <span className="ml-2 text-[10px] font-normal italic text-gray-500 dark:text-gray-400" title="Definido pela família — edite no detalhe da família">
      (controlado pela família)
    </span>
  )
}

interface Props {
  categories: CategoryRead[]
  families: FamilyRead[]
  characteristics: CharacteristicRead[]
  onFamilyCreated?: (created: FamilyRead) => void
  onCharacteristicCreated?: (created: CharacteristicRead) => void
  onClose: () => void
  onSaved: () => void
}

// Eixo da combinatória: characteristic + N valores (ids do catálogo).
// `lockedFromFamily` marca eixos derivados de family.characteristic_ids — a
// characteristic não pode ser trocada nem o eixo removido (só os valores).
interface Axis { characteristic_id: number | null; value_ids: number[]; lockedFromFamily?: boolean }

interface Base {
  family_id: number | null; codePrefix: string; namePrefix: string
  price: string; cost: string; unit: string; brand: string; category_id: number | null
}

interface Row {
  code: string; name: string; price: string; cost: string
  // Cada combinação: { characteristic_id, value_id } pré-resolvido para o backend.
  links: Array<{ characteristic_id: number; value_id: number }>
  // Cache de labels para exibir na revisão.
  labels: string[]
  // Imagem específica do produto (override da galeria compartilhada da família).
  // Persistida com product_id após o bulk create.
  imageUrl?: string | null
}

function cartesian(axes: Axis[]): Array<Array<{ characteristic_id: number; value_id: number }>> {
  const cleaned = axes.filter(a => a.characteristic_id != null && a.value_ids.length > 0)
  if (cleaned.length === 0) return []
  let acc: Array<Array<{ characteristic_id: number; value_id: number }>> = [[]]
  for (const a of cleaned) {
    const next: Array<Array<{ characteristic_id: number; value_id: number }>> = []
    for (const prev of acc) {
      for (const vid of a.value_ids) {
        next.push([...prev, { characteristic_id: a.characteristic_id!, value_id: vid }])
      }
    }
    acc = next
  }
  return acc
}

export function ProductBulkWizardModal({
  categories, families, characteristics,
  onFamilyCreated, onCharacteristicCreated, onClose, onSaved,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [base, setBase] = useState<Base>({
    family_id: null, codePrefix: '', namePrefix: '', price: '0', cost: '0', unit: 'un',
    brand: '', category_id: null,
  })
  // Começa vazio: usuário precisa clicar em "Adicionar característica" para
  // abrir a primeira linha — alinhado ao comportamento do CharacteristicEditor
  // do modal de produto.
  const [axes, setAxes] = useState<Axis[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  // Cache de valores por characteristic_id (compartilhado entre axes).
  const [valuesCache, setValuesCache] = useState<Record<number, CharacteristicValueRead[]>>({})
  // Galeria compartilhada da família: URLs já enviadas (upload-image) que
  // serão anexadas com family_id após a criação em bulk — todos os produtos
  // gerados passam a vê-las automaticamente via vínculo da família.
  const [sharedImages, setSharedImages] = useState<string[]>([])
  // Imagens já vinculadas à família selecionada — read-only, só pra contexto
  // visual. São editadas no detalhe da família, não aqui.
  const [existingFamilyImages, setExistingFamilyImages] = useState<ProductImageRead[]>([])
  // Crop pendente. `target` decide o destino: 'shared' adiciona a sharedImages;
  // { row: i } sobrescreve rows[i].imageUrl.
  const [pendingCrop, setPendingCrop] = useState<{
    src: string; name: string; target: 'shared' | { row: number }
  } | null>(null)
  const [uploading, setUploading] = useState(false)
  // Template de código + separador família vêm de system_settings.
  // Wizard sempre cria com família → o code de cada produto é montado como
  // `<código base (casa template)><separador><valores das características>`.
  // Sem template, mantém o fluxo antigo: prefixo livre + sufixo derivado.
  const [codeTpl, setCodeTpl] = useState<CodeTemplatesRead | null>(null)
  useEffect(() => {
    codeTemplatesApi.get().then(setCodeTpl).catch(() => { /* opcional */ })
  }, [])
  const tplStr = codeTpl?.template ?? ''
  const sepStr = codeTpl?.separator ?? ''
  const sepMissing = !!tplStr && !sepStr
  // Família já fixou os eixos da combinatória? Bloqueia adicionar mais
  // characteristics — o universo de variações é definido pela família.
  const familyLocksAxes = useMemo(() => {
    if (base.family_id == null) return false
    const fam = families.find(f => f.id === base.family_id)
    return (fam?.characteristic_ids?.length ?? 0) > 0
  }, [base.family_id, families])

  async function ensureValuesLoaded(characteristicId: number) {
    if (valuesCache[characteristicId]) return
    try {
      const list = await characteristicValuesApi.listByCharacteristic(characteristicId, { only_active: true })
      setValuesCache(prev => ({ ...prev, [characteristicId]: list }))
    } catch { /* silencioso */ }
  }

  useEffect(() => {
    axes.forEach(a => { if (a.characteristic_id != null) void ensureValuesLoaded(a.characteristic_id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usedCharIds = useMemo(
    () => new Set(axes.map(a => a.characteristic_id).filter((v): v is number => v != null)),
    [axes],
  )

  const familyName = base.family_id != null
    ? families.find(f => f.id === base.family_id)?.name ?? ''
    : ''

  const combos = useMemo(() => cartesian(axes), [axes])

  // Categorias indentadas por hierarquia (mesmo padrão do ProductFormModal).
  const categoryRows = useMemo(() => flattenCategories(categories), [categories])

  // Chaves controladas pela família selecionada — mesmo padrão do ProductFormModal.
  // Quando a família tem defaults, os campos base correspondentes ficam travados
  // e mostram o valor da família.
  const managedKeys = useMemo<Set<string>>(() => {
    if (base.family_id == null) return new Set()
    const fam = families.find(f => f.id === base.family_id)
    return new Set(Object.keys(fam?.defaults ?? {}))
  }, [base.family_id, families])
  const isManaged = (k: string) => managedKeys.has(k)

  // Espelha defaults da família no `base` ao trocar de família, garantindo que
  // os inputs travados exibam o valor real e que o bulk create grave esse valor.
  useEffect(() => {
    if (base.family_id == null) return
    const fam = families.find(f => f.id === base.family_id)
    const d = fam?.defaults
    if (!d || Object.keys(d).length === 0) return
    setBase(prev => ({
      ...prev,
      ...(d.price       != null ? { price:       String(d.price) }      : {}),
      ...(d.cost        != null ? { cost:        String(d.cost) }       : {}),
      ...(d.unit        != null ? { unit:        String(d.unit) }       : {}),
      ...(d.brand       != null ? { brand:       String(d.brand) }      : {}),
      ...(d.category_id != null ? { category_id: Number(d.category_id) }: {}),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.family_id, families])

  // Popula eixos a partir das characteristics da família selecionada. Os eixos
  // gerados ficam travados (não removíveis, characteristic não trocável) — só
  // os valores ainda são escolhidos pelo usuário. Eixos extras adicionados
  // manualmente para outras characteristics são preservados.
  useEffect(() => {
    if (base.family_id == null) {
      setAxes(prev => prev.filter(a => !a.lockedFromFamily))
      return
    }
    const fam = families.find(f => f.id === base.family_id)
    const famCharIds = fam?.characteristic_ids ?? []
    setAxes(prev => {
      const userAxes = prev.filter(a =>
        !a.lockedFromFamily && (a.characteristic_id == null || !famCharIds.includes(a.characteristic_id)),
      )
      const lockedAxes: Axis[] = famCharIds.map(cid => {
        const existing = prev.find(a => a.characteristic_id === cid)
        return { characteristic_id: cid, value_ids: existing?.value_ids ?? [], lockedFromFamily: true }
      })
      return [...lockedAxes, ...userAxes]
    })
    for (const cid of famCharIds) void ensureValuesLoaded(cid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.family_id, families])

  // Carrega as imagens já vinculadas à família selecionada para exibir como
  // contexto visual (read-only). São gerenciadas no detalhe da família.
  useEffect(() => {
    if (base.family_id == null) { setExistingFamilyImages([]); return }
    let cancelled = false
    productImagesApi.listByFamily(base.family_id, { only_active: true })
      .then(imgs => { if (!cancelled) setExistingFamilyImages(imgs) })
      .catch(() => { if (!cancelled) setExistingFamilyImages([]) })
    return () => { cancelled = true }
  }, [base.family_id])

  function setAxisCharacteristic(idx: number, charId: number | null) {
    if (charId != null) {
      const dupIdx = axes.findIndex((a, i) => i !== idx && a.characteristic_id === charId)
      if (dupIdx !== -1) {
        toast.info('Característica já adicionada — linha removida.')
        setAxes(prev => prev.filter((_, i) => i !== idx))
        return
      }
      void ensureValuesLoaded(charId)
    }
    setAxes(prev => prev.map((a, i) => i === idx ? { characteristic_id: charId, value_ids: [] } : a))
  }
  function addAxisValue(idx: number, valueId: number | null) {
    if (valueId == null) return
    setAxes(prev => prev.map((a, i) => {
      if (i !== idx) return a
      if (a.value_ids.includes(valueId)) return a
      return { ...a, value_ids: [...a.value_ids, valueId] }
    }))
  }
  function removeAxisValue(idx: number, valueId: number) {
    setAxes(prev => prev.map((a, i) => i === idx ? { ...a, value_ids: a.value_ids.filter(v => v !== valueId) } : a))
  }

  async function createCharacteristic(name: string, type: CharacteristicType) {
    const created = await characteristicsApi.create({ name, type })
    onCharacteristicCreated?.(created)
    return created
  }
  async function createValue(charId: number, body: { value: string; hex_color?: string | null; numeric_value?: string | null; unit?: string | null }) {
    const created = await characteristicValuesApi.create(charId, body)
    setValuesCache(prev => ({ ...prev, [charId]: [...(prev[charId] ?? []), created] }))
    return created
  }

  function buildRows() {
    if (base.family_id == null) { toast.error('Família é obrigatória.'); return }
    if (combos.length === 0) { toast.error('Defina ao menos uma característica com valores.'); return }
    const next: Row[] = combos.map(combo => {
      const labels = combo.map(({ characteristic_id, value_id }) => {
        const c = characteristics.find(x => x.id === characteristic_id)
        const v = valuesCache[characteristic_id]?.find(x => x.id === value_id)
        return `${c?.name ?? '?'}: ${v?.value ?? '?'}`
      })
      // Sufixo do code: une cada valor da combinação por separador apropriado
      // (separador família quando há template; '-' senão).
      const joiner = tplStr ? sepStr : '-'
      const codeSuffix = combo.map(({ value_id }) => {
        const allValues = Object.values(valuesCache).flat()
        const v = allValues.find(x => x.id === value_id)
        return (v?.value ?? '').toUpperCase().replace(/\s+/g, '')
      }).filter(Boolean).join(joiner)
      const nameSuffix = combo.map(({ value_id }) => {
        const allValues = Object.values(valuesCache).flat()
        return allValues.find(x => x.id === value_id)?.value ?? ''
      }).filter(Boolean).join(' / ')
      // Com template: <código base formatado><sep><sufixo>. Sem template:
      // <prefixo livre>-<sufixo> (comportamento antigo).
      const code = tplStr
        ? `${formatTemplate(tplStr, base.codePrefix.trim())}${sepStr}${codeSuffix}`
        : `${base.codePrefix.trim()}${base.codePrefix.trim() ? '-' : ''}${codeSuffix}`
      return {
        code,
        name: `${base.namePrefix.trim()} ${nameSuffix}`.trim(),
        price: base.price, cost: base.cost,
        links: combo, labels,
      }
    })
    setRows(next); setStep(2)
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows(rs => rs.map((r, k) => k === i ? { ...r, ...patch } : r))
  }
  function removeRow(i: number) { setRows(rs => rs.filter((_, k) => k !== i)) }

  // Pré-visualização local (DataURL) → abre o modal de crop. O upload e a
  // persistência só acontecem em handleCropConfirm/handleSave.
  function pickImageFile(file: File, target: 'shared' | { row: number }) {
    const reader = new FileReader()
    reader.onload = () => setPendingCrop({ src: String(reader.result), name: file.name, target })
    reader.readAsDataURL(file)
  }

  async function handleCropConfirm(file: File) {
    if (!pendingCrop) return
    setUploading(true)
    try {
      const { url } = await productImagesApi.upload(file)
      const target = pendingCrop.target
      if (target === 'shared') {
        setSharedImages(prev => [...prev, url])
      } else {
        updateRow(target.row, { imageUrl: url })
      }
      setPendingCrop(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao enviar imagem.')
    } finally { setUploading(false) }
  }

  function removeSharedImage(idx: number) {
    setSharedImages(prev => prev.filter((_, k) => k !== idx))
  }

  // Enter no passo 1 avança para a revisão; no passo 2 dispara o Salvar.
  useModalShortcuts({
    onClose,
    onSubmit: () => { if (step === 1) buildRows(); else void handleSave() },
  })

  async function handleSave() {
    if (rows.length === 0) { toast.error('Nenhum produto para criar.'); return }
    if (rows.some(r => !r.code.trim() || !r.name.trim())) { toast.error('Todos precisam de código e nome.'); return }
    setSaving(true)
    try {
      const items: ProductBulkItem[] = rows.map(r => ({
        code: r.code.trim(), name: r.name.trim(),
        slug: slugify(`${familyName}-${r.code}`),
        family_id: base.family_id, characteristics: r.links,
        price: r.price, cost: r.cost, unit: base.unit, type: 'simple',
        brand: base.brand.trim() || null, category_id: base.category_id,
      }))
      const created = await productsBulkApi.create({ family_id: base.family_id, items })
      // Anexa imagens pós-criação. Compartilhadas vão com family_id (todos os
      // produtos da família passam a vê-las); individuais vão com product_id
      // só. Falhas em uma imagem não abortam as demais — o produto já existe.
      if (sharedImages.length > 0 && created.length > 0) {
        const anchorId = created[0].id
        for (let k = 0; k < sharedImages.length; k++) {
          try {
            await productImagesApi.attach(anchorId, {
              url: sharedImages[k], family_id: base.family_id, sort_order: k,
            })
          } catch { toast.error(`Falha ao anexar imagem compartilhada #${k + 1}.`) }
        }
      }
      for (let i = 0; i < rows.length; i++) {
        const url = rows[i].imageUrl
        if (!url) continue
        try {
          await productImagesApi.attach(created[i].id, {
            url, family_id: null, sort_order: 0,
          })
        } catch { toast.error(`Falha ao anexar imagem do produto "${rows[i].name}".`) }
      }
      toast.success(`${items.length} produtos criados.`)
      onSaved()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao criar produtos.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-2)', color: 'var(--on-color-2)' }}>
              <MagicWand size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
              Wizard de família {step === 2 && <span className="text-xs text-gray-400 font-normal">· revisar</span>}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3"><span className="text-red-500">*</span> campos obrigatórios</p>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Família<span className="text-red-500 ml-0.5">*</span></span>
                <div className="mt-1">
                  <FamilyCombobox value={base.family_id}
                    onChange={id => setBase(b => ({ ...b, family_id: id }))}
                    options={families} onCreated={onFamilyCreated}
                    placeholder="Buscar ou criar família…" />
                </div>
              </div>
              {/* Com template: input mascarado para o "código base" da família;
                  cada row do passo 2 vira <base><sep><variação>. Sem template:
                  prefixo livre concatenado com '-' (comportamento legado). */}
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  {tplStr ? 'Código base da família' : 'Prefixo do código'}
                  {tplStr && <span className="ml-1 text-[10px] italic text-gray-500">(formato {tplStr}{sepStr}…)</span>}
                </span>
                <div className="mt-1">
                  <TemplatedCodeInput value={base.codePrefix}
                    onChange={v => setBase(b => ({ ...b, codePrefix: v }))}
                    template={tplStr}
                    placeholder={tplStr ? undefined : 'ex: CAFE'} />
                </div>
              </label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Prefixo do nome</span>
                <input value={base.namePrefix} onChange={e => setBase(b => ({ ...b, namePrefix: e.target.value }))} className={`${fieldCls} mt-1`} placeholder="ex: Café Especial" /></label>
              {sepMissing && (
                <p className="col-span-2 text-[11px] text-amber-700 dark:text-amber-400">
                  Template de código configurado, mas separador família não definido — configure em <span className="font-mono">Configurações → Códigos</span>.
                </p>
              )}
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Preço base{isManaged('price') && <ManagedHint />}</span>
                <div className="mt-1"><CurrencyInput value={base.price} onChange={v => setBase(b => ({ ...b, price: v }))} maxIntDigits={8} disabled={isManaged('price')} /></div></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Custo base{isManaged('cost') && <ManagedHint />}</span>
                <div className="mt-1"><CurrencyInput value={base.cost} onChange={v => setBase(b => ({ ...b, cost: v }))} maxIntDigits={8} disabled={isManaged('cost')} /></div></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Unidade{isManaged('unit') && <ManagedHint />}</span>
                <input value={base.unit} onChange={e => setBase(b => ({ ...b, unit: e.target.value }))} className={`${fieldCls} mt-1`} disabled={isManaged('unit')} /></label>
              <label className="block"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Categoria{isManaged('category_id') && <ManagedHint />}</span>
                <select value={base.category_id ?? ''} onChange={e => setBase(b => ({ ...b, category_id: e.target.value === '' ? null : Number(e.target.value) }))} className={`${fieldCls} mt-1`} disabled={isManaged('category_id')}>
                  <option value="">— Sem categoria —</option>
                  {categoryRows.map(({ cat, depth }) => (
                    <option key={cat.id} value={cat.id}>
                      {'\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '↳ ' : '') + cat.name}
                    </option>
                  ))}
                </select></label>
              <label className="block col-span-2"><span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Marca{isManaged('brand') && <ManagedHint />}</span>
                <input value={base.brand} onChange={e => setBase(b => ({ ...b, brand: e.target.value }))} className={`${fieldCls} mt-1`} disabled={isManaged('brand')} /></label>
            </div>

            <div>
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Características (eixos da combinatória)</span>
              {/* Layout alinhado ao CharacteristicEditor: characteristic e value
                  combos lado-a-lado em cada linha. Como aqui cada eixo aceita
                  N valores (combinatória), os valores escolhidos aparecem como
                  chips logo abaixo da linha. */}
              <div className="mt-1 space-y-2">
                {axes.length === 0 && (
                  <p className="text-xs text-gray-400">Nenhuma característica. Ex: Cor = [Preto, Branco], Tamanho = [P, M, G].</p>
                )}
                {axes.map((a, i) => {
                  const charType = a.characteristic_id != null
                    ? (characteristics.find(c => c.id === a.characteristic_id)?.type as CharacteristicType | undefined)
                    : undefined
                  const cachedValues = a.characteristic_id != null ? (valuesCache[a.characteristic_id] ?? []) : []
                  const remainingValues = cachedValues.filter(v => !a.value_ids.includes(v.id))
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          {a.lockedFromFamily ? (
                            <div className="w-full px-3 py-2 text-sm box-border min-h-[38px] rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2 opacity-80 cursor-not-allowed"
                              title="Definida pela família — edite no detalhe da família">
                              <span>{characteristics.find(c => c.id === a.characteristic_id)?.name ?? `#${a.characteristic_id}`}</span>
                              <span className="text-[10px] italic text-gray-500 dark:text-gray-400">(família)</span>
                            </div>
                          ) : (
                            <CharacteristicCombobox value={a.characteristic_id}
                              onChange={id => setAxisCharacteristic(i, id)}
                              options={characteristics}
                              excludeIds={Array.from(usedCharIds).filter(id => id !== a.characteristic_id)}
                              onCreate={createCharacteristic} />
                          )}
                        </div>
                        <div className="flex-1">
                          <CharacteristicValueCombobox value={null}
                            onChange={vid => addAxisValue(i, vid)}
                            options={remainingValues}
                            disabled={a.characteristic_id == null}
                            characteristicType={charType ?? 'text'}
                            onCreate={a.characteristic_id != null
                              ? body => createValue(a.characteristic_id!, body)
                              : undefined} />
                        </div>
                        <button type="button" onClick={() => setAxes(xs => xs.filter((_, k) => k !== i))}
                          className={`text-gray-400 hover:text-red-600 px-2 ${a.lockedFromFamily ? 'invisible' : ''}`}
                          disabled={a.lockedFromFamily}><Trash size={15} /></button>
                      </div>
                      {a.characteristic_id != null && a.value_ids.length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-1">
                          {a.value_ids.map(vid => {
                            const v = cachedValues.find(x => x.id === vid)
                            return (
                              <span key={vid} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                {charType === 'color' && v?.hex_color && (
                                  <span className="inline-block w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600" style={{ backgroundColor: v.hex_color }} />
                                )}
                                {v?.value ?? `#${vid}`}
                                {charType === 'number' && v?.unit && <span className="text-gray-400">{v.unit}</span>}
                                <button type="button" onClick={() => removeAxisValue(i, vid)} className="text-gray-400 hover:text-red-500"><X size={10} /></button>
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                <button type="button" disabled={familyLocksAxes}
                  onClick={() => setAxes(xs => [...xs, { characteristic_id: null, value_ids: [] }])}
                  title={familyLocksAxes ? 'Família já define as características — edite no detalhe da família.' : undefined}
                  className="text-xs inline-flex items-center gap-1 text-[var(--color-1)] hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed">
                  <Plus size={12} /> Adicionar característica
                </button>
                {familyLocksAxes && (
                  <p className="text-[11px] text-gray-400 mt-1 italic">Família já define as características — edite no detalhe da família.</p>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-2">Combinações geradas: <strong>{combos.length}</strong></p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Revisar e ajustar cada produto. Ao salvar, todos serão criados com a família <strong>{familyName || `#${base.family_id}`}</strong>.
            </p>

            {/* Galeria compartilhada da família: as já vinculadas (read-only,
                editadas no detalhe da família) + as novas a anexar com
                family_id após o bulk create. Override por produto vai na
                coluna "Imagem" da tabela abaixo. */}
            <div>
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 inline-flex items-center gap-1">
                <ImageIcon size={13} /> Imagens compartilhadas pela família
              </span>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Aplicadas a todos os produtos criados. As marcadas com <strong>(família)</strong> já estão vinculadas e são editadas no detalhe da família.
              </p>
              <div className="mt-2 grid grid-cols-6 gap-2">
                {existingFamilyImages.map(img => (
                  <div key={`fam-${img.id}`} className="relative aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
                    title="Definida pela família — edite no detalhe da família">
                    <img src={img.url} alt={img.alt_text ?? ''} className="w-full h-full object-cover opacity-90" />
                    <span className="absolute top-1 left-1 text-[9px] px-1 py-0.5 rounded bg-black/60 text-white uppercase tracking-wider">família</span>
                  </div>
                ))}
                {sharedImages.map((url, idx) => (
                  <div key={url} className="relative aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden group">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-white text-[9px] font-semibold uppercase tracking-wider"
                      title="Pendente — será vinculada à família ao salvar">Pendente</span>
                    <button type="button" onClick={() => removeSharedImage(idx)}
                      className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                      <Trash size={10} />
                    </button>
                  </div>
                ))}
                <label className="aspect-square border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-[var(--color-1)] hover:text-[var(--color-1)] cursor-pointer">
                  <Plus size={16} />
                  <span className="text-[10px] mt-0.5">Adicionar</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) { pickImageFile(e.target.files[0], 'shared'); e.target.value = '' } }} />
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-12">Img</th>
                  <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Características</th>
                  <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-40">Código<span className="text-red-500 ml-0.5">*</span></th>
                  <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">Nome<span className="text-red-500 ml-0.5">*</span></th>
                  <th className="text-right pb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 w-24">Preço</th>
                  <th className="w-10" />
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : ''}>
                      <td className="py-2 pl-2">
                        {r.imageUrl ? (
                          <div className="relative w-10 h-10 rounded overflow-hidden group bg-gray-100 dark:bg-gray-900">
                            <img src={r.imageUrl} alt="" className="w-full h-full object-cover" />
                            <button type="button" onClick={() => updateRow(i, { imageUrl: null })}
                              title="Remover imagem do produto"
                              className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash size={12} />
                            </button>
                          </div>
                        ) : (
                          <label title="Adicionar imagem só deste produto"
                            className="w-10 h-10 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded flex items-center justify-center text-gray-400 hover:border-[var(--color-1)] hover:text-[var(--color-1)] cursor-pointer">
                            <Plus size={12} />
                            <input type="file" accept="image/*" className="hidden"
                              onChange={e => { if (e.target.files?.[0]) { pickImageFile(e.target.files[0], { row: i }); e.target.value = '' } }} />
                          </label>
                        )}
                      </td>
                      <td className="py-2 text-xs text-gray-500 dark:text-gray-400">
                        {r.labels.join(', ')}
                      </td>
                      <td className="py-2"><TemplatedCodeInput value={r.code}
                        onChange={v => updateRow(i, { code: v })}
                        template={tplStr}
                        freeAfter={tplStr && sepStr ? sepStr : undefined}
                        className={`${fieldCls} text-xs font-mono`} /></td>
                      <td className="py-2"><input value={r.name} onChange={e => updateRow(i, { name: e.target.value })} className={`${fieldCls} text-xs`} /></td>
                      <td className="py-2"><CurrencyInput value={r.price} onChange={v => updateRow(i, { price: v })} maxIntDigits={8} /></td>
                      <td className="py-2 text-right pr-2"><button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-600"><Trash size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 mt-6">
          {step === 2 ? (
            <button onClick={() => setStep(1)} className="inline-flex items-center gap-1 px-4 py-2 text-sm rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
              <ArrowLeft size={14} /> Voltar
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
              style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
            {step === 1 ? (
              <button onClick={buildRows}
                className="inline-flex items-center gap-1 px-5 py-2 rounded-lg text-sm font-semibold border-none"
                style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}>
                Avançar <ArrowRight size={14} />
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
                style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
                <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} /> Criar {rows.length} produtos
              </button>
            )}
          </div>
        </div>
      </div>

      {pendingCrop && (
        <ImageCropModal src={pendingCrop.src} fileName={pendingCrop.name}
          onClose={() => { if (!uploading) setPendingCrop(null) }}
          onConfirm={handleCropConfirm} />
      )}
    </div>
  )
}
