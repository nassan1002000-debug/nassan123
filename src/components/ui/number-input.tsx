'use client'

// NumInput — حقل رقمي بأرقام إنجليزية (لاتينية) دائماً مهما كانت لغة نظام الجهاز
// يستبدل input[type=number] الذي يعرض الأرقام بالأرقام العربية الهندية (٠١٢٣)
// على الأجهزة ذات الواجهة العربية — يقبل لصق الأرقام العربية ويحوّلها لاتينية تلقائياً

import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

/** تطبيع المدخل: أرقام عربية/فارسية → لاتينية، وحذف كل ما عدا الأرقام ونقطة عشرية واحدة */
export function sanitizeNumericInput(raw: string): string {
  const latin = raw
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/٫/g, '.') // الفاصلة العشرية العربية
    .replace(/,/g, '') // فواصل الآلاف عند اللصق
  const cleaned = latin.replace(/[^\d.]/g, '')
  const parts = cleaned.split('.')
  return parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned
}

type NumInputProps = Omit<React.ComponentProps<typeof Input>, 'type' | 'dir'>

export function NumInput({ className, onChange, ...props }: NumInputProps) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      dir="ltr"
      className={cn('num', className)}
      onChange={(e) => {
        const sanitized = sanitizeNumericInput(e.target.value)
        e.target.value = sanitized
        onChange?.(e)
      }}
      {...props}
    />
  )
}
