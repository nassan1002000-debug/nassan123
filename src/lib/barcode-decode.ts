// فك ترميز الباركود من صورة على الخادم — نظير للقراءة العميلية عبر zxing/browser
// ----------------------------------------------------------------------------
// لماذا خادمياً أيضاً؟ الفك العميلي (BrowserMultiFormatReader.decodeFromImageUrl)
// يمرر الصورة كما هي لمحرك zxing بلا أي معالجة مسبقة — فتفشل القراءة على صور
// بإضاءة ضعيفة أو تباين منخفض أو دقة عالية جداً (المحرك يبحث بمقياس واحد فقط
// افتراضياً). المعالجة المسبقة هنا (تحجيم لعرض معياري + تدرج رمادي + تمديد تباين
// تلقائي عبر sharp) ترفع نسبة النجاح على نفس الصور الملتقطة من هاتف بإضاءة عادية.
//
// RGBLuminanceSource يقبل مصفوفة رمادية بايت واحد للبكسل مباشرة (لا يفرض تعبيد
// ARGB إلا لـInt32Array) — فتُغذّى صورة sharp الرمادية الخام دون أي تحويل إضافي.
//
// تحسين إضافي (طلب صريح): الباركود على عبوة منحنية أو ملتقط بزاوية غير مستوية
// (لا يصلحه تدوير EXIF المعلوماتي) — فتُجرَّب 4 زوايا دوران فعلي (0/90/180/270)
// × مستويان من التباين (تمديد تلقائي عادي، وتضخيم تباين صريح لصور باهتة جداً) —
// أول قراءة ناجحة تُعاد فوراً؛ 8 محاولات كحد أقصى، كل واحدة على نفس الأبعاد
// المصغّرة فالتكلفة الإضافية معقولة (كسور الثانية) لصالح دقة الالتقاط.

import sharp from 'sharp'
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  RGBLuminanceSource,
} from '@zxing/library'

const MAX_DIM = 1400 // كافٍ لأي باركود واقعي وأسرع من معالجة الدقة الكاملة للكاميرا
const ROTATIONS = [0, 90, 180, 270] as const

const hints = new Map()
hints.set(DecodeHintType.TRY_HARDER, true)

/** محاولة فك واحدة على زاوية دوران ومستوى تباين محددين — null بلا رمي عند الفشل */
async function tryDecode(buffer: Buffer, angle: number, boostContrast: boolean): Promise<string | null> {
  try {
    let pipeline = sharp(buffer, { failOn: 'none' })
      .rotate() // احترام دوران EXIF أولاً (صور الهاتف محفوظة بتدوير معلوماتي لا بكسلي)
      .rotate(angle) // ثم الدوران الفعلي المُجرَّب — يُطبَّق فوق تصحيح EXIF لا بدلاً منه
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: false })
      .grayscale()

    // تمديد تباين تلقائي دائماً، وتثبيت ثنائي (Binarization) صريح إضافي عند التضخيم —
    // يفصل خطوط الباركود عن الخلفية بحدة أكبر من التمديد التلقائي وحده على صور باهتة/منعكسة
    pipeline = boostContrast
      ? pipeline.normalize().linear(1.6, -40).threshold(128)
      : pipeline.normalize()

    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
    const luminances = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
    const source = new RGBLuminanceSource(luminances, info.width, info.height)
    const bitmap = new BinaryBitmap(new HybridBinarizer(source))

    const reader = new MultiFormatReader()
    reader.setHints(hints)
    const result = reader.decode(bitmap)
    return result.getText().trim() || null
  } catch (error) {
    if (error instanceof NotFoundException) return null
    console.error(`[barcode-decode] attempt failed (angle=${angle}, boost=${boostContrast}):`, error)
    return null
  }
}

/**
 * يحاول فك باركود من بيانات صورة خام (JPEG/PNG/WebP إلخ) — يعيد النص المفكوك
 * أو null إن لم يُعثر على رمز مقروء في أي من المحاولات. لا يرمي أبداً.
 */
export async function decodeBarcodeFromImage(buffer: Buffer): Promise<string | null> {
  for (const boostContrast of [false, true]) {
    for (const angle of ROTATIONS) {
      const text = await tryDecode(buffer, angle, boostContrast)
      if (text) return text
    }
  }
  return null
}
