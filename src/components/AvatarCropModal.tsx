"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type Props = {
  file: File
  onCrop: (croppedBlob: Blob) => void
  onCancel: () => void
}

const OUTPUT_SIZE = 256 // final avatar is 256×256

export default function AvatarCropModal({ file, onCrop, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const [imageLoaded, setImageLoaded] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetStart = useRef({ x: 0, y: 0 })

  // The visible crop area size (CSS pixels)
  const CROP_SIZE = 240

  // Load the image from the File
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      // Fit image so shorter side fills the crop area
      const minDim = Math.min(img.width, img.height)
      const initialScale = CROP_SIZE / minDim
      setScale(initialScale)
      // Center the image
      setOffset({
        x: (CROP_SIZE - img.width * initialScale) / 2,
        y: (CROP_SIZE - img.height * initialScale) / 2,
      })
      setImageLoaded(true)
    }
    img.src = URL.createObjectURL(file)
    return () => URL.revokeObjectURL(img.src)
  }, [file])

  // Draw onto the visible canvas whenever scale/offset change
  useEffect(() => {
    if (!imageLoaded || !imgRef.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext("2d")
    if (!ctx) return

    const img = imgRef.current
    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE)

    // Draw a circular clip
    ctx.save()
    ctx.beginPath()
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()

    ctx.drawImage(img, offset.x, offset.y, img.width * scale, img.height * scale)
    ctx.restore()
  }, [imageLoaded, scale, offset])

  // Mouse / touch drag handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY }
      offsetStart.current = { ...offset }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [offset],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      setOffset({
        x: offsetStart.current.x + (e.clientX - dragStart.current.x),
        y: offsetStart.current.y + (e.clientY - dragStart.current.y),
      })
    },
    [dragging],
  )

  const handlePointerUp = useCallback(() => {
    setDragging(false)
  }, [])

  // Zoom with scroll wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const img = imgRef.current
      if (!img) return
      const minDim = Math.min(img.width, img.height)
      const minScale = CROP_SIZE / Math.max(img.width, img.height)
      const maxScale = (CROP_SIZE / minDim) * 3

      const newScale = Math.min(maxScale, Math.max(minScale, scale - e.deltaY * 0.001))
      // Zoom towards center
      const cx = CROP_SIZE / 2
      const cy = CROP_SIZE / 2
      const factor = newScale / scale
      setOffset({
        x: cx - (cx - offset.x) * factor,
        y: cy - (cy - offset.y) * factor,
      })
      setScale(newScale)
    },
    [scale, offset],
  )

  // Slider change
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const img = imgRef.current
      if (!img) return
      const newScale = parseFloat(e.target.value)
      const cx = CROP_SIZE / 2
      const cy = CROP_SIZE / 2
      const factor = newScale / scale
      setOffset({
        x: cx - (cx - offset.x) * factor,
        y: cy - (cy - offset.y) * factor,
      })
      setScale(newScale)
    },
    [scale, offset],
  )

  // Produce the cropped blob
  const handleConfirm = useCallback(() => {
    const img = imgRef.current
    if (!img) return

    const offscreen = document.createElement("canvas")
    offscreen.width = OUTPUT_SIZE
    offscreen.height = OUTPUT_SIZE
    const ctx = offscreen.getContext("2d")
    if (!ctx) return

    // Scale factor from crop preview to output
    const ratio = OUTPUT_SIZE / CROP_SIZE
    ctx.beginPath()
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(
      img,
      offset.x * ratio,
      offset.y * ratio,
      img.width * scale * ratio,
      img.height * scale * ratio,
    )

    offscreen.toBlob(
      (blob) => {
        if (blob) onCrop(blob)
      },
      "image/jpeg",
      0.9,
    )
  }, [offset, scale, onCrop])

  // Compute slider min/max
  const img = imgRef.current
  const minScale = img ? CROP_SIZE / Math.max(img.width, img.height) : 0.1
  const maxScale = img ? (CROP_SIZE / Math.min(img.width, img.height)) * 3 : 3

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <p className="mb-4 text-center text-sm font-semibold uppercase tracking-[0.15em] text-primary/70">
          Crop your photo
        </p>

        {/* Crop area */}
        <div className="mx-auto mb-4 flex items-center justify-center">
          <div
            className="relative overflow-hidden rounded-full"
            style={{ width: CROP_SIZE, height: CROP_SIZE, touchAction: "none" }}
          >
            {imageLoaded ? (
              <canvas
                ref={canvasRef}
                width={CROP_SIZE}
                height={CROP_SIZE}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary/10">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
          </div>
        </div>

        {/* Zoom slider */}
        {imageLoaded && (
          <div className="mb-5 flex items-center gap-3 px-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary/50">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <input
              type="range"
              min={minScale}
              max={maxScale}
              step={0.001}
              value={scale}
              onChange={handleSliderChange}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-primary/15 accent-primary"
            />
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary/50">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" />
            </svg>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-primary/20 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!imageLoaded}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
