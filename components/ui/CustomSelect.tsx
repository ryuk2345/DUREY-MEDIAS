'use client'

import React from 'react'
import * as RadixSelect from '@radix-ui/react-select'
import { ChevronDown, Check, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs))
}

export interface SelectOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
  description?: string
}

export interface CustomSelectProps {
  value?: string
  onChange?: (value: string) => void
  onValueChange?: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  contentClassName?: string
  icon?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  name?: string
  id?: string
  'aria-label'?: string
}

const EMPTY_VALUE_KEY = '__CUSTOM_SELECT_EMPTY__'

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value = '',
  onChange,
  onValueChange,
  options = [],
  placeholder = 'Seleccionar...',
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  icon,
  size = 'md',
  name,
  id,
  'aria-label': ariaLabel
}) => {
  const handleValueChange = (val: string) => {
    const actualVal = val === EMPTY_VALUE_KEY ? '' : val
    if (onChange) onChange(actualVal)
    if (onValueChange) onValueChange(actualVal)
  }

  // Mapear valor para que Radix no reciba string vacío en RadixSelect.Item
  const radixValue = value === '' ? EMPTY_VALUE_KEY : value

  const sizes = {
    sm: 'py-1.5 px-3 text-xs gap-1.5 rounded-xl',
    md: 'py-2 px-3 text-xs gap-2 rounded-xl',
    lg: 'py-2.5 px-4 text-sm gap-2.5 rounded-2xl min-h-[44px]'
  }

  return (
    <div className={cn('relative w-full', className)}>
      <RadixSelect.Root
        value={radixValue}
        onValueChange={handleValueChange}
        disabled={disabled}
        name={name}
      >
        <RadixSelect.Trigger
          id={id}
          aria-label={ariaLabel}
          className={cn(
            'flex items-center justify-between w-full bg-slate-900/90 text-white border border-white/10 font-medium transition-all outline-none cursor-pointer select-none',
            'hover:border-white/20 hover:bg-slate-900 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            sizes[size],
            triggerClassName
          )}
        >
          <div className="flex items-center gap-2 truncate text-left flex-1 min-w-0">
            {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
            <RadixSelect.Value placeholder={<span className="text-slate-500 font-normal">{placeholder}</span>} />
          </div>
          <RadixSelect.Icon asChild>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2 opacity-70 transition-transform duration-200" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className={cn(
              'z-[9999] min-w-[var(--radix-select-trigger-width)] max-w-[95vw] max-h-72 overflow-hidden rounded-2xl bg-slate-950/95 backdrop-blur-xl border border-white/15 shadow-2xl animate-in fade-in-0 zoom-in-95',
              contentClassName
            )}
          >
            <RadixSelect.ScrollUpButton className="flex items-center justify-center h-6 bg-slate-900 text-slate-400 cursor-default">
              <ChevronUp className="w-3.5 h-3.5" />
            </RadixSelect.ScrollUpButton>

            <RadixSelect.Viewport className="p-1.5 space-y-0.5">
              {options.map((opt, idx) => {
                const optVal = opt.value === '' ? EMPTY_VALUE_KEY : opt.value

                return (
                  <RadixSelect.Item
                    key={`${optVal}-${idx}`}
                    value={optVal}
                    disabled={opt.disabled}
                    className={cn(
                      'relative flex items-center justify-between px-3 py-2 text-xs font-medium rounded-xl select-none outline-none cursor-pointer transition-colors',
                      'text-slate-200 data-[highlighted]:bg-slate-800/90 data-[highlighted]:text-white',
                      'data-[state=checked]:bg-cyan-500/15 data-[state=checked]:text-cyan-300 data-[state=checked]:font-bold',
                      'data-[disabled]:opacity-40 data-[disabled]:pointer-events-none data-[disabled]:text-slate-500'
                    )}
                  >
                    <div className="flex flex-col flex-1 pr-2 truncate">
                      <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                      {opt.description && (
                        <span className="text-[10px] text-slate-400 font-normal mt-0.5">{opt.description}</span>
                      )}
                    </div>
                    <RadixSelect.ItemIndicator className="shrink-0 ml-2 text-cyan-400">
                      <Check className="w-3.5 h-3.5" />
                    </RadixSelect.ItemIndicator>
                  </RadixSelect.Item>
                )
              })}
            </RadixSelect.Viewport>

            <RadixSelect.ScrollDownButton className="flex items-center justify-center h-6 bg-slate-900 text-slate-400 cursor-default">
              <ChevronDown className="w-3.5 h-3.5" />
            </RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  )
}

export default CustomSelect
