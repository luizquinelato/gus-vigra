// Atalhos de teclado padrão para todos os modais do app:
//   ESC   → fecha o modal (chama onClose)
//   Enter → dispara o "ação primária" do modal (chama onSubmit)
//
// Padrão inspirado no gus-plumo (hooks/useEscapeKey.ts + listener Enter no
// EditExpenseModal), unificado num único hook com pilha interna para que, em
// modais empilhados (ex.: ImageCropModal sobre ProductFormModal), apenas o
// modal mais ao topo responda às teclas — evitando fechar/disparar o de baixo.
//
// Convenções para os modais que usarem este hook:
//   - Comboboxes/dropdowns que tratam ESC/Enter internamente devem chamar
//     `e.preventDefault()` no handler para "consumir" o evento; o hook
//     respeita `defaultPrevented` e ignora.
//   - Inputs do tipo TEXTAREA, SELECT e contentEditable não disparam Enter
//     (Enter neles tem semântica própria: nova linha / abrir lista).
//   - Botões (BUTTON) também são ignorados — Enter num <button> já dispara
//     o próprio click nativo.
import { useEffect, useRef } from 'react'

const stack: symbol[] = []

export function useModalShortcuts(handlers: {
  onClose?: () => void
  onSubmit?: () => void
  /** Permite desativar temporariamente (ex.: enquanto saving). Default: true. */
  enabled?: boolean
}) {
  const { onClose, onSubmit, enabled = true } = handlers
  // Refs sempre frescas: evitam stale closures sem precisar redeclarar o
  // listener a cada render.
  const onCloseRef = useRef(onClose)
  const onSubmitRef = useRef(onSubmit)
  onCloseRef.current = onClose
  onSubmitRef.current = onSubmit

  useEffect(() => {
    if (!enabled) return
    const id = Symbol('modal')
    stack.push(id)

    function isTopmost() { return stack[stack.length - 1] === id }

    function handler(e: KeyboardEvent) {
      if (!isTopmost()) return
      if (e.defaultPrevented) return
      if (e.isComposing) return  // IME em andamento

      if (e.key === 'Escape') {
        if (!onCloseRef.current) return
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!onSubmitRef.current) return
        const target = e.target as HTMLElement | null
        if (target) {
          const tag = target.tagName
          if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
          if (target.isContentEditable) return
        }
        e.preventDefault()
        onSubmitRef.current()
      }
    }

    // Pequeno atraso evita disparar Enter "residual" da ação que abriu o
    // modal (clicar em "Editar" e ainda estar com Enter pressionado).
    let attached = false
    const t = window.setTimeout(() => {
      document.addEventListener('keydown', handler)
      attached = true
    }, 150)

    return () => {
      window.clearTimeout(t)
      if (attached) document.removeEventListener('keydown', handler)
      const idx = stack.indexOf(id)
      if (idx >= 0) stack.splice(idx, 1)
    }
  }, [enabled])
}
