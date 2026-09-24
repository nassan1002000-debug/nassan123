// خطاف إقلاع الخادم (Next.js instrumentation) — المرحلة الأولى P1-7
// الملف خفيف عن قصد: يُستدعى في بيئتي التشغيل، فنفسح للـEdge بالمرور ونستورد
// منطق Node ديناميكياً فقط عند التشغيل على Node — وإلا انكسر ترجمة Edge
export async function register(): Promise<void> {
  console.log('[instrumentation] register called, runtime =', process.env.NEXT_RUNTIME)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const mod = await import('./instrumentation-nodejs')
    await mod.registerNodejs()
  }
}
