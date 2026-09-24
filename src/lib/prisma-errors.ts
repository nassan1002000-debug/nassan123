// أدوات مشتركة للتعامل مع أخطاء Prisma — خرق قيود التفرد (P2002)
// تُستخدم في: المواد، المستودعات، أوامر الجرد — لتمييز سباق الترقيم التلقائي عن تكرار حقيقي أدخله المستخدم

/** هل الخطأ خرق قيد تفرد في القاعدة؟ (P2002) */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}

/** الحقل/الفهرس الذي سبّب خرق التفرد — نص موحّد (مثل Item_code_key أو Item_barcode_key) */
export function uniqueTarget(error: unknown): string {
  const meta = (error as { meta?: { target?: unknown } }).meta?.target
  if (Array.isArray(meta)) return meta.join(',')
  return typeof meta === 'string' ? meta : ''
}
