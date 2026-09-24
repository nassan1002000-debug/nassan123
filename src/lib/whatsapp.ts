// توليد رابط واتساب مباشر (wa.me) من رقم هاتف مخزَّن بأي صيغة كتابة شائعة
// ----------------------------------------------------------------------------
// المبدأ: رقم بلا رمز دولة صريح (بلا + أو 00 في المقدمة) يُعامل كرقم محلي سوري
// فيُضاف له 963 تلقائياً (بعد حذف الصفر المحلي إن وُجد) — أما رقم بصيغة دولية
// صريحة (+966... أو 00966... مثلاً) فيبقى رمز دولته كما كُتب ولا يُفترض 963 عليه.

const SYRIA_CODE = '963'

/**
 * ينظّف رقم الهاتف ويحوّله لرابط https://wa.me/<رقم> جاهز — أو null إن كان
 * الرقم غائباً أو غير منطقي (أقل من 10 أرقام أو أكثر من 15 بعد التطبيع)
 */
export function toWhatsappUrl(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null
  const trimmed = rawPhone.trim()
  if (!trimmed) return null

  const hasExplicitCountryCode = trimmed.startsWith('+') || trimmed.startsWith('00')
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (hasExplicitCountryCode) {
    if (digits.startsWith('00')) digits = digits.slice(2)
  } else {
    if (digits.startsWith('0')) digits = digits.slice(1)
    if (!digits.startsWith(SYRIA_CODE)) digits = SYRIA_CODE + digits
  }

  if (digits.length < 10 || digits.length > 15) return null
  return `https://wa.me/${digits}`
}
