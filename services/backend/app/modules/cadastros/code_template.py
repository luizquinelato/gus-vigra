"""
code_template.py
================
DSL mínima para máscaras de código de produto (definidas pelo admin).

Sintaxe:
    A   → letra A-Z (auto-uppercase no input)
    a   → letra a-z (lowercase)
    9   → dígito 0-9
    *   → letra ou dígito (auto-uppercase letras)
    -_./ etc → literal (inserido automaticamente pela máscara no frontend)

Exemplos:
    "AAA-9999"       → "CAFE-1234"
    "AA9999"         → "CA1234"
    "AAA-9999_AA"    → "CAFE-1234_GR"

Funções:
    compile_template(tpl)     → re.Pattern (^...$)
    validate_value(tpl, val)  → bool
    format_value(tpl, raw)    → string formatada com separadores aplicados

Templates vazios significam "sem enforcement" — sempre passam na validação.
"""
from __future__ import annotations

import re

# Tokens reconhecidos como placeholder (qualquer outro char é literal).
_LETTER_UPPER = "A"
_LETTER_LOWER = "a"
_DIGIT        = "9"
_ALNUM        = "*"
PLACEHOLDERS  = (_LETTER_UPPER, _LETTER_LOWER, _DIGIT, _ALNUM)


def compile_template(template: str) -> re.Pattern[str] | None:
    """Compila o template para uma regex ancorada (^...$).

    Retorna None se template é vazio/None — chamadores tratam como
    "sem enforcement" (qualquer valor passa).
    """
    if not template:
        return None
    parts: list[str] = ["^"]
    for ch in template:
        if ch == _LETTER_UPPER:
            parts.append("[A-Z]")
        elif ch == _LETTER_LOWER:
            parts.append("[a-z]")
        elif ch == _DIGIT:
            parts.append("[0-9]")
        elif ch == _ALNUM:
            parts.append("[A-Z0-9]")
        else:
            parts.append(re.escape(ch))
    parts.append("$")
    return re.compile("".join(parts))


def validate_value(template: str, value: str) -> bool:
    """Retorna True se `value` casa com o template (ou se template é vazio)."""
    pattern = compile_template(template)
    if pattern is None:
        return True
    return pattern.match(value or "") is not None


def format_value(template: str, raw: str) -> str:
    """Aplica o template ao input bruto.

    `raw` pode conter qualquer coisa — extraímos só os caracteres significativos
    (letras/dígitos) e os recolocamos posição-a-posição, inserindo separadores
    literais automaticamente. Auto-uppercase em letras quando o slot é A ou *.

    Resultado é truncado no comprimento do template; chars extras são descartados.
    """
    if not template:
        return raw
    # Extrai só alfanuméricos do input (separadores antigos são jogados fora).
    signif = [c for c in (raw or "") if c.isalnum()]
    out: list[str] = []
    i = 0  # ponteiro no `signif`
    for slot in template:
        if slot == _LETTER_UPPER:
            while i < len(signif) and not signif[i].isalpha():
                i += 1
            if i >= len(signif):
                break
            out.append(signif[i].upper()); i += 1
        elif slot == _LETTER_LOWER:
            while i < len(signif) and not signif[i].isalpha():
                i += 1
            if i >= len(signif):
                break
            out.append(signif[i].lower()); i += 1
        elif slot == _DIGIT:
            while i < len(signif) and not signif[i].isdigit():
                i += 1
            if i >= len(signif):
                break
            out.append(signif[i]); i += 1
        elif slot == _ALNUM:
            if i >= len(signif):
                break
            out.append(signif[i].upper() if signif[i].isalpha() else signif[i])
            i += 1
        else:
            # Literal: só insere se ainda houver input depois dele,
            # senão deixamos o input "parar" antes do separador (UX melhor
            # ao digitar — não força o usuário a ver "ABC-" sem dígitos).
            if i >= len(signif):
                break
            out.append(slot)
    return "".join(out)


def template_max_length(template: str) -> int:
    """Tamanho final esperado de um valor que casa com o template."""
    return len(template or "")


def describe_tokens() -> list[dict[str, str]]:
    """Tabela de referência consumida pela página admin (rendering)."""
    return [
        {"token": _LETTER_UPPER, "meaning": "Letra A-Z (auto-MAIÚSCULA)"},
        {"token": _LETTER_LOWER, "meaning": "Letra a-z (auto-minúscula)"},
        {"token": _DIGIT,        "meaning": "Dígito 0-9"},
        {"token": _ALNUM,        "meaning": "Letra ou dígito"},
        {"token": "- _ . /",     "meaning": "Separadores (qualquer outro caractere = literal)"},
    ]
