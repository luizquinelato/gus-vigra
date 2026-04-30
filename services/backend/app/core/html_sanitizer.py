"""
core/html_sanitizer.py
======================
Sanitização defensiva de HTML enviado pelo cliente para campos de conteúdo
rico (descrições de produtos, páginas, etc.). Whitelist espelhada com o
sanitizer do frontend (`utils/htmlSanitizer.ts`) — manter ambos sincronizados.

Política
--------
- Tags: estrutura básica (parágrafos, títulos, listas, link, imagem, tabela,
  span/div). Bloqueia script, iframe, style, form, etc.
- Atributos: href/target/rel, src/alt, class, style, colspan/rowspan.
- Style: somente propriedades CSS de apresentação (cor, tamanho, espaçamento).
  Bloqueia expression(), javascript:, url() e data: não-imagem.
- Links com target=_blank recebem rel=noopener noreferrer automaticamente.
"""
from __future__ import annotations

import re
from typing import Optional

import bleach
from bleach.css_sanitizer import CSSSanitizer

ALLOWED_TAGS = [
    "p", "br", "hr",
    "strong", "b", "em", "i", "u", "s", "sub", "sup", "mark", "small",
    "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "code", "pre",
    "a", "img",
    "span", "div",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
]

ALLOWED_ATTRS = {
    "*":   ["class", "style", "title"],
    "a":   ["href", "target", "rel"],
    "img": ["src", "alt", "width", "height"],
    "td":  ["colspan", "rowspan"],
    "th":  ["colspan", "rowspan"],
}

ALLOWED_CSS_PROPS = [
    "color", "background-color", "background",
    "font-size", "font-weight", "font-style", "font-family",
    "text-align", "text-decoration", "text-transform", "line-height", "letter-spacing",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-color", "border-style", "border-width", "border-radius",
    "width", "height", "max-width", "min-width", "max-height", "min-height",
    "display", "vertical-align",
]

ALLOWED_PROTOCOLS = ["http", "https", "mailto", "tel"]

_CSS_BAD_VALUE = re.compile(
    r"(expression|javascript:|vbscript:|@import|behavior|url\s*\()", re.IGNORECASE
)

_css_sanitizer = CSSSanitizer(allowed_css_properties=ALLOWED_CSS_PROPS)


def _post_filter_styles(html: str) -> str:
    """Remove declarações cujo valor casa com padrão perigoso (defesa em
    profundidade — bleach já bloqueia, mas reforçamos)."""
    def _scrub_style(match: re.Match[str]) -> str:
        decls = match.group(1).split(";")
        kept: list[str] = []
        for d in decls:
            d = d.strip()
            if not d:
                continue
            if _CSS_BAD_VALUE.search(d):
                continue
            kept.append(d)
        if not kept:
            return ""
        return f'style="{"; ".join(kept)}"'

    return re.sub(r'style="([^"]*)"', _scrub_style, html)


def sanitize_html(value: Optional[str]) -> Optional[str]:
    """Sanitiza HTML; devolve None se entrada for None, '' se ficar vazio."""
    if value is None:
        return None
    if not value.strip():
        return ""
    cleaned = bleach.clean(
        value,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=ALLOWED_PROTOCOLS,
        css_sanitizer=_css_sanitizer,
        strip=True,
        strip_comments=True,
    )
    cleaned = _post_filter_styles(cleaned)
    # Anti tab-nabbing: força rel=noopener em links target=_blank.
    cleaned = re.sub(
        r'(<a\b[^>]*\btarget="_blank"[^>]*?)(?<!\brel=")(>)',
        r'\1 rel="noopener noreferrer"\2',
        cleaned,
    )
    return cleaned


def sanitize_plain(value: Optional[str], max_len: Optional[int] = None) -> Optional[str]:
    """Strip total de tags — para campos meta (title, description) que devem
    ser texto puro. Trunca opcionalmente."""
    if value is None:
        return None
    plain = bleach.clean(value, tags=[], strip=True).strip()
    if max_len is not None and len(plain) > max_len:
        plain = plain[:max_len]
    return plain
