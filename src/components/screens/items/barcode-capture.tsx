'use client'

// حقل رمز الباركود — ثلاث طرق للإدخال:
// 1) كتابة يدوية (أو قارئ ليزري خارجي — يكتب في الحقل مباشرة)
// 2) قراءة من صورة (رفع صورة تحتوي باركود وفك ترميزها عبر zxing)
// 3) مسح حي بالكاميرا (فتح الكاميرا ومسح الباركود مباشرة)

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImageUp, Loader2, ScanBarcode, ScanLine, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

interface BarcodeCaptureProps {
  value: string
  onChange: (v: string) => void
}

type ScannerControls = { stop: () => void }

export function BarcodeCapture({ value, onChange }: BarcodeCaptureProps) {
  const { toast } = useToast()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<ScannerControls | null>(null)

  const [decoding, setDecoding] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // ==================== 1) القراءة من صورة ====================
  const decodeFromImage = useCallback(
    async (file: File) => {
      setDecoding(true)
      let objectUrl: string | null = null
      try {
        objectUrl = URL.createObjectURL(file)
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { DecodeHintType } = await import('@zxing/library')
        const hints = new Map()
        hints.set(DecodeHintType.TRY_HARDER, true)
        const reader = new BrowserMultiFormatReader(hints)
        const result = await reader.decodeFromImageUrl(objectUrl)
        const text = result.getText().trim()
        onChange(text)
        toast({ title: `تم قراءة الباركود من الصورة: ${text}` })
      } catch (err) {
        console.error('[barcode-decode] failed:', err)
        toast({
          title: 'لم يُعثر على باركود واضح في الصورة',
          description: 'جرّب صورة أوضح وأقرب للباركود — وبصيغة JPG/PNG',
          variant: 'destructive',
        })
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        setDecoding(false)
        if (imageInputRef.current) imageInputRef.current.value = ''
      }
    },
    [onChange, toast],
  )

  // ==================== 2) المسح الحي بالكاميرا ====================
  useEffect(() => {
    if (!scanOpen) return
    let cancelled = false
    setCameraError(null)

    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
          if (cancelled || !result) return
          const text = result.getText().trim()
          onChange(text)
          toast({ title: `تم مسح الباركود: ${text}` })
          // إيقاف المسح بعد أول قراءة ناجحة
          controlsRef.current?.stop()
          controlsRef.current = null
          setScanOpen(false)
        })
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      } catch (err) {
        if (cancelled) return
        const name = err instanceof Error ? err.name : ''
        setCameraError(
          name === 'NotAllowedError'
            ? 'تم رفض الوصول إلى الكاميرا — فعّل إذن الكاميرا من المتصفح ثم أعد المحاولة'
            : 'تعذر فتح الكاميرا — تأكد من وجود كاميرا متصلة أو استخدم القراءة من صورة',
        )
      }
    })()

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [scanOpen, onChange, toast])

  return (
    <div className="space-y-1.5">
      <Label htmlFor="item-barcode" className="flex items-center gap-1.5">
        <ScanBarcode className="h-3.5 w-3.5 text-muted-foreground" />
        رمز الباركود
      </Label>

      <div className="relative">
        <Input
          id="item-barcode"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="امسح بالقارئ الليزري أو اكتب الرمز…"
          dir="ltr"
          className="num h-10 pl-8 font-mono"
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="مسح رمز الباركود"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[11px]"
          disabled={decoding}
          onClick={() => imageInputRef.current?.click()}
        >
          {decoding ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageUp className="h-3 w-3" />}
          من صورة
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[11px]"
          onClick={() => setScanOpen(true)}
        >
          <ScanLine className="h-3 w-3" />
          مسح بالكاميرا
        </Button>
        <span className="text-[10px] text-muted-foreground">يدعم القارئ الليزري مباشرة</span>
      </div>

      {/* إدخال صورة الباركود */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="اختر صورة تحتوي باركود"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) decodeFromImage(f)
        }}
      />

      {/* نافذة المسح الحي */}
      <Dialog open={scanOpen} onOpenChange={(o) => !o && setScanOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <ScanLine className="h-4 w-4 text-primary" />
              مسح الباركود بالكاميرا
            </DialogTitle>
            <DialogDescription>
              وجّه الكاميرا نحو الباركود — يُلتقط الرمز تلقائياً فور وضوحه
            </DialogDescription>
          </DialogHeader>

          {cameraError ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
              <Camera className="h-8 w-8 opacity-40" />
              <p className="max-w-xs text-sm text-muted-foreground">{cameraError}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => imageInputRef.current?.click()}>
                <ImageUp className="h-4 w-4" />
                القراءة من صورة بدلاً من ذلك
              </Button>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-xl border bg-black">
              <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-24 w-3/4 rounded-lg border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
              <p className="absolute inset-x-0 bottom-0 bg-black/60 py-1.5 text-center text-[11px] text-white/85">
                يبحث عن باركود…
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
