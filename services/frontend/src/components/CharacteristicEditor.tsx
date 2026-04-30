/**
 * CharacteristicEditor.tsx
 * ========================
 * Editor de characteristic-links de um produto (substitui o antigo AttrEditor
 * de chave/valor livre). Cada linha tem dois comboboxes encadeados:
 *   1. Característica (Cor, Tamanho, Voltagem…) — type ∈ ('text','color','number')
 *   2. Valor (Preto, M, 110V…) — filtrado pela característica escolhida.
 *
 * Suporta criação inline de característica (escolhe o type) e de valor
 * (com hex_color quando color, numeric_value + unit quando number).
 * Característica repetida em outra linha é automaticamente removida.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  characteristicValuesApi, characteristicsApi,
  type CharacteristicLinkWrite, type CharacteristicRead, type CharacteristicType,
  type CharacteristicValueRead,
} from '../services/cadastrosApi'
import { CharacteristicCombobox } from './CharacteristicCombobox'
import { CharacteristicValueCombobox } from './CharacteristicValueCombobox'

interface Props {
  value: CharacteristicLinkWrite[]
  onChange: (next: CharacteristicLinkWrite[]) => void
  characteristics: CharacteristicRead[]
  onCharacteristicCreated?: (c: CharacteristicRead) => void
}

export function CharacteristicEditor({
  value, onChange, characteristics, onCharacteristicCreated,
}: Props) {
  // Estado interno em paralelo: permite linhas vazias enquanto o usuário escolhe
  // (CharacteristicLinkWrite exige ambos ids preenchidos para persistir).
  const [rows, setRows] = useState<Array<{ characteristic_id: number | null; value_id: number | null }>>(
    () => value.map(v => ({ characteristic_id: v.characteristic_id, value_id: v.value_id })),
  )
  // Cache de valores por characteristic para alimentar o segundo combobox.
  const [valuesCache, setValuesCache] = useState<Record<number, CharacteristicValueRead[]>>({})

  // Pré-carrega valores das characteristics já presentes no value inicial.
  useEffect(() => {
    const ids = new Set(value.map(v => v.characteristic_id))
    ids.forEach(id => { void ensureValuesLoaded(id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function ensureValuesLoaded(characteristicId: number) {
    if (valuesCache[characteristicId]) return
    try {
      const list = await characteristicValuesApi.listByCharacteristic(characteristicId, { only_active: true })
      setValuesCache(prev => ({ ...prev, [characteristicId]: list }))
    } catch {
      // Falha silenciosa — combobox mostrará "Nenhum valor encontrado".
    }
  }

  function notify(next: typeof rows) {
    setRows(next)
    const filled: CharacteristicLinkWrite[] = next
      .filter(r => r.characteristic_id != null && r.value_id != null)
      .map(r => ({ characteristic_id: r.characteristic_id!, value_id: r.value_id! }))
    onChange(filled)
  }

  function setCharacteristic(idx: number, charId: number | null) {
    if (charId != null) {
      // Auto-remove se já existe outra linha com essa characteristic.
      const dupIdx = rows.findIndex((r, i) => i !== idx && r.characteristic_id === charId)
      if (dupIdx !== -1) {
        toast.info('Característica já adicionada — linha removida.')
        notify(rows.filter((_, i) => i !== idx))
        return
      }
      void ensureValuesLoaded(charId)
    }
    notify(rows.map((r, i) => i === idx ? { characteristic_id: charId, value_id: null } : r))
  }

  function setValue(idx: number, valueId: number | null) {
    notify(rows.map((r, i) => i === idx ? { ...r, value_id: valueId } : r))
  }

  function remove(idx: number) { notify(rows.filter((_, i) => i !== idx)) }
  function add() { notify([...rows, { characteristic_id: null, value_id: null }]) }

  async function createCharacteristic(name: string, type: CharacteristicType) {
    const created = await characteristicsApi.create({ name, type })
    onCharacteristicCreated?.(created)
    return created
  }

  async function createValue(charId: number, body: { value: string; hex_color?: string | null; numeric_value?: string | null; unit?: string | null }) {
    const created = await characteristicValuesApi.create(charId, body)
    setValuesCache(prev => ({ ...prev, [charId]: [...(prev[charId] ?? []), created] }))
    return created
  }

  const usedIds = useMemo(() => new Set(rows.map(r => r.characteristic_id).filter((v): v is number => v != null)), [rows])

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-gray-400">Nenhuma característica. Ex: Cor = Preto, Tamanho = M.</p>
      )}
      {rows.map((row, i) => {
        const charType: CharacteristicType | undefined =
          row.characteristic_id != null
            ? characteristics.find(c => c.id === row.characteristic_id)?.type as CharacteristicType | undefined
            : undefined
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <CharacteristicCombobox
                value={row.characteristic_id}
                onChange={id => setCharacteristic(i, id)}
                options={characteristics}
                excludeIds={Array.from(usedIds).filter(id => id !== row.characteristic_id)}
                onCreate={createCharacteristic}
              />
            </div>
            <div className="flex-1">
              <CharacteristicValueCombobox
                value={row.value_id}
                onChange={vid => setValue(i, vid)}
                options={row.characteristic_id != null ? (valuesCache[row.characteristic_id] ?? []) : []}
                disabled={row.characteristic_id == null}
                characteristicType={charType ?? 'text'}
                onCreate={row.characteristic_id != null
                  ? body => createValue(row.characteristic_id!, body)
                  : undefined}
              />
            </div>
            <button type="button" onClick={() => remove(i)}
              className="text-gray-400 hover:text-red-600 px-2">
              <Trash size={15} />
            </button>
          </div>
        )
      })}
      <button type="button" onClick={add}
        className="text-xs inline-flex items-center gap-1 text-[var(--color-1)] hover:underline">
        <Plus size={12} /> Adicionar característica
      </button>
    </div>
  )
}
