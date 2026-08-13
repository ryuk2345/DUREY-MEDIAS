'use client'

import React from 'react'
import { PackageSearch } from 'lucide-react'
import { Button } from './Button'

export interface EmptyStateProps {
  title: string
  description?: string
  icon?: React.ReactNode
  actionText?: string
  onAction?: () => void
}

export function EmptyState({
  title,
  description,
  icon,
  actionText,
  onAction
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center glass rounded-3xl border border-white/[0.08] space-y-3">
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] text-slate-400">
        {icon || <PackageSearch className="w-8 h-8 text-cyan-400" />}
      </div>
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
        {description && <p className="text-xs text-slate-400 max-w-sm mt-0.5 font-medium">{description}</p>}
      </div>
      {actionText && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction} className="mt-2">
          {actionText}
        </Button>
      )}
    </div>
  )
}
