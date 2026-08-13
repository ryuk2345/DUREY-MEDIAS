'use client'

import React from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs))
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-bold tracking-tight rounded-2xl transition-all select-none disabled:opacity-50 disabled:pointer-events-none'
    
    const variants = {
      primary: 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20 border border-cyan-400/30',
      secondary: 'glass text-slate-200 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/[0.08]',
      danger: 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 border border-red-400/30',
      success: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 border border-emerald-400/30',
      ghost: 'bg-transparent text-slate-400 hover:text-white hover:bg-white/10'
    }

    const sizes = {
      sm: 'py-1.5 px-3 text-xs gap-1.5',
      md: 'py-2.5 px-4 text-xs gap-2',
      lg: 'py-3.5 px-6 text-sm gap-2.5 min-h-[48px]' // Tamaño táctil para planta
    }

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
