'use client'

// منتقي المواد بالبحث — يعرض الصورة الأساسية + الكود + الاسم + الباركود
// قائمة منسدلة بحد أقصى للارتفاع مع تمرير، اختيار بلوحة المفاتيح والنقر

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Barcode, Package, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ItemLite } from './types'

interface ItemComboboxProps {
  items: ItemLite[]
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  placeholder?: string
  /** عند توفيرها يظهر خيار «إضافة مادة جديدة» في نهاية القائمة المنسدلة */
  onAddNew?: () => void
  /** معرّف حقل البحث — يتيح تركيز الحقل برمجياً (مثلاً من سطر سابق عند التنقل بالإدخال السريع) */
  id?: string
  /** تُستدعى فور اختيار مادة (بالنقر أو Enter) — تتيح للمستدعي نقل التركيز لحقل العدد تلقائياً */
  onPicked?: () => void
}

export function ItemCombobox({ items, value, onChange, disabled, placeholder, onAddNew, id, onPicked }: ItemComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0) // عنصر مُضاء بلوحة المفاتيح
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const wheelCleanupRef = useRef<() => void>(() => {})
  // إحداثيات القائمة المنسدلة عند تعويمها بـ Portal إلى body — تتفادى قصّها بسبب
  // overflow:auto لجدول بنود الفاتورة (حاوية الأب) وتظهر دوماً فوق كل الصفوف
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  // تمرير دولاب الماوس داخل القائمة المعوَّمة — تعطيل React لتمرير الصفحة أثناء فتح
  // أي Dialog (قفل التمرير) يمنع أيضاً تمرير أي عنصر معوَّم بـ Portal خارج شجرة النافذة
  // (preventDefault على مستوى document قبل وصول الحدث لعنصرنا)، فنُدير التمرير يدوياً
  // على القائمة نفسها بمستمع أصلي غير سلبي (passive:false) بمجرد إنشاء عقدتها —
  // ref callback يضمن التوقيت الصحيح مع دورة حياة الـ Portal (لا يعتمد على ترتيب effects)
  const setListRef = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el
    wheelCleanupRef.current()
    if (el) {
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        el.scrollTop += e.deltaY
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      wheelCleanupRef.current = () => el.removeEventListener('wheel', onWheel)
    } else {
      wheelCleanupRef.current = () => {}
    }
  }, [])

  const selected = useMemo(() => items.find((i) => i.id === value) ?? null, [items, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? items.filter((i) =>
          [i.name, i.code, i.barcode ?? ''].join(' ').toLowerCase().includes(q),
        )
      : items
    return list.slice(0, 50)
  }, [items, query])

  // إغلاق عند النقر خارجاً — يشمل القائمة المُعوَّمة بـ Portal خارج شجرة boxRef
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      const inBox = boxRef.current?.contains(t)
      const inList = listRef.current?.contains(t)
      if (!inBox && !inList) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // حساب موقع القائمة المنسدلة بالنسبة للـ viewport وتحديثه أثناء التمرير/تغيير الحجم
  // (capture:true يلتقط تمرير أي حاوية أب، مثل جدول بنود الفاتورة القابل للتمرير)
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const r = boxRef.current?.getBoundingClientRect()
      if (r) setCoords({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  function pick(item: ItemLite) {
    onChange(item.id)
    setOpen(false)
    setQuery('')
    onPicked?.()
  }

  // تمرير العنصر المُضاء بلوحة المفاتيح للمرئية
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hi])

  /** تنقل بلوحة المفاتيح: أسهم + Enter للاختيار + Escape للإغلاق */
  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => (h + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => (h - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = filtered[hi]
      if (it) pick(it)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={boxRef} className="relative">
      {/* الحقل المُختار / زر الفتح */}
      {selected && !open ? (
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-md border bg-background px-3 py-2',
            disabled && 'opacity-60',
          )}
        >
          {selected.primaryImageUrl ? (
            <img
              src={selected.primaryImageUrl}
              alt={selected.name}
              className="h-9 w-9 rounded-md border object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed text-muted-foreground/50">
              <Package className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{selected.name}</p>
            <p className="num text-[10px] text-muted-foreground">
              {selected.code}
              {selected.barcode ? ` · ${selected.barcode}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {
              onChange(null)
              setQuery('')
            }}
            aria-label="مسح المادة المختارة"
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            id={id}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHi(0)
              if (!open) setOpen(true)
            }}
            onKeyDown={onInputKeyDown}
            onFocus={() => {
              setOpen(true)
              setHi(0)
            }}
            disabled={disabled}
            placeholder={placeholder ?? 'ابحث بالاسم أو الكود أو الباركود…'}
            className="h-10 w-full rounded-md border border-input bg-background ps-8 pe-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="بحث واختيار مادة"
            role="combobox"
            aria-expanded={open}
            aria-controls="item-combobox-list"
            aria-activedescendant={open && filtered[hi] ? `item-opt-${filtered[hi].id}` : undefined}
          />
        </div>
      )}

      {/* القائمة المنسدلة — معوَّمة بـ Portal إلى body فتظهر دوماً فوق كل الصفوف بلا قصّ
          pointerEvents: 'auto' ضروري صراحة — Radix Dialog يضع pointer-events:none على
          body بأكمله أثناء فتح أي نافذة (قفل التمرير)، وأي Portal لبود خارج شجرة
          DialogContent يرث التعطيل فيصبح غير قابل للنقر بالماوس كلياً رغم ظهوره بصرياً */}
      {open && coords && createPortal(
        <div
          ref={setListRef}
          id="item-combobox-list"
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, pointerEvents: 'auto' }}
          className="z-[100] max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg"
          role="listbox"
          aria-label="قائمة المواد"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {items.length === 0 ? 'لا توجد مواد — أنشئ بطاقات المواد أولاً' : 'لا نتائج مطابقة للبحث'}
            </p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                id={`item-opt-${item.id}`}
                data-idx={idx}
                aria-selected={item.id === value}
                onMouseDown={(e) => {
                  // mousedown قبل blur الحقل — يمنع إغلاق القائمة قبل تسجيل الاختيار
                  e.preventDefault()
                  pick(item)
                }}
                onMouseEnter={() => setHi(idx)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-accent',
                  idx === hi && 'bg-accent',
                  item.id === value && 'bg-primary/10',
                )}
              >
                {item.primaryImageUrl ? (
                  <img
                    src={item.primaryImageUrl}
                    alt={item.name}
                    className="h-8 w-8 rounded-md border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed text-muted-foreground/50">
                    <Package className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.name}</span>
                  <span className="num block text-[10px] text-muted-foreground">{item.code}</span>
                </span>
                {item.barcode && (
                  <span className="num flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground" dir="ltr">
                    <Barcode className="h-3 w-3" />
                    {item.barcode}
                  </span>
                )}
              </button>
            ))
          )}

          {/* خيار إضافة مادة جديدة — نافذة سريعة تنبثق ثم تستقر المادة في البند */}
          {onAddNew && (
            <>
              <div className="mx-2 my-1 border-t" aria-hidden="true" />
              <button
                type="button"
                aria-label="إضافة مادة جديدة"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setOpen(false)
                  setQuery('')
                  onAddNew()
                }}
                className="flex w-full items-center gap-2.5 rounded-b-md px-3 py-2.5 text-start text-primary transition-colors hover:bg-primary/10"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-primary/40 bg-primary/10">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">إضافة مادة جديدة</span>
                  <span className="block text-[10px] text-muted-foreground">
                    نافذة سريعة — بعد الحفظ تستقر المادة في البند مباشرة
                  </span>
                </span>
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
