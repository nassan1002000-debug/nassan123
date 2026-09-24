import * as React from "react"

import { cn } from "@/lib/utils"

/** مفتاح لوحة مفاتيح مصغَّر — يُستخدم لتوثيق الاختصارات في الواجهة */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border bg-muted px-1 font-sans text-[10px] font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
