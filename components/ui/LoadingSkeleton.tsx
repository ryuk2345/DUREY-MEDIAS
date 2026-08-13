'use client'

import React from 'react'

export interface LoadingSkeletonProps {
  rows?: number
  className?: string
}

export function LoadingSkeleton({ rows = 4, className = '' }: LoadingSkeletonProps) {
  return (
    <div className={`space-y-3 animate-pulse p-4 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-slate-800/60 rounded-2xl border border-white/[0.04] w-full" />
      ))}
    </div>
  )
}
