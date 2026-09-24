"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  variant = 'form',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /**
   * form (افتراضي): نوافذ النماذج والبيانات — حماية صارمة من الإغلاق العرضي
   *   (لا Escape ولا نقر خارجاً — الإغلاق بأزرار صريحة فقط).
   * preview: نوافذ المعاينة والطباعة والتقارير بلا أزرار إجراءات (حفظ/إلغاء) —
   *   تُغلق بحرية بـ Escape والنقر خارجها تفادياً لحبس المستخدم، مع زر X مجسّم
   *   بارز في الزاوية اليسرى العليا كمخرج سريع دائم (Task 46).
   */
  variant?: 'form' | 'preview'
}) {
  const preview = variant === 'preview'
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // Task 40 — حماية النماذج من الإغلاق العرضي | Task 46 — استثناء نوافذ المعاينة/التقارير
        // (يمكن لأي مستدعٍ تجاوز الحماية بتمرير معالجاته الخاصة عبر props)
        onEscapeKeyDown={preview ? undefined : (event) => event.preventDefault()}
        onInteractOutside={preview ? undefined : (event) => event.preventDefault()}
        onFocusOutside={preview ? undefined : (event) => event.preventDefault()}
        className={cn(
          // [&>*]:min-w-0 — حارس تسرب الشبكة: أبناء DialogContent شبكة (grid)، وبغير هذا
          // الحارس يتمدد مسار الشبكة إلى العرض الأدنى لمحتوى الجداول العريضة فيفيض خارج
          // صندوق النافذة (زر الطباعة والعنوان يتراكبان مع الصفحة خلفها). بـ min-w-0
          // يبقى الصندوق بطول MaxWidth المعلن وتمرّر الجداول العريضة أفقياً داخل حاويتها.
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg [&>*]:min-w-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton &&
          (preview ? (
            <DialogPrimitive.Close
              data-slot="dialog-close-preview"
              aria-label="إغلاق المعاينة"
              title="إغلاق — أو اضغط Escape أو انقر خارج النافذة"
              className={cn(
                'absolute top-3 left-3 z-20 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                // زر مجسّم بارز بنفس لغة الأزرار المجسمة في النظام (تدرج داكن + إبراز داخلي + هالة هوية)
                'border border-white/10 bg-gradient-to-b from-zinc-600/70 via-zinc-800 to-zinc-900 text-zinc-50',
                'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),inset_0_-1px_0_0_rgba(0,0,0,0.45),0_4px_12px_-4px_rgba(0,0,0,0.6),0_0_12px_-4px_color-mix(in_oklab,var(--primary)_45%,transparent)]',
                'transition-all duration-200 ease-out',
                'hover:from-zinc-500/70 hover:text-white hover:scale-105',
                'hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_6px_16px_-6px_rgba(0,0,0,0.7),0_0_18px_-4px_color-mix(in_oklab,var(--primary)_70%,transparent)]',
                'active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              <XIcon className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
              <span className="sr-only">إغلاق</span>
            </DialogPrimitive.Close>
          ) : (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 left-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          ))}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-start", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
