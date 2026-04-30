import { useCallback, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { Crop, FloppyDisk, X } from '@phosphor-icons/react'
import { useModalShortcuts } from '../hooks/useModalShortcuts'

interface Props {
  src: string
  fileName?: string
  onClose: () => void
  onConfirm: (file: File) => void
}

const ASPECT_PRESETS: Array<{ label: string; value: number | undefined }> = [
  { label: 'Livre',    value: undefined },
  { label: '1:1',      value: 1 },
  { label: '4:3',      value: 4 / 3 },
  { label: '3:4',      value: 3 / 4 },
  { label: '16:9',     value: 16 / 9 },
]

async function cropToFile(src: string, area: Area, name: string): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(area.width)
  canvas.height = Math.round(area.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context indisponível.')
  ctx.drawImage(img, area.x, area.y, area.width, area.height,
                0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.92))
  if (!blob) throw new Error('Falha ao gerar imagem.')
  const baseName = name.replace(/\.[^.]+$/, '') || 'image'
  return new File([blob], `${baseName}-crop.jpg`, { type: 'image/jpeg' })
}

export function ImageCropModal({ src, fileName, onClose, onConfirm }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [aspect, setAspect] = useState<number | undefined>(undefined)
  const [pixels, setPixels] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixels(areaPixels)
  }, [])

  async function handleConfirm() {
    if (!pixels) return
    setBusy(true)
    try {
      const file = await cropToFile(src, pixels, fileName ?? 'image.jpg')
      onConfirm(file)
    } finally { setBusy(false) }
  }

  useModalShortcuts({
    onClose: () => { if (!busy) onClose() },
    onSubmit: () => { if (!busy && pixels) void handleConfirm() },
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-edit)', color: 'var(--on-color-edit)' }}>
              <Crop size={18} />
            </div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Ajustar imagem</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        <div className="relative w-full h-80 bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            restrictPosition={false}
          />
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Proporção:</span>
            {ASPECT_PRESETS.map(p => (
              <button key={p.label} onClick={() => setAspect(p.value)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  aspect === p.value
                    ? 'border-[var(--color-1)] text-[var(--color-1)] bg-[var(--color-1)]/10'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 w-12">Zoom</span>
            <input type="range" min={1} max={4} step={0.05} value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="flex-1 accent-[var(--color-1)]" />
            <span className="text-xs text-gray-400 w-10 text-right">{zoom.toFixed(2)}x</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleConfirm} disabled={busy || !pixels}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={busy ? 'animate-spin' : undefined} /> Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}
