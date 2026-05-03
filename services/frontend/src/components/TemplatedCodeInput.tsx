/**
 * TemplatedCodeInput.tsx
 * ======================
 * Input controlado por DSL de template (mesma sintaxe do backend
 * `app/modules/cadastros/code_template.py`).
 *
 * Tokens:
 *   A → letra A-Z (auto-MAIÚSCULA)
 *   a → letra a-z (auto-minúscula)
 *   9 → dígito 0-9
 *   * → letra ou dígito (letras → MAIÚSCULA)
 *   demais → literal (separador inserido automaticamente)
 *
 * Quando `template` é vazio/null, vira um <input> normal — sem máscara.
 */
import type { CSSProperties } from 'react'

export const fieldCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 ' +
  'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none ' +
  'transition-colors hover:border-[var(--color-1)] focus:border-[var(--color-1)] ' +
  'disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-800'

const PLACEHOLDERS = new Set(['A', 'a', '9', '*'])

/** Aplica o template a um input bruto. Mesma semântica de `format_value` no backend. */
export function formatTemplate(template: string, raw: string): string {
  if (!template) return raw
  const signif: string[] = []
  for (const c of raw || '') {
    if (/[A-Za-z0-9]/.test(c)) signif.push(c)
  }
  const out: string[] = []
  let i = 0
  for (const slot of template) {
    if (slot === 'A') {
      while (i < signif.length && !/[A-Za-z]/.test(signif[i])) i++
      if (i >= signif.length) break
      out.push(signif[i].toUpperCase()); i++
    } else if (slot === 'a') {
      while (i < signif.length && !/[A-Za-z]/.test(signif[i])) i++
      if (i >= signif.length) break
      out.push(signif[i].toLowerCase()); i++
    } else if (slot === '9') {
      while (i < signif.length && !/[0-9]/.test(signif[i])) i++
      if (i >= signif.length) break
      out.push(signif[i]); i++
    } else if (slot === '*') {
      if (i >= signif.length) break
      out.push(/[A-Za-z]/.test(signif[i]) ? signif[i].toUpperCase() : signif[i])
      i++
    } else {
      // Literal só entra se ainda houver input depois dele.
      if (i >= signif.length) break
      out.push(slot)
    }
  }
  return out.join('')
}

/** Valida se `value` casa com o template (regex equivalente ao backend). */
export function validateTemplate(template: string, value: string): boolean {
  if (!template) return true
  const re = new RegExp('^' + Array.from(template).map(c => {
    if (c === 'A') return '[A-Z]'
    if (c === 'a') return '[a-z]'
    if (c === '9') return '[0-9]'
    if (c === '*') return '[A-Z0-9]'
    return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('') + '$')
  return re.test(value || '')
}

/** Variante para produto-de-família: valida `^<template><sep><.+>$`. */
export function validateTemplateWithSeparator(template: string, separator: string, value: string): boolean {
  if (!template) return true
  if (!separator) return false
  const v = value || ''
  const sepIdx = v.indexOf(separator)
  if (sepIdx === -1) return false
  const head = v.slice(0, sepIdx)
  const tail = v.slice(sepIdx + 1)
  return validateTemplate(template, head) && tail.length > 0
}

/** Placeholder humano para o input — exemplo gerado a partir do template. */
export function templatePlaceholder(template: string): string {
  if (!template) return ''
  const example = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let li = 0, di = 0
  return Array.from(template).map(c => {
    if (c === 'A' || c === '*') return example[li++ % example.length]
    if (c === 'a') return example[li++ % example.length].toLowerCase()
    if (c === '9') return String(di++ % 10)
    return c
  }).join('')
}

export interface TemplatedCodeInputProps {
  value: string
  onChange: (v: string) => void
  template: string                 // se vazio, vira input livre
  disabled?: boolean
  placeholder?: string             // override; default = templatePlaceholder(template)
  className?: string               // override do fieldCls
  style?: CSSProperties
  ariaInvalid?: boolean
  /**
   * Quando presente (1 char), o input vira "híbrido":
   *   <prefixo formatado pelo template><freeAfter><sufixo livre>
   * Ao digitar, a parte antes do primeiro `freeAfter` é formatada pelo
   * template; tudo depois passa por validação leve (uppercase + remove
   * caracteres de controle) mas é mantido livre. Se o sufixo ainda não
   * foi digitado, o template formata sozinho até completar; ao atingir
   * o tamanho do template, o separador é inserido automaticamente.
   */
  freeAfter?: string
}

export function TemplatedCodeInput({
  value, onChange, template, disabled, placeholder, className, style, ariaInvalid, freeAfter,
}: TemplatedCodeInputProps) {
  const isHybrid = !!template && !!freeAfter && freeAfter.length === 1
  const maxLen = template && !isHybrid ? template.length : undefined
  const ph = placeholder ?? (template ? templatePlaceholder(template) + (isHybrid ? `${freeAfter}…` : '') : '')

  function handleChange(raw: string) {
    if (!template) { onChange(raw); return }
    if (!isHybrid) { onChange(formatTemplate(template, raw)); return }
    // Modo híbrido: separa no primeiro freeAfter; formata head; mantém tail.
    const sepIdx = raw.indexOf(freeAfter!)
    if (sepIdx === -1) {
      // Ainda não há separador. Formata normalmente até template.length.
      // Se o usuário já preencheu todo o template, insere o separador
      // automaticamente para sinalizar a transição.
      const formatted = formatTemplate(template, raw)
      if (formatted.length === template.length && raw.length > template.length) {
        onChange(formatted + freeAfter!)
      } else {
        onChange(formatted)
      }
      return
    }
    const head = raw.slice(0, sepIdx)
    const tail = raw.slice(sepIdx + 1)
    const formattedHead = formatTemplate(template, head)
    // Sufixo: uppercase + remove espaços. Permite múltiplos separadores.
    const cleanTail = tail.toUpperCase().replace(/\s+/g, '')
    onChange(`${formattedHead}${freeAfter!}${cleanTail}`)
  }

  return (
    <input
      value={value}
      onChange={e => handleChange(e.target.value)}
      disabled={disabled}
      placeholder={ph}
      maxLength={maxLen}
      aria-invalid={ariaInvalid || undefined}
      className={className ?? fieldCls}
      style={style}
      spellCheck={false}
      autoComplete="off"
    />
  )
}

/** Tokens de referência consumidos por telas admin (tabela explicativa). */
export const TEMPLATE_TOKENS: { token: string; meaning: string }[] = [
  { token: 'A', meaning: 'Letra A-Z (auto-MAIÚSCULA)' },
  { token: 'a', meaning: 'Letra a-z (auto-minúscula)' },
  { token: '9', meaning: 'Dígito 0-9' },
  { token: '*', meaning: 'Letra ou dígito' },
  { token: '- _ . /', meaning: 'Separadores (qualquer outro caractere = literal)' },
]

export { PLACEHOLDERS }
