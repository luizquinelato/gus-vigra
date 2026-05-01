import { useEffect, useRef, useState } from 'react'
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import {
  TextB, TextItalic, TextUnderline, TextStrikethrough,
  ListBullets, ListNumbers, Quotes, Link as LinkIcon, LinkBreak,
  TextHOne, TextHTwo, TextHThree, ArrowUUpLeft, ArrowUUpRight,
  Code, Eye, PencilSimple,
} from '@phosphor-icons/react'

// Marks de formatação não-inclusivas: por padrão o ProseMirror estende a marca
// até o cursor quando ele cai na borda do trecho estilizado (inclusive=true),
// o que faz o botão de Negrito/Itálico/etc. acender/apagar conforme o usuário
// clica perto do texto formatado — comportamento percebido como instável.
// Com inclusive=false a marca não "captura" o cursor na borda; só fica ativa
// quando o cursor está realmente dentro do trecho ou quando o usuário arma a
// marca explicitamente pelo botão da toolbar (storedMarks).
const NonInclusiveBold = Bold.extend({ inclusive: false })
const NonInclusiveItalic = Italic.extend({ inclusive: false })
const NonInclusiveStrike = Strike.extend({ inclusive: false })
const NonInclusiveUnderline = Underline.extend({ inclusive: false })
import { sanitizeHtml } from '../utils/htmlSanitizer'

// Preserva storedMarks (Bold/Italic/etc.) através de transações que mudam só
// a seleção (clique do mouse, setas). ProseMirror por padrão zera storedMarks
// em qualquer transação com selectionSet — isso faz o B "desativar sozinho"
// quando o usuário clica B com doc vazio e depois clica no editor para
// posicionar o cursor. Mantemos as marcas a menos que o cursor caia dentro
// de texto que já tenha marcas próprias (caso em que estas devem prevalecer).
const PersistStoredMarks = Extension.create({
  name: 'persistStoredMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('persistStoredMarks'),
        appendTransaction: (_trs, oldState, newState) => {
          if (!oldState.doc.eq(newState.doc)) return null
          if (oldState.selection.eq(newState.selection)) return null
          if (newState.storedMarks !== null) return null
          if (!oldState.storedMarks || oldState.storedMarks.length === 0) return null
          if (newState.selection.$from.marks().length > 0) return null
          return newState.tr.setStoredMarks(oldState.storedMarks)
        },
      }),
    ]
  },
})

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

const btnBase = 'p-1.5 rounded outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-1)]/50 disabled:opacity-40 disabled:cursor-not-allowed'
const btnCls = `${btnBase} text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600`
const btnActiveCls = `${btnBase} text-white bg-[var(--color-1)]`

function ToolBtn({ active, onClick, title, children, disabled }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean
}) {
  return (
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClick}
      disabled={disabled} title={title} className={active ? btnActiveCls : btnCls}>
      {children}
    </button>
  )
}

// Padrão TipTap v3: useEditorState seleciona slices reativos do editor.
// Toolbar só re-renderiza quando algum dos campos abaixo muda — sem flickering
// causado por re-render em cada transação (old behavior do shouldRerenderOnTransaction).
function useToolbarState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) {
        return {
          isBold: false, isItalic: false, isUnderline: false, isStrike: false,
          isH1: false, isH2: false, isH3: false,
          isBullet: false, isOrdered: false, isQuote: false, isLink: false,
          color: '#000000', canUndo: false, canRedo: false,
        }
      }
      // Para marks de formatação (Bold/Italic/Underline/Strike) com seleção
      // colapsada (cursor sem range), o botão reflete apenas as marks armadas
      // pelo usuário via toolbar (storedMarks). Ignoramos as marks "herdadas"
      // do cursor (`$from.marks()`) porque o ProseMirror as expõe mesmo em doc
      // vazio em alguns cenários (StrictMode/parser), fazendo o botão acender
      // sozinho ao clicar no campo. Com seleção em range, usa isActive normal.
      const { selection, storedMarks } = ed.state
      function markActive(name: string): boolean {
        if (storedMarks?.some(m => m.type.name === name)) return true
        if (selection.empty) return false
        return ed.isActive(name)
      }
      return {
        isBold: markActive('bold'),
        isItalic: markActive('italic'),
        isUnderline: markActive('underline'),
        isStrike: markActive('strike'),
        isH1: ed.isActive('heading', { level: 1 }),
        isH2: ed.isActive('heading', { level: 2 }),
        isH3: ed.isActive('heading', { level: 3 }),
        isBullet: ed.isActive('bulletList'),
        isOrdered: ed.isActive('orderedList'),
        isQuote: ed.isActive('blockquote'),
        isLink: ed.isActive('link'),
        color: (ed.getAttributes('textStyle').color as string | undefined) || '#000000',
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      }
    },
  })
}

function Toolbar({ editor, mode, setMode }: {
  editor: Editor; mode: 'wysiwyg' | 'html'; setMode: (m: 'wysiwyg' | 'html') => void
}) {
  const s = useToolbarState(editor)
  if (!s) return null
  if (mode === 'html') {
    return (
      <div className="flex items-center justify-between gap-1 p-1.5 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
        <span className="text-xs text-gray-500 dark:text-gray-400 px-2">Modo HTML — edição livre. Conteúdo é sanitizado ao salvar.</span>
        <ToolBtn onClick={() => setMode('wysiwyg')} title="Voltar ao editor visual"><Eye size={16} /></ToolBtn>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
      <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={s.isBold} title="Negrito (Ctrl+B)"><TextB size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={s.isItalic} title="Itálico (Ctrl+I)"><TextItalic size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={s.isUnderline} title="Sublinhado (Ctrl+U)"><TextUnderline size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={s.isStrike} title="Tachado"><TextStrikethrough size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={s.isH1} title="Título 1"><TextHOne size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={s.isH2} title="Título 2"><TextHTwo size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={s.isH3} title="Título 3"><TextHThree size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={s.isBullet} title="Lista"><ListBullets size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={s.isOrdered} title="Lista numerada"><ListNumbers size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={s.isQuote} title="Citação"><Quotes size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <label className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer flex items-center gap-1" title="Cor do texto">
        <span className="text-xs">A</span>
        <input type="color" className="w-4 h-4 cursor-pointer border-0 bg-transparent p-0"
          value={s.color}
          onInput={e => editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()} />
      </label>
      <ToolBtn onClick={() => editor.chain().focus().unsetColor().run()} title="Remover cor"><span className="text-xs px-0.5">A↺</span></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <ToolBtn
        onClick={() => {
          const prev = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('URL do link', prev ?? 'https://')
          if (url === null) return
          if (url === '') { editor.chain().focus().unsetLink().run(); return }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_blank' }).run()
        }}
        active={s.isLink} title="Inserir link"><LinkIcon size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().unsetLink().run()} disabled={!s.isLink} title="Remover link"><LinkBreak size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!s.canUndo} title="Desfazer (Ctrl+Z)"><ArrowUUpLeft size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!s.canRedo} title="Refazer (Ctrl+Y)"><ArrowUUpRight size={16} /></ToolBtn>
      <span className="flex-1" />
      <ToolBtn onClick={() => setMode('html')} title="Editar HTML cru"><Code size={16} /></ToolBtn>
    </div>
  )
}

export function RichTextEditor({ value, onChange, placeholder }: Props) {
  const [mode, setMode] = useState<'wysiwyg' | 'html'>('wysiwyg')
  const [htmlDraft, setHtmlDraft] = useState(value)
  // Última string emitida por onUpdate; usada para ignorar o "eco" do parent
  // (evita setContent em loop, que apaga selection e propaga stored marks
  // — causa do bug de negrito ativo ao começar a digitar).
  const lastEmittedRef = useRef<string>(value)

  const editor = useEditor({
    extensions: [
      // Desabilita as marks de formatação do StarterKit para registrar as
      // versões não-inclusivas logo abaixo (evita captura na borda do trecho).
      // Link também é desabilitado porque é registrado separadamente com
      // configuração própria (openOnClick=false, autolink, target=_blank).
      StarterKit.configure({ bold: false, italic: false, strike: false, underline: false, link: false }),
      NonInclusiveBold,
      NonInclusiveItalic,
      NonInclusiveStrike,
      NonInclusiveUnderline,
      TextStyle,
      Color,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      PersistStoredMarks,
    ],
    content: value || '',
    // Mantém o default do v3 (false). A toolbar usa useEditorState para
    // subscrever apenas aos slices que importam — sem re-render desnecessário.
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'tiptap min-h-[140px] px-3 py-2 outline-none text-sm text-gray-800 dark:text-gray-100',
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
      },
    },
    onCreate: ({ editor: ed }) => {
      // Defesa contra storedMarks "fantasma" herdados de StrictMode double-mount
      // ou de instâncias anteriores do editor. Em doc vazio, nada deve estar
      // pré-ativado (Bold, Italic etc.).
      if (ed.state.storedMarks && ed.state.storedMarks.length > 0) {
        ed.view.dispatch(ed.state.tr.setStoredMarks(null))
      }
    },

    onUpdate: ({ editor: ed }) => {
      const clean = sanitizeHtml(ed.getHTML())
      lastEmittedRef.current = clean
      onChange(clean)
    },
  })

  // Mantém o conteúdo do editor em sincronia quando `value` muda externamente
  // (ex.: edição de produto existente). Ignora o eco do próprio onUpdate.
  useEffect(() => {
    if (!editor) return
    if (mode !== 'wysiwyg') return
    if (value === lastEmittedRef.current) return
    lastEmittedRef.current = value
    editor.commands.setContent(value || '', { emitUpdate: false })
  }, [value, editor, mode])

  function applyHtmlDraft() {
    const clean = sanitizeHtml(htmlDraft)
    lastEmittedRef.current = clean
    onChange(clean)
    if (editor) editor.commands.setContent(clean, { emitUpdate: false })
    setMode('wysiwyg')
  }

  if (!editor) return null

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 transition-colors hover:border-[var(--color-1)] focus-within:border-[var(--color-1)] overflow-hidden">
      <Toolbar editor={editor} mode={mode} setMode={(m) => { if (m === 'html') setHtmlDraft(editor.getHTML()); setMode(m) }} />
      {mode === 'wysiwyg' ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="flex flex-col">
          <textarea value={htmlDraft} onChange={e => setHtmlDraft(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[200px] px-3 py-2 font-mono text-xs bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none resize-y" />
          <div className="flex items-center justify-end gap-2 px-2 py-1.5 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
            <button type="button" onClick={() => { setHtmlDraft(editor.getHTML()); setMode('wysiwyg') }}
              className="px-3 py-1 text-xs rounded text-white font-medium hover:opacity-90 transition-opacity"
              style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
            <button type="button" onClick={applyHtmlDraft}
              className="px-3 py-1 text-xs rounded text-white font-semibold inline-flex items-center gap-1"
              style={{ background: 'var(--color-save)', color: 'var(--on-color-save)' }}>
              <PencilSimple size={12} /> Aplicar HTML
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
