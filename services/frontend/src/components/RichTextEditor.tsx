import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
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
import { sanitizeHtml } from '../utils/htmlSanitizer'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

const btnCls = 'p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed'
const btnActiveCls = 'p-1.5 rounded text-white bg-[var(--color-1)]'

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

function Toolbar({ editor, mode, setMode }: {
  editor: Editor; mode: 'wysiwyg' | 'html'; setMode: (m: 'wysiwyg' | 'html') => void
}) {
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
      <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Negrito (Ctrl+B)"><TextB size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Itálico (Ctrl+I)"><TextItalic size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Sublinhado (Ctrl+U)"><TextUnderline size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Tachado"><TextStrikethrough size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Título 1"><TextHOne size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Título 2"><TextHTwo size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Título 3"><TextHThree size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Lista"><ListBullets size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Lista numerada"><ListNumbers size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Citação"><Quotes size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <label className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer flex items-center gap-1" title="Cor do texto">
        <span className="text-xs">A</span>
        <input type="color" className="w-4 h-4 cursor-pointer border-0 bg-transparent p-0"
          value={editor.getAttributes('textStyle').color || '#000000'}
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
        active={editor.isActive('link')} title="Inserir link"><LinkIcon size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().unsetLink().run()} disabled={!editor.isActive('link')} title="Remover link"><LinkBreak size={16} /></ToolBtn>
      <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
      <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Desfazer (Ctrl+Z)"><ArrowUUpLeft size={16} /></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Refazer (Ctrl+Y)"><ArrowUUpRight size={16} /></ToolBtn>
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
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    ],
    content: value || '',
    // TipTap v3 desliga re-render por transação por padrão — sem isso,
    // editor.isActive('bold') no toolbar fica congelado e pisca aleatoriamente
    // a cada re-render do React, fazendo o B parecer ativar/desativar sozinho.
    shouldRerenderOnTransaction: true,
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
    onFocus: ({ editor: ed }) => {
      // Quando o usuário clica no editor com doc vazio, limpa qualquer
      // stored mark — evita o "Bold ativa sozinho ao clicar" em criação.
      // Não conflita com a toolbar: ToolBtn usa onMouseDown preventDefault,
      // então o foco não migra ao clicar em B/I/U e este handler não dispara.
      if (!ed.state.doc.textContent && ed.state.storedMarks && ed.state.storedMarks.length > 0) {
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
