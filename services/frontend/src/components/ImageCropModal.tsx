import { useCallback, useRef, useState, type SyntheticEvent } from 'react'
import ReactCrop, {
  centerCrop, makeAspectCrop,
  type Crop as CropType, type PercentCrop, type PixelCrop,
} from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
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
  { label: '16:9',     value: 16 / 9 },
  { label: '3:4',      value: 3 / 4 },
  { label: '4:5',      value: 4 / 5 },
  { label: '9:16',     value: 9 / 16 },
]

// Calcula a seleção inicial centralizada cobrindo ~80% da imagem,
// respeitando o aspecto quando definido (Livre = retângulo livre).
function buildInitialCrop(aspect: number | undefined, mediaWidth: number, mediaHeight: number): CropType {
  if (aspect == null) {
    return centerCrop({ unit: '%', x: 10, y: 10, width: 80, height: 80 }, mediaWidth, mediaHeight)
  }
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 80 }, aspect, mediaWidth, mediaHeight),
    mediaWidth, mediaHeight,
  )
}

// Coordenadas vêm em pixels do <img> renderizado; convertemos pra pixels
// naturais antes de desenhar no canvas para não perder resolução.
async function cropToFile(img: HTMLImageElement, c: PixelCrop, name: string): Promise<File> {
  const scaleX = img.naturalWidth  / img.width
  const scaleY = img.naturalHeight / img.height
  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(c.width  * scaleX)
  canvas.height = Math.round(c.height * scaleY)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context indisponível.')
  ctx.drawImage(img,
    c.x * scaleX, c.y * scaleY, c.width * scaleX, c.height * scaleY,
    0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.92))
  if (!blob) throw new Error('Falha ao gerar imagem.')
  const baseName = name.replace(/\.[^.]+$/, '') || 'image'
  return new File([blob], `${baseName}-crop.jpg`, { type: 'image/jpeg' })
}

export function ImageCropModal({ src, fileName, onClose, onConfirm }: Props) {
  const [aspect, setAspect] = useState<number | undefined>(undefined)
  const [crop, setCrop] = useState<CropType>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null)
  const [busy, setBusy] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const onImageLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop(buildInitialCrop(aspect, width, height))
  }, [aspect])

  function changeAspect(next: number | undefined) {
    setAspect(next)
    if (imgRef.current) {
      const { width, height } = imgRef.current
      setCrop(buildInitialCrop(next, width, height))
    }
  }

  async function handleConfirm() {
    if (!completedCrop || !imgRef.current || completedCrop.width === 0) return
    setBusy(true)
    try {
      const file = await cropToFile(imgRef.current, completedCrop, fileName ?? 'image.jpg')
      onConfirm(file)
    } finally { setBusy(false) }
  }

  useModalShortcuts({
    onClose: () => { if (!busy) onClose() },
    onSubmit: () => { if (!busy && completedCrop) void handleConfirm() },
  })

  // Pixels naturais da seleção atual (para indicador de dimensões reais).
  const naturalDims = (() => {
    if (!completedCrop || !imgRef.current) return null
    const sx = imgRef.current.naturalWidth  / imgRef.current.width
    const sy = imgRef.current.naturalHeight / imgRef.current.height
    return {
      w: Math.round(completedCrop.width  * sx),
      h: Math.round(completedCrop.height * sy),
    }
  })()

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

        <div className="relative w-full bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center" style={{ minHeight: 380 }}>
          <ReactCrop
            crop={crop}
            onChange={(_: PixelCrop, percent: PercentCrop) => setCrop(percent)}
            onComplete={(c: PixelCrop) => setCompletedCrop(c)}
            aspect={aspect}
            minWidth={20}
            minHeight={20}
            keepSelection
          >
            <img ref={imgRef} src={src} alt="" onLoad={onImageLoad}
              style={{ maxHeight: 460, maxWidth: '100%', display: 'block' }} />
          </ReactCrop>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Proporção:</span>
            {ASPECT_PRESETS.map(p => (
              <button key={p.label} onClick={() => changeAspect(p.value)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  aspect === p.value
                    ? 'border-[var(--color-1)] text-[var(--color-1)] bg-[var(--color-1)]/10'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {naturalDims && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Seleção: <span className="font-mono text-gray-700 dark:text-gray-200">{naturalDims.w} × {naturalDims.h}</span> px
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-cancel)' }}>Cancelar</button>
          <button onClick={handleConfirm} disabled={busy || !completedCrop}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold border-none"
            style={{ background: 'var(--color-save)', color: 'var(--on-color-save)', opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
            <FloppyDisk size={15} className={busy ? 'animate-spin' : undefined} /> Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}
