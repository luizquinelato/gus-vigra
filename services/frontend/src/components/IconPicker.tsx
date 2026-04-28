import { useMemo, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { CATEGORY_ICONS, getCategoryIcon } from '../utils/categoryIcons'
import {
  CATEGORY_ORDER, ICONS_BY_CATEGORY, ICON_PT, getIconLabel, normalize,
} from '../utils/categoryIconsMeta'

interface Props {
  value: string | null
  onChange: (icon: string | null) => void
}

export function IconPicker({ value, onChange }: Props) {
  const [filter, setFilter] = useState('')
  const [activeCat, setActiveCat] = useState<string>(CATEGORY_ORDER[0])
  const Selected = getCategoryIcon(value)

  const matches = useMemo(() => {
    const q = normalize(filter.trim())
    if (!q) return null
    const hits: string[] = []
    for (const name of Object.keys(CATEGORY_ICONS)) {
      const en = normalize(name)
      const pt = normalize(ICON_PT[name] ?? '')
      if (en.includes(q) || pt.includes(q)) hits.push(name)
    }
    return hits
  }, [filter])

  const visible = matches ?? ICONS_BY_CATEGORY[activeCat] ?? []

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-200"
          title={value ? getIconLabel(value) : 'Nenhum ícone'}
        >
          {Selected ? <Selected size={20} weight="duotone" /> : <span className="text-xs text-gray-400">—</span>}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-1 truncate">
          {value ? getIconLabel(value) : 'Nenhum selecionado'}
        </span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-gray-400 hover:text-red-600 p-1"
            title="Limpar ícone"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="relative">
        <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar ícone (ex: carrinho, café)…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 outline-none focus:border-[var(--color-1)]"
        />
      </div>

      {!matches && (
        <div className="flex flex-wrap gap-1">
          {CATEGORY_ORDER.map(cat => {
            const active = cat === activeCat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCat(cat)}
                className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  background: active ? 'var(--color-1)' : 'transparent',
                  color: active ? 'var(--on-color-1)' : undefined,
                  borderColor: active ? 'var(--color-1)' : 'rgb(229 231 235 / 1)',
                }}
              >
                {cat}
              </button>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-8 gap-1.5 max-h-44 overflow-y-auto p-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40">
        {visible.map(name => {
          const Icon = CATEGORY_ICONS[name]
          if (!Icon) return null
          const active = name === value
          return (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              title={getIconLabel(name)}
              className="flex items-center justify-center w-8 h-8 rounded-md border transition-colors"
              style={{
                background: active ? 'var(--color-1)' : 'transparent',
                color: active ? 'var(--on-color-1)' : undefined,
                borderColor: active ? 'var(--color-1)' : 'transparent',
              }}
            >
              <Icon size={16} weight={active ? 'fill' : 'regular'} />
            </button>
          )
        })}
        {visible.length === 0 && (
          <p className="col-span-8 text-center text-xs text-gray-400 py-2">Nenhum ícone encontrado.</p>
        )}
      </div>
    </div>
  )
}
