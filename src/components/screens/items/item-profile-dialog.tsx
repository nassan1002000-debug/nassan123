'use client'

// بطاقة تعريف المادة — عرض شامل: معرض الصور (أساسية بارزة) + البيانات + الوحدات + المسار في الشجرة

import { useMemo, useState } from 'react'
import {
  Barcode,
  IdCard,
  MapPin,
  Package,
  Pencil,
  ReceiptText,
  Star,
  UserRound,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { fmtDate, fmtMoney, fmtQty, fmtUSD } from '@/lib/format'
import { useIsArchive } from '@/lib/store'
import { ImageViewer } from '@/components/common/image-viewer'
import { LEVEL_ICONS, LEVEL_STYLES, type WarehouseDTO } from '../warehouses/types'
import { warehousePath, type ItemDTO } from './types'

interface ItemProfileDialogProps {
  item: ItemDTO | null
  warehouses: WarehouseDTO[]
  onClose: () => void
  onEdit: (item: ItemDTO) => void
}

export function ItemProfileDialog({ item, warehouses, onClose, onEdit }: ItemProfileDialogProps) {
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const isArchive = useIsArchive()

  const path = useMemo(
    () => (item && item.warehouseId ? warehousePath(warehouses, item.warehouseId) : []),
    [item, warehouses],
  )

  if (!item) return null

  const primary = item.images.find((i) => i.isPrimary) ?? item.images[0] ?? null
  const others = item.images.filter((i) => i.url !== primary?.url)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="preview" className="flex max-h-[92vh] w-[calc(100vw_-_var(--sidebar-w)_-_1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]">
        <DialogHeader className="border-b px-5 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pe-14">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="rounded-lg bg-primary/12 p-1.5 text-primary">
                <IdCard className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate text-base font-bold">{item.name}</DialogTitle>
                <DialogDescription className="num text-xs">
                  رقم البطاقة: {item.code}
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  'text-[11px]',
                  item.isActive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground',
                )}
              >
                {item.isActive ? 'نشطة' : 'موقوفة'}
              </Badge>
              {!isArchive && (
                <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
                  <Pencil className="h-3.5 w-3.5" />
                  تعديل
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
            {/* ============ معرض الصور ============ */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-muted-foreground">صور المادة ({item.images.length}/10)</h4>
              {primary ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPreviewIdx(0)}
                    className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl border-2 border-amber-500/50"
                    title="انقر للمعاينة بالتكبير"
                  >
                    <img
                      src={primary.url}
                      alt={`الصورة الأساسية — ${item.name}`}
                      className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    <span className="absolute start-2 top-2 flex items-center gap-1 rounded-full bg-amber-500/95 px-2 py-0.5 text-[10px] font-bold text-black shadow">
                      <Star className="h-3 w-3 fill-black" />
                      أساسية
                    </span>
                  </button>
                  {others.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {others.map((img, i) => (
                        <button
                          key={img.id ?? img.url}
                          type="button"
                          onClick={() => setPreviewIdx(i + 1)}
                          className="overflow-hidden rounded-lg border transition-all hover:border-primary/50 hover:opacity-90"
                          title={img.fileName}
                        >
                          <img
                            src={img.url}
                            alt={img.fileName}
                            className="aspect-square w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-center text-[11px] text-muted-foreground">
                    انقر أي صورة للمعاينة بالتكبير والتحريك
                  </p>
                </>
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground">
                  <Barcode className="h-8 w-8 opacity-40" />
                  <p className="text-xs">لا توجد صور لهذه المادة</p>
                </div>
              )}
            </div>

            {/* ============ البيانات ============ */}
            <div className="space-y-4">
              {/* شبكة البيانات الأساسية */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3">
                <Detail
                  label="رمز الباركود"
                  value={item.barcode ?? '—'}
                  num
                  mono
                  icon={<Barcode className="h-3 w-3" />}
                />
                <Detail label="الحد الأدنى" value={fmtQty(item.minStock)} num />
                <Detail label="الحد الأعلى" value={fmtQty(item.maxStock)} num />
                <Detail
                  label="سعر الشراء (تلقائي)"
                  value={fmtMoney(item.purchasePrice)}
                  sub={fmtUSD(item.purchasePrice)}
                  num
                />
                <Detail label="سعر البيع" value={fmtMoney(item.salePrice)} sub={fmtUSD(item.salePrice)} num />
                <Detail
                  label="الضريبة"
                  value={item.taxRate > 0 ? `${fmtQty(item.taxRate)}%` : '—'}
                  sub={item.taxRate > 0 ? fmtMoney((item.salePrice * item.taxRate) / 100) : undefined}
                  num
                />
              </div>

              {/* تفاصيل سعر الشراء التلقائي من المشتريات */}
              {item.purchaseInfo && (
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-xs">
                  <p className="mb-2 flex items-center gap-1.5 font-bold text-primary">
                    <ReceiptText className="h-3.5 w-3.5" />
                    سعر الشراء — يُحتسب تلقائياً من فواتير المشتريات
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground">آخر سعر شراء</p>
                      <p className="num mt-0.5 text-sm font-bold">{fmtMoney(item.purchaseInfo.last)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">السعر الوسطي</p>
                      <p className="num mt-0.5 text-sm font-bold">{fmtMoney(item.purchaseInfo.avg)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">آخر فاتورة</p>
                      <p className="num mt-0.5 text-sm font-bold">
                        {item.purchaseInfo.lastInvoiceNumber ?? '—'}
                        {item.purchaseInfo.lastInvoiceDate && (
                          <span className="ms-1.5 text-[10px] font-normal text-muted-foreground">
                            {fmtDate(item.purchaseInfo.lastInvoiceDate)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {item.description && (
                <div className="rounded-xl border p-4">
                  <p className="mb-1 text-xs font-bold text-muted-foreground">الوصف</p>
                  <p className="text-sm leading-relaxed">{item.description}</p>
                </div>
              )}

              {/* وحدات المادة */}
              <div>
                <h4 className="mb-2 text-xs font-bold text-muted-foreground">
                  وحدات المادة ({item.units.length}/3)
                </h4>
                {item.units.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
                    لا توجد وحدات مسجلة لهذه المادة
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead>اسم الوحدة</TableHead>
                          <TableHead>معامل التحويل</TableHead>
                          <TableHead>الرمز الشريطي</TableHead>
                          <TableHead>الحالة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.units.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell className="text-sm font-semibold">{u.name}</TableCell>
                            <TableCell className="num text-sm">{fmtQty(u.factor)}</TableCell>
                            <TableCell className="num text-xs" dir="ltr">
                              {u.barcode ?? '—'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[10px]',
                                  u.isActive
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'text-muted-foreground',
                                )}
                              >
                                {u.isActive ? 'مفعّل' : 'موقوف'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* المستودع — المسار الكامل */}
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <WarehouseIcon className="h-3.5 w-3.5" />
                  الإسناد المخزني — القسم النهائي
                </h4>
                {item.warehouse ? (
                  <div className="space-y-2 rounded-xl border bg-muted/20 p-3.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {path.map((w, i) => {
                        const Icon = LEVEL_ICONS[w.level]
                        const style = LEVEL_STYLES[w.level]
                        return (
                          <span key={w.id} className="flex items-center gap-1.5">
                            {i > 0 && <span className="text-xs text-muted-foreground">←</span>}
                            <span className="flex items-center gap-1 rounded-lg border bg-background px-2 py-1 text-xs">
                              {Icon && <Icon className={cn('h-3.5 w-3.5', style?.iconBox.split(' ')[1])} />}
                              <span className="font-semibold">{w.name}</span>
                              <span className="num text-[10px] text-muted-foreground">{w.code}</span>
                            </span>
                          </span>
                        )
                      })}
                    </div>
                    {path[path.length - 1]?.keeperName && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <UserRound className="h-3.5 w-3.5" />
                        أمين القسم:{' '}
                        <span className="font-semibold text-foreground/80">
                          {path[path.length - 1].keeperName}
                        </span>
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {item.warehouse.name} — مستوى <span className="num">{item.warehouse.level}</span>
                      {item.location && (
                        <>
                          {' '}• مكان التواجد: <span className="font-semibold text-foreground/80">{item.location}</span>
                        </>
                      )}
                    </p>
                    {item.balances && (
                      <p className="num flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Package className="h-3.5 w-3.5" />
                        الرصيد الحالي: <span className="font-bold text-foreground/80">
                          {fmtQty(item.balances.find((b) => b.warehouseId === item.warehouseId)?.quantity ?? 0)}
                        </span>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
                    غير مسندة لمستودع
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* عارض الصور فوق البطاقة */}
        <ImageViewer
          images={item.images.map((i) => ({ url: i.url, title: i.fileName }))}
          index={previewIdx}
          onClose={() => setPreviewIdx(null)}
          onIndexChange={setPreviewIdx}
          contextTitle={item.name}
        />
      </DialogContent>
    </Dialog>
  )
}

function Detail({
  label,
  value,
  sub,
  num,
  mono,
  icon,
}: {
  label: string
  value: string
  sub?: string
  num?: boolean
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={cn('mt-0.5 text-sm font-bold', num && 'num', mono && 'font-mono')}>{value}</p>
      {sub && <p className="num text-[11px] text-muted-foreground">≈ {sub}</p>}
    </div>
  )
}
