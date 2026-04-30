// Lookup de nome PT-BR para hex. Fonte: pt.wikipedia.org/wiki/Lista_de_cores (CC BY-SA 4.0).

import data from '../data/colorNames.pt-br.json'

interface ColorEntry { name: string; hex: string }

const PALETTE = (data as ColorEntry[]).map(({ name, hex }) => {
  const n = parseInt(hex.slice(1), 16)
  return { name, r: (n >> 16) & 0xFF, g: (n >> 8) & 0xFF, b: n & 0xFF }
})

// Distância máxima (RGB euclidean) para considerar um match. ~8 cobre drift
// pequeno do color picker (HSL→RGB) sem produzir sugestões "parecidas demais".
const MAX_DISTANCE = 8

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null
  const n = parseInt(m, 16)
  return { r: (n >> 16) & 0xFF, g: (n >> 8) & 0xFF, b: n & 0xFF }
}

export function colorNameFromHex(hex: string | null | undefined): string | null {
  if (!hex) return null
  const rgb = parseHex(hex)
  if (!rgb) return null
  let best: { name: string; d: number } | null = null
  for (const c of PALETTE) {
    const dr = rgb.r - c.r, dg = rgb.g - c.g, db = rgb.b - c.b
    const d = Math.sqrt(dr * dr + dg * dg + db * db)
    if (best === null || d < best.d) best = { name: c.name, d }
  }
  return best && best.d <= MAX_DISTANCE ? best.name : null
}
