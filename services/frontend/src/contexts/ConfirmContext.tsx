// Sistema declarativo de confirmação. Substitui o `window.confirm` nativo por
// um modal estilizado consistente com o resto do app.
//
// Uso:
//   const confirm = useConfirm()
//   const ok = await confirm({
//     variant: 'warning',
//     title:   'Salvar família?',
//     message: <>Isto atualizará <strong>3 produtos</strong>.</>,
//     confirmLabel: 'Salvar',
//   })
//   if (!ok) return
//
// O ConfirmProvider deve estar montado acima de qualquer componente que use
// o hook (em App.tsx, dentro do AuthProvider).
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Question, Warning, WarningOctagon, X } from '@phosphor-icons/react'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

export type ConfirmVariant = 'danger' | 'warning' | 'info'

export interface ConfirmOptions {
  variant?:      ConfirmVariant      // default: 'info'
  title:         string
  message:       ReactNode           // pode conter JSX (negrito, listas, etc.)
  confirmLabel?: string              // default: 'Confirmar'
  cancelLabel?:  string              // default: 'Cancelar'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface QueueItem {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<QueueItem | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>(resolve => setCurrent({ options, resolve }))
  }, [])

  function close(value: boolean) {
    current?.resolve(value)
    setCurrent(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <ConfirmDialog options={current.options}
          onCancel={() => close(false)}
          onConfirm={() => close(true)} />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm deve ser usado dentro de ConfirmProvider')
  return ctx
}

// ── UI ───────────────────────────────────────────────────────────────────────

interface VariantStyle {
  iconBg:      string
  iconColor:   string
  Icon:        typeof Warning
  confirmBg:   string
  confirmText: string
}

const VARIANT_STYLES: Record<ConfirmVariant, VariantStyle> = {
  danger: {
    iconBg:      'bg-red-50 dark:bg-red-900/30',
    iconColor:   'text-red-600 dark:text-red-400',
    Icon:        WarningOctagon,
    confirmBg:   'var(--color-delete)',
    confirmText: 'var(--on-color-delete)',
  },
  warning: {
    iconBg:      'bg-amber-50 dark:bg-amber-900/30',
    iconColor:   'text-amber-600 dark:text-amber-400',
    Icon:        Warning,
    confirmBg:   'var(--color-save)',
    confirmText: 'var(--on-color-save)',
  },
  info: {
    iconBg:      'bg-blue-50 dark:bg-blue-900/30',
    iconColor:   'text-blue-600 dark:text-blue-400',
    Icon:        Question,
    confirmBg:   'var(--color-1)',
    confirmText: 'var(--on-color-1)',
  },
}

interface DialogProps {
  options:   ConfirmOptions
  onCancel:  () => void
  onConfirm: () => void
}

function ConfirmDialog({ options, onCancel, onConfirm }: DialogProps) {
  const variant = options.variant ?? 'info'
  const style = VARIANT_STYLES[variant]
  const { Icon } = style

  // ESC cancela; Enter confirma. Empilha sobre outros modais via useModalShortcuts.
  useModalShortcuts({ onClose: onCancel, onSubmit: onConfirm })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-4 px-6 pt-6 pb-4">
          <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${style.iconBg}`}>
            <Icon size={20} weight="bold" className={style.iconColor} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">{options.title}</h2>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1.5 leading-relaxed">
              {options.message}
            </div>
          </div>
          <button onClick={onCancel} className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title="Fechar"><X size={18} /></button>
        </div>
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg border-none hover:opacity-90 transition-opacity"
            style={{ background: 'var(--color-cancel)', color: 'var(--on-color-cancel)' }}>
            {options.cancelLabel ?? 'Cancelar'}
          </button>
          <button onClick={onConfirm} autoFocus
            className="px-5 py-2 text-sm font-semibold rounded-lg border-none hover:opacity-90 transition-opacity"
            style={{ background: style.confirmBg, color: style.confirmText }}>
            {options.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
