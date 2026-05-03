import { useEffect, useState } from 'react'
import { FloppyDisk, Hash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { codeTemplatesApi, type CodeTemplatesRead } from '../services/cadastrosApi'
import {
  TemplatedCodeInput, TEMPLATE_TOKENS, fieldCls, formatTemplate,
} from '../components/TemplatedCodeInput'

const sectionCls = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4'

const EXAMPLES = ['CAFE-1234', 'AB-9999', 'PROD_001', 'XYZ.42']

export default function CodeTemplatesPage() {
  const [loaded, setLoaded] = useState<CodeTemplatesRead | null>(null)
  const [draft,  setDraft]  = useState<CodeTemplatesRead>({ template: '', separator: '', allow_legacy: true })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [previewTpl, setPreviewTpl] = useState('')

  useEffect(() => {
    setLoading(true)
    codeTemplatesApi.get()
      .then(d => { setLoaded(d); setDraft(d) })
      .catch(() => toast.error('Erro ao carregar templates.'))
      .finally(() => setLoading(false))
  }, [])

  const dirty = !!loaded && (
    draft.template !== loaded.template ||
    draft.separator !== loaded.separator ||
    draft.allow_legacy !== loaded.allow_legacy
  )
  // Separador é obrigatório quando há template definido (wizard precisa dele).
  const sepMissing = !!draft.template && !draft.separator
  const canSave = dirty && !sepMissing

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      const payload: Partial<CodeTemplatesRead> = {}
      if (loaded?.template !== draft.template) payload.template = draft.template
      if (loaded?.separator !== draft.separator) payload.separator = draft.separator
      if (loaded?.allow_legacy !== draft.allow_legacy) payload.allow_legacy = draft.allow_legacy
      await codeTemplatesApi.update(payload)
      setLoaded(draft)
      toast.success('Configuração atualizada.')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  // Exemplo combinado: template + separador + 2 valores arbitrários para
  // mostrar como o wizard vai gerar variações.
  const wizardExample = draft.template && draft.separator
    ? `${formatTemplate(draft.template, 'CAFE1234')}${draft.separator}BRANCO${draft.separator}P`
    : null

  return (
    <div className="min-h-full p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Hash size={24} weight="duotone" style={{ color: 'var(--color-1)' }} />
            Códigos de produto
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Define o formato (máscara) dos códigos. Vazio = sem enforcement.
          </p>
        </div>
        <button onClick={handleSave} disabled={!canSave || saving}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none transition-all"
          style={{
            background: canSave ? 'var(--color-save)' : '#e2e8f0',
            color:      canSave ? 'var(--on-color-save)' : '#94a3b8',
            opacity:    saving ? 0.6 : 1,
            cursor:     !canSave || saving ? 'not-allowed' : 'pointer',
          }}>
          <FloppyDisk size={15} className={saving ? 'animate-spin' : undefined} />
          Salvar
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Carregando…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className={sectionCls}>
            <header>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">Template do código</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Aplicado a todos os produtos. Ex.: <code className="font-mono">AAA-9999</code> → <code className="font-mono">CAFE-1234</code>.
              </p>
            </header>
            <input value={draft.template} onChange={e => setDraft({ ...draft, template: e.target.value })}
              className={fieldCls + ' font-mono'} placeholder="ex.: AAA-9999  (vazio = sem enforcement)" />
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Preview</label>
              <TemplatedCodeInput value={previewTpl} onChange={setPreviewTpl}
                template={draft.template} placeholder={draft.template ? undefined : 'Sem template — input livre'} />
              {draft.template && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Resultado: <span className="font-mono font-bold text-gray-700 dark:text-gray-200">{previewTpl || formatTemplate(draft.template, '')}</span>
                </p>
              )}
            </div>
          </section>

          <section className={sectionCls}>
            <header>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">Separador de família</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                1 caractere único usado pelo wizard de família para concatenar variações ao código base.
                {draft.template && <span className="text-amber-600 dark:text-amber-400"> Obrigatório quando há template.</span>}
              </p>
            </header>
            <input value={draft.separator} maxLength={1}
              onChange={e => setDraft({ ...draft, separator: e.target.value.slice(0, 1) })}
              className={fieldCls + ' font-mono w-20 text-center text-lg'}
              placeholder="/" aria-invalid={sepMissing || undefined} />
            {wizardExample && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Exemplo do wizard</label>
                <p className="text-sm text-gray-700 dark:text-gray-200 mt-1">
                  Família com Cor=Branco + Tam=P gera: <span className="font-mono font-bold">{wizardExample}</span>
                </p>
              </div>
            )}
            {sepMissing && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Defina o separador antes de salvar.
              </p>
            )}
          </section>

          <section className={sectionCls + ' lg:col-span-2'}>
            <header>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">Tokens disponíveis</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Caracteres reconhecidos pela máscara. Tudo que não estiver nesta lista é tratado como literal.
              </p>
            </header>
            <table className="w-full text-sm">
              <tbody>
                {TEMPLATE_TOKENS.map(t => (
                  <tr key={t.token} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="py-2 pr-4 font-mono font-bold text-gray-800 dark:text-gray-100 w-24">{t.token}</td>
                    <td className="py-2 text-gray-600 dark:text-gray-300">{t.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-500 dark:text-gray-400 pt-2">
              Exemplos de códigos válidos com diferentes templates:&nbsp;
              {EXAMPLES.map((ex, i) => <code key={i} className="font-mono mr-2">{ex}</code>)}
            </p>
          </section>

          <section className={sectionCls + ' lg:col-span-2'}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={draft.allow_legacy}
                onChange={e => setDraft({ ...draft, allow_legacy: e.target.checked })}
                className="mt-1 h-4 w-4 rounded cursor-pointer accent-[var(--color-1)]" />
              <div>
                <div className="text-sm font-bold text-gray-800 dark:text-gray-100">Aceitar códigos legados</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Quando marcado, produtos antigos com códigos fora do template apenas exibem aviso.
                  Quando desmarcado, qualquer alteração obriga regularizar o código.
                </p>
              </div>
            </label>
          </section>
        </div>
      )}
    </div>
  )
}
