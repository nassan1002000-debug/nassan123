'use client'

// مدير صور المادة — بحد 10 صور (كما بالصورة المرجعية):
// • رفع بالسحب والإفلات أو الاختيار (زر «رفع صور») مع عدّاد (n/10)
// • ضغط الصور على جهاز المستخدم قبل الإرسال (تصغير + WebP/JPEG) — نقل أسرع عدة أضعاف
// • شريط تقدم حي بالنسبة المئوية أثناء الرفع
// • تعيين الصورة الأساسية (نجمة ذهبية) — ترافق المادة في كل الجداول
// • تحديد صور متعددة لتنزيلها على الجهاز كملف ZIP
// • معاينة كل صورة بالنقر (زوم بعجلة الماوس + تحريك بالمسك) عبر ImageViewer
// • حذف الصور (تنظيف تلقائي من القرص عند الإلغاء/الحفظ)

import { useRef, useState } from 'react'
import {
  Camera,
  CheckSquare,
  CloudUpload,
  Download,
  Loader2,
  Package,
  Star,
  Trash2,
  ZoomIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { MAX_IMAGES, type PendingImage } from './types'

interface ItemImagesManagerProps {
  images: PendingImage[]
  onChange: (next: PendingImage[]) => void
  /** فتح العارض على صورة محددة */
  onPreview: (index: number) => void
  /** اسم المادة لتسمية ملف ZIP */
  zipName?: string
  disabled?: boolean
}

let keySeq = 0
const nextKey = () => `img-${Date.now().toString(36)}-${keySeq++}`

// ==================== ضغط العميل قبل الرفع ====================

let webpSupport: boolean | null = null

/** هل يدعم المتصفح ترميز WebP عبر canvas؟ (يحفظ الشفافية) */
function browserEncodesWebp(): boolean {
  if (webpSupport === null) {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp')
    } catch {
      webpSupport = false
    }
  }
  return webpSupport
}

/**
 * ضغط الصورة على جهاز المستخدم قبل الإرسال — جوهر حل بطء الرفع:
 * صورة 700KB (غالباً بأبعاد كبيرة) تصبح ~100-200KB بعد التصغير لحد 1600px
 * وترميز WebP/JPEG بجودة 85 — نفس الجودة البصرية بجزء يسير من الحجم المُرسل.
 * الصيغ التي لا يفكها المتصفح (HEIC مثلاً) تُرسل كما هي والخادم يحوّلها.
 */
async function compressBeforeUpload(file: File): Promise<File> {
  try {
    // GIF متحرك وSVG تُرسل كما هي — والصور الصغيرة أصلاً لا تستحق إعادة ترميز
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file
    if (file.size <= 250 * 1024) return file

    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }

    const useWebp = browserEncodesWebp()
    // JPEG لا يحفظ الشفافية — تُسطّح على أبيض؛ WebP يحفظها كما هي
    if (!useWebp) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), useWebp ? 'image/webp' : 'image/jpeg', 0.85),
    )
    // إن لم يصغر الملف فعلياً نرسل الأصل (احتياطاً)
    if (!blob || blob.size >= file.size) return file

    const ext = useWebp ? '.webp' : '.jpg'
    const base = file.name.replace(/\.[^.]+$/, '')
    return new File([blob], `${base}${ext}`, { type: useWebp ? 'image/webp' : 'image/jpeg' })
  } catch {
    return file
  }
}

/** رفع مع تقدم حي (XMLHttpRequest يدعم upload.onprogress — fetch لا يدعمه) */
function uploadWithProgress(
  fd: FormData,
  onProgress: (pct: number) => void,
): Promise<{
  ok: boolean
  data: { files?: unknown[]; rejected?: { name: string; reason: string }[]; error?: string } | null
}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)))
    }
    xhr.onload = () => {
      onProgress(100)
      let data: { files?: unknown[]; rejected?: { name: string; reason: string }[]; error?: string } | null = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        data = null
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, data })
    }
    xhr.onerror = () => reject(new Error('فشل الاتصال بالخادم أثناء الرفع'))
    xhr.send(fd)
  })
}

export function ItemImagesManager({ images, onChange, onPreview, zipName, disabled }: ItemImagesManagerProps) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [uploadPct, setUploadPct] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)

  const remaining = MAX_IMAGES - images.length
  const full = remaining <= 0

  // ==================== الرفع ====================
  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0 || full) return

    // قبول واسع — الخادم يحوّل الصيغ (حتى HEIC من الجوال) ويضغط تلقائياً
    const isImageLike = (f: File) =>
      f.type.startsWith('image/') ||
      f.type === '' || // بعض الأجهزة ترسل HEIC بلا نوع
      /\.(heic|heif|avif|tiff?|bmp|jpe?g|png|webp|gif)$/i.test(f.name)
    const allowed = files.filter(isImageLike)
    const rejectedNames = files.filter((f) => !isImageLike(f))
    const toUpload = allowed.slice(0, remaining)
    const overflow = allowed.length - toUpload.length

    if (rejectedNames.length > 0) {
      toast({
        title: `${rejectedNames.length} ملف تجاوز — المسموح صور فقط`,
        description: rejectedNames
          .slice(0, 3)
          .map((f) => f.name)
          .join('، '),
        variant: 'destructive',
      })
    }
    if (overflow > 0) {
      toast({ title: `الحد الأقصى ${MAX_IMAGES} صور — تم تجاهل ${overflow} زائدة`, variant: 'destructive' })
    }
    if (toUpload.length === 0) return

    // ضغط على جهاز المستخدم أولاً — تصغير حجم النقل قبل مغادرة الشبكة
    const compressed = await Promise.all(toUpload.map((f) => compressBeforeUpload(f)))

    const fd = new FormData()
    for (const f of compressed) fd.append('files', f)

    setUploading((n) => n + toUpload.length)
    setUploadPct(0)
    try {
      const { ok, data } = await uploadWithProgress(fd, setUploadPct)
      if (!ok || !data?.files) {
        throw new Error(data?.error || 'فشل الرفع')
      }

      const uploaded: PendingImage[] = (data.files as { url: string; fileName: string; originalName: string }[]).map(
        (f) => ({
          key: nextKey(),
          url: f.url,
          fileName: f.fileName,
          originalName: f.originalName || f.fileName,
          isPrimary: false,
        }),
      )

      const next = [...images, ...uploaded]
      // أول صورة في البطاقة تصبح الأساسية تلقائياً
      if (!next.some((i) => i.isPrimary) && next.length > 0) next[0] = { ...next[0], isPrimary: true }
      onChange(next)

      if (Array.isArray(data.rejected) && data.rejected.length > 0) {
        const first = data.rejected[0] as { name: string; reason: string }
        toast({
          title: `تعذر رفع: ${first.name}`,
          description: first.reason,
          variant: 'destructive',
        })
      } else {
        toast({ title: `تم رفع ${uploaded.length} صورة بنجاح` })
      }
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'فشل رفع الصور',
        variant: 'destructive',
      })
    } finally {
      setUploading((n) => n - toUpload.length)
      setUploadPct(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  // ==================== الأفعال ====================
  function setPrimary(key: string) {
    onChange(images.map((img) => ({ ...img, isPrimary: img.key === key })))
    toast({ title: 'تم تعيين الصورة الأساسية — سترافق المادة في كل الجداول' })
  }

  function removeImage(key: string) {
    const target = images.find((i) => i.key === key)
    if (!target) return
    const next = images.filter((i) => i.key !== key)
    // إن حُذفت الأساسية تنتقل الشارة للصورة التالية
    if (target.isPrimary && next.length > 0) next[0] = { ...next[0], isPrimary: true }
    setSelected((prev) => {
      const s = new Set(prev)
      s.delete(key)
      return s
    })
    onChange(next)
  }

  function toggleSelect(key: string, checked: boolean) {
    setSelected((prev) => {
      const s = new Set(prev)
      if (checked) s.add(key)
      else s.delete(key)
      return s
    })
  }

  // ==================== التنزيل المجمّع (ZIP) ====================
  async function downloadSelected() {
    const chosen = images.filter((i) => selected.has(i.key))
    if (chosen.length === 0) return
    setDownloading(true)
    try {
      const res = await fetch('/api/items/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: chosen.map((c) => c.url), name: zipName || 'item-images' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'فشل التنزيل')
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `صور-${zipName || 'المادة'}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
      toast({ title: `تم تنزيل ${chosen.length} صورة في ملف مضغوط` })
      setSelected(new Set())
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'فشل تنزيل الصور', variant: 'destructive' })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* الرأس — كالصورة المرجعية: العنوان + وصف الحد + زر الرفع + العدّاد */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold">صور المادة</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            بحد {MAX_IMAGES} صور — تُضغط تلقائياً قبل الإرسال وعلى الخادم (حتى HEIC من الجوال) لأسرع رفع
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || full || uploading > 0}
            onClick={() => inputRef.current?.click()}
          >
            {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
            {uploading > 0 ? `جارٍ الرفع… ${uploadPct}%` : `رفع صور (${remaining} متبقٍ)`}
          </Button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,image/avif,.heic,.heif"
        multiple
        className="hidden"
        aria-label="اختيار صور للرفع"
        onChange={(e) => e.target.files && uploadFiles(e.target.files)}
      />

      {/* عدّاد الصور المحملة */}
      <p className="text-xs font-semibold text-muted-foreground">
        الصور المحملة (<span className="num">{images.length}</span>/<span className="num">{MAX_IMAGES}</span>)
      </p>

      {/* شريط التنزيل المحدد */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-xs font-semibold">
            <CheckSquare className="h-4 w-4 text-primary" />
            تم تحديد <span className="num">{selected.size}</span> {selected.size === 1 ? 'صورة' : 'صور'} للتنزيل
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" disabled={downloading} onClick={downloadSelected}>
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              تنزيل المحدد (ZIP)
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
              مسح التحديد
            </Button>
          </div>
        </div>
      )}

      {/* الشبكة + منطقة الرفع */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {images.map((img, idx) => (
          <div
            key={img.key}
            className={cn(
              'group relative overflow-hidden rounded-xl border bg-muted/30 transition-all',
              img.isPrimary ? 'border-amber-500/60 ring-1 ring-amber-500/30' : 'border-border hover:border-primary/40',
            )}
          >
            {/* الصورة — النقر يفتح المعاينة */}
            <button
              type="button"
              className="block aspect-square w-full cursor-zoom-in"
              onClick={() => onPreview(idx)}
              aria-label={`معاينة ${img.originalName}`}
              title="انقر للمعاينة — زوم بعجلة الماوس وتحريك بالمسك"
            >
              <img
                src={img.url}
                alt={img.originalName}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                draggable={false}
                loading="lazy"
              />
            </button>

            {/* شارة الأساسية */}
            {img.isPrimary && (
              <span className="absolute start-1.5 top-1.5 flex items-center gap-1 rounded-full bg-amber-500/95 px-2 py-0.5 text-[10px] font-bold text-black shadow">
                <Star className="h-3 w-3 fill-black" />
                أساسية
              </span>
            )}

            {/* خانة التحديد للتنزيل */}
            <label
              className="absolute end-1.5 top-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-white/40 bg-black/45 backdrop-blur transition-colors hover:bg-black/60"
              title="تحديد للتنزيل"
              onClick={(e) => e.preventDefault()}
            >
              <Checkbox
                checked={selected.has(img.key)}
                onCheckedChange={(v) => toggleSelect(img.key, v === true)}
                aria-label={`تحديد ${img.originalName} للتنزيل`}
                className="h-4 w-4 border-white text-white"
              />
            </label>

            {/* أفعال الصورة */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1.5 pt-6 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-white/90 hover:bg-white/20 hover:text-white"
                onClick={() => onPreview(idx)}
                aria-label="معاينة"
                title="معاينة وتكبير"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  'h-7 w-7 hover:bg-white/20',
                  img.isPrimary ? 'text-amber-400' : 'text-white/90 hover:text-white',
                )}
                disabled={img.isPrimary || disabled}
                onClick={() => setPrimary(img.key)}
                aria-label="تعيين كصورة أساسية"
                title="تعيين كصورة أساسية"
              >
                <Star className={cn('h-3.5 w-3.5', img.isPrimary && 'fill-amber-400')} />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-rose-300 hover:bg-rose-500/25 hover:text-rose-200"
                disabled={disabled}
                onClick={() => removeImage(img.key)}
                aria-label="حذف الصورة"
                title="حذف الصورة"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* اسم الملف */}
            <p className="truncate border-t bg-background/80 px-2 py-1 text-center text-[10px] text-muted-foreground" dir="auto">
              {img.originalName}
            </p>
          </div>
        ))}

        {/* بطاقة الرفع المتبقية (كالصورة المرجعية: إطار منقّط بأيقونة كاميرا) */}
        {!full && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading > 0}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files)
            }}
            className={cn(
              'flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-muted-foreground transition-all',
              dragOver
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:border-primary/50 hover:bg-accent/40',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            aria-label={`منطقة رفع الصور — متاح ${remaining}`}
          >
            {uploading > 0 ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin" />
                <span className="num text-xs font-semibold">
                  {uploadPct === 0 ? 'جارٍ الضغط…' : `جارٍ الرفع ${uploadPct}%`}
                </span>
                <div
                  className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={uploadPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-200"
                    style={{ width: `${Math.max(uploadPct, 4)}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <Camera className="h-7 w-7" />
                <span className="text-xs font-semibold">[صورة {images.length + 1}]</span>
                <span className="px-2 text-center text-[10px] leading-tight">انقر أو اسحب الصور هنا</span>
              </>
            )}
          </button>
        )}
      </div>

      {images.length === 0 && uploading === 0 && (
        <p className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-[11px] text-muted-foreground">
          <Package className="h-3.5 w-3.5" />
          يمكن للمادة العمل بلا صور، لكن الصورة الأساسية تعزز التعريف في كل الجداول
        </p>
      )}
    </div>
  )
}
