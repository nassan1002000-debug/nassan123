'use client'

// قائمة اختيار الحساب البحثية (Combobox) — Popover + Command
// وتحويل شجرة دليل الحسابات إلى قائمة مسطّحة مرتبة بالكود مع إزاحة بصرية حسب المستوى

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { AR_ACCOUNT_TYPE } from '@/lib/format'
import type { FlatAccount } from './types'

/** عقدة حساب كما ترجعها /api/accounts (مصفوفة flat بـ parentId) أو شجرة بـ children */
export type AccountApiNode = {
  id: string
  code: string
  name: string
  type: string
  isActive?: boolean
  parentId?: string | null
  children?: AccountApiNode[]
}

/** تجميع الشجرة (إن وردت) إلى قائمة flat مع ربط الأب تلقائياً */
function collectAndLink(nodes: AccountApiNode[], parentId: string | null, out: AccountApiNode[]): void {
  for (const n of nodes ?? []) {
    out.push({ ...n, parentId: n.parentId ?? parentId })
    if (Array.isArray(n.children) && n.children.length > 0) collectAndLink(n.children, n.id, out)
  }
}

/** تحويل دليل الحسابات (flat أو شجرة) إلى قائمة مسطّحة مرتبة بالكود مع مستوى الإزاحة والمسار الكامل */
export function flattenAccounts(nodes: AccountApiNode[] | null | undefined): FlatAccount[] {
  const list: AccountApiNode[] = []
  collectAndLink(nodes ?? [], null, list)
  const byId = new Map(list.map((n) => [n.id, n]))

  // سلسلة الآباء — بحماية من الحلقات (أب يشير لذمه)
  const chainOf = (n: AccountApiNode): AccountApiNode[] => {
    const chain: AccountApiNode[] = []
    const seen = new Set<string>([n.id])
    let cur: AccountApiNode | undefined = n
    while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      seen.add(cur.parentId)
      cur = byId.get(cur.parentId)
      if (cur) chain.unshift(cur)
    }
    return chain
  }

  const out: FlatAccount[] = list.map((n) => {
    const chain = chainOf(n)
    const path = [...chain.map((p) => p.name), n.name]
    return {
      id: n.id,
      code: n.code,
      name: n.name,
      type: n.type,
      isActive: n.isActive !== false,
      level: Math.min(chain.length, 4),
      label: path.length > 1 ? path.join(' › ') : n.name,
    }
  })
  return out.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
}

interface AccountComboboxProps {
  accounts: FlatAccount[]
  value: string | null
  onChange: (accountId: string) => void
  disabled?: boolean
  loading?: boolean
  className?: string
}

export function AccountCombobox({
  accounts,
  value,
  onChange,
  disabled,
  loading,
  className,
}: AccountComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = accounts.find((a) => a.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q),
    )
  }, [accounts, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn(
            'h-9 w-full justify-between gap-1 font-normal',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          {loading ? (
            <span className="flex items-center gap-2 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              جاري تحميل الحسابات…
            </span>
          ) : selected ? (
            <span className="truncate">
              <span className="num text-muted-foreground">{selected.code}</span>
              {' — '}
              {selected.name}
            </span>
          ) : (
            <span>اختر الحساب…</span>
          )}
          <ChevronsUpDown className="ms-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ابحث بالكود أو اسم الحساب…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>لا توجد حسابات مطابقة للبحث</CommandEmpty>
            <CommandGroup>
              {filtered.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.code} ${a.name}`}
                  onSelect={() => {
                    onChange(a.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0 text-primary',
                      a.id === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="num shrink-0 text-xs text-muted-foreground">{a.code}</span>
                  <span className="min-w-0 truncate">
                    {a.level > 0 && (
                      <span className="text-muted-foreground">{'— '.repeat(Math.min(a.level, 4))}</span>
                    )}
                    {a.name}
                  </span>
                  <span className="ms-auto shrink-0 text-[10px] text-muted-foreground">
                    {AR_ACCOUNT_TYPE[a.type] ?? ''}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
