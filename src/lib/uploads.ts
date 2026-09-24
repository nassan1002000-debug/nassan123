// مجلد تخزين صور المواد — مصدر وحيد للثابت (كان معرّفاً بأربع نسخ)
// الصور خارج public وتُخدم عبر /api/files
import path from 'path'

export const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
