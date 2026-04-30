/**
 * Sanitizador HTML compartilhado pelo admin (antes de salvar) e pelo storefront
 * (antes de renderizar via dangerouslySetInnerHTML). Espelha a whitelist do
 * backend (`app/core/html_sanitizer.py`) — manter ambos sincronizados.
 *
 * Estratégia: tags básicas para conteúdo (parágrafos, títulos, listas, links,
 * tabelas, imagens, span/div). Atributo `style` permitido com whitelist de
 * propriedades CSS (cor, tamanho, alinhamento, espaçamento) — flexibilidade
 * de customização sem abrir brecha para XSS via expression()/url(javascript:).
 */
import DOMPurify from 'dompurify'

export const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre',
  'a', 'img',
  'span', 'div',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]

export const ALLOWED_ATTRS = [
  'href', 'target', 'rel', 'title',
  'src', 'alt', 'width', 'height',
  'class', 'style',
  'colspan', 'rowspan',
]

// Propriedades CSS permitidas em `style`. Tudo fora dessa lista é descartado.
const ALLOWED_CSS_PROPS = new Set([
  'color', 'background-color', 'background',
  'font-size', 'font-weight', 'font-style', 'font-family',
  'text-align', 'text-decoration', 'text-transform', 'line-height', 'letter-spacing',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width', 'border-radius',
  'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height',
  'display', 'vertical-align',
])

// Padrões proibidos no valor de qualquer propriedade CSS.
const CSS_BAD_VALUE = /(expression|javascript:|vbscript:|data:(?!image\/)|@import|behavior|url\s*\()/i

function sanitizeStyleAttr(raw: string): string {
  return raw
    .split(';')
    .map(decl => decl.trim())
    .filter(Boolean)
    .map(decl => {
      const idx = decl.indexOf(':')
      if (idx < 0) return null
      const prop = decl.slice(0, idx).trim().toLowerCase()
      const val  = decl.slice(idx + 1).trim()
      if (!ALLOWED_CSS_PROPS.has(prop)) return null
      if (CSS_BAD_VALUE.test(val)) return null
      return `${prop}: ${val}`
    })
    .filter((d): d is string => d !== null)
    .join('; ')
}

let hookInstalled = false
function ensureHook() {
  if (hookInstalled) return
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && typeof data.attrValue === 'string') {
      const cleaned = sanitizeStyleAttr(data.attrValue)
      if (!cleaned) { data.keepAttr = false; return }
      data.attrValue = cleaned
    }
    // Bloqueia URIs perigosas em href/src.
    if ((data.attrName === 'href' || data.attrName === 'src') && typeof data.attrValue === 'string') {
      const v = data.attrValue.trim().toLowerCase()
      if (v.startsWith('javascript:') || v.startsWith('vbscript:') ||
          (v.startsWith('data:') && !v.startsWith('data:image/'))) {
        data.keepAttr = false
      }
    }
  })
  // Força rel=noopener em links com target=_blank (anti tabnabbing).
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && (node as Element).getAttribute('target') === '_blank') {
      (node as Element).setAttribute('rel', 'noopener noreferrer')
    }
  })
  hookInstalled = true
}

/** Sanitiza HTML produzido pelo editor antes de persistir/renderizar. */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return ''
  ensureHook()
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form',
                  'input', 'button', 'select', 'textarea', 'link', 'meta', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus',
                  'onblur', 'onchange', 'onsubmit', 'srcdoc', 'formaction'],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  })
}
