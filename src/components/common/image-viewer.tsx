'use client'

// عارض الصور الاحترافي — معاينة مكبّرة:
// • زوم بعجلة الماوس (نحو مؤشر الفأرة) وأزرار +/−
// • تحريك بكافة الجهات بعد التكبير: مسك + ضغط بزر الماوس الأيسر (Pointer Events)
// • نقر مزدوج: تكبير/إعادة ضبط • تنقل بين الصور بالأسهم • تنزيل الصورة
// يُستخدم من شاشة المواد ومن النوافذ الأخرى (Portal فوق كل شيء)

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface ViewerImage {
  url: string
  title?: string
}

interface ImageViewerProps {
  images: ViewerImage[]
  /** فهرس الصورة المعروضة — null يعني مغلق */
  index: number | null
  onClose: () => void
  onIndexChange?: (index: number) => void
  /** عنوان سياقي (اسم المادة مثلاً) */
  contextTitle?: string
}

const MIN_SCALE = 1
const MAX_SCALE = 8
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function ImageViewer({ images, index, onClose, onIndexChange, contextTitle }: ImageViewerProps) {
  const open = index !== null && images.length > 0
  const current = open ? images[Math.min(index!, images.length - 1)] : null

  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef({ px: 0, py: 0, ox: 0, oy: 0 })
  const wheelCleanupRef = useRef<(() => void) | null>(null)

  const scale = view.scale
  const offset = { x: view.x, y: view.y }

  const reset = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 })
  }, [])

  // إعادة الضبط عند تغيير الصورة أو الإغلاق — نمط ضبط الحالة أثناء الرندر (بدون effect)
  const [prevIndex, setPrevIndex] = useState(index)
  if (prevIndex !== index) {
    setPrevIndex(index)
    setView({ scale: 1, x: 0, y: 0 })
    setLoaded(false)
  }

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = clientX - rect.left - rect.width / 2
    const cy = clientY - rect.top - rect.height / 2
    setView((v) => {
      const next = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      if (next === v.scale) return v
      if (next === MIN_SCALE) return { scale: next, x: 0, y: 0 }
      const ratio = next / v.scale
      return { scale: next, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio }
    })
  }, [])

  // رفع مستمع عجلة الماوس عبر ref callback — يضمن الالتصاق لحظة وجود العقدة في الـ Portal
  const setContainerNode = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node
      wheelCleanupRef.current?.()
      wheelCleanupRef.current = null
      if (node) {
        const onWheel = (e: WheelEvent) => {
          e.preventDefault()
          zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15)
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        wheelCleanupRef.current = () => node.removeEventListener('wheel', onWheel)
      }
    },
    [zoomAt],
  )

  // أسهم لوحة المفاتيح للتنقل
  const go = useCallback(
    (dir: 1 | -1) => {
      if (index === null || images.length < 2 || !onIndexChange) return
      onIndexChange((index + dir + images.length) % images.length)
    },
    [index, images.length, onIndexChange],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // RTL: السهم الأيسر = التالي، الأيمن = السابق
      if (e.key === 'ArrowLeft') go(1)
      else if (e.key === 'ArrowRight') go(-1)
      else if (e.key === '0') reset()
      else if (e.key === '+' || e.key === '=') zoomAtCenter(1.25)
      else if (e.key === '-') zoomAtCenter(1 / 1.25)
    }
    const zoomAtCenter = (f: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, f)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, go, reset, zoomAt])

  // ==================== التحريك: مسك + زر أيسر ====================
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || scale <= MIN_SCALE) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const dx = e.clientX - dragStart.current.px
    const dy = e.clientY - dragStart.current.py
    setView((v) => ({ ...v, x: dragStart.current.ox + dx, y: dragStart.current.oy + dy }))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      setDragging(false)
    }
  }

  const zoomByButton = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  const handleDownload = async () => {
    if (!current) return
    try {
      const res = await fetch(current.url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = current.title || 'image'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(current.url, '_blank')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        variant="preview"
        className="no-print flex h-[92vh] w-[calc(100vw_-_var(--sidebar-w)_-_1rem)] max-w-[1400px] flex-col gap-0 overflow-hidden border bg-black/95 p-0 sm:max-w-[1400px]"
        aria-describedby={undefined}
      >
        {/* شريط الرأس */}
        <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b border-white/10 bg-black/60 py-2.5 pl-14 pr-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <DialogTitle className="truncate text-sm font-bold text-white">
              {current?.title || 'معاينة الصورة'}
            </DialogTitle>
            {contextTitle && (
              <span className="hidden truncate text-xs text-white/50 sm:inline">— {contextTitle}</span>
            )}
            {images.length > 1 && (
              <span className="num shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70">
                {(index ?? 0) + 1} / {images.length}
              </span>
            )}
          </div>
          <DialogDescription className="sr-only">عارض الصور مع تكبير وتحريك</DialogDescription>
          <div className="flex shrink-0 items-center gap-1">
            <span className="num me-1 hidden rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/80 sm:inline-block">
              {Math.round(scale * 100)}%
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white/80 hover:bg-white/15 hover:text-white"
              onClick={() => zoomByButton(1.25)}
              disabled={scale >= MAX_SCALE}
              aria-label="تكبير"
              title="تكبير (+)"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white/80 hover:bg-white/15 hover:text-white"
              onClick={() => zoomByButton(1 / 1.25)}
              disabled={scale <= MIN_SCALE}
              aria-label="تصغير"
              title="تصغير (−)"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white/80 hover:bg-white/15 hover:text-white"
              onClick={reset}
              aria-label="إعادة الضبط"
              title="إعادة الضبط (0)"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white/80 hover:bg-white/15 hover:text-white"
              onClick={handleDownload}
              aria-label="تنزيل الصورة"
              title="تنزيل الصورة"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white/80 hover:bg-white/15 hover:text-white"
              onClick={onClose}
              aria-label="إغلاق"
              title="إغلاق (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* منطقة الصورة */}
        <div
          ref={setContainerNode}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            if (scale > MIN_SCALE) reset()
            else {
              const rect = containerRef.current?.getBoundingClientRect()
              if (rect) zoomAt(e.clientX, e.clientY, 2.5 / scale)
            }
          }}
          className={cn(
            'relative flex-1 select-none overflow-hidden touch-none',
            scale > MIN_SCALE ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
          )}
          aria-label="منطقة معاينة الصورة — عجلة الماوس للتكبير والمسك بالزر الأيسر للتحريك"
        >
          {!loaded && current && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            </div>
          )}
          {current ? (
            <img
              src={current.url}
              alt={current.title || 'معاينة'}
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              className="absolute left-1/2 top-1/2 max-h-full max-w-full"
              style={{
                transform: `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                transformOrigin: 'center',
                imageRendering: scale >= 3 ? 'pixelated' : 'auto',
              }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
              <ImageOff className="h-10 w-10" />
              <p className="text-sm">لا توجد صورة للمعاينة</p>
            </div>
          )}

          {/* أسهم التنقل بين الصور */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="الصورة السابقة"
                onClick={() => go(-1)}
                className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/60 p-2.5 text-white/85 backdrop-blur transition-colors hover:bg-white/20"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="الصورة التالية"
                onClick={() => go(1)}
                className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/60 p-2.5 text-white/85 backdrop-blur transition-colors hover:bg-white/20"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            </>
          )}

          {/* تلميح الاستخدام */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-[11px] text-white/60 backdrop-blur">
            عجلة الماوس: تكبير • مسك بالزر الأيسر: تحريك • نقر مزدوج: تكبير/إعادة • الأسهم: تنقل
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
