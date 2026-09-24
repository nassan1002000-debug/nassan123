// تعليم المستخدمين الحاملين لكلمات المرور الافتراضية بـ mustChangePassword (P1-3)
// الاستخدام لمرة واحدة بعد تفعيل حقل mustChangePassword على قاعدة قائمة:
//   bun scripts/mark-default-passwords.ts
// يفحص الحسابات الثلاثة المعروفة بأسمائها الافتراضية: إن كانت كلمة مروره ما تزال
// الافتراضية نفسها فسيُجبر حاملها على تغييرها عند أول دخول (شاشة إلزامية)
import { PrismaClient } from '@prisma/client'
import { verifyPassword } from '../src/lib/password'

const db = new PrismaClient()

const DEFAULTS: { username: string; password: string }[] = [
  { username: 'admin', password: 'admin123' },
  { username: 'accountant', password: 'acc123' },
  { username: 'viewer', password: 'view123' },
]

async function main(): Promise<void> {
  let marked = 0
  for (const d of DEFAULTS) {
    const user = await db.user.findUnique({ where: { username: d.username } })
    if (!user || !user.passwordHash) continue
    if (verifyPassword(d.password, user.passwordHash) && !user.mustChangePassword) {
      await db.user.update({ where: { id: user.id }, data: { mustChangePassword: true } })
      marked += 1
      console.log(`marked: ${d.username}`)
    } else if (user.mustChangePassword) {
      console.log(`already marked: ${d.username}`)
    } else {
      console.log(`ok (custom password): ${d.username}`)
    }
  }
  console.log(`done — marked ${marked}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
