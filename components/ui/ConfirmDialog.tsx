'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { Button } from './Button'

export interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  isDanger?: boolean
  isLoading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  isDanger = true,
  isLoading = false
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!isOpen || !mounted) return null

  const content = (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-slate-900 rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-white/10 text-center space-y-4">
        <div className={`w-12 h-12 rounded-2xl ${isDanger ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'} border flex items-center justify-center mx-auto text-xl`}>
          {isDanger ? <ShieldAlert className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
        </div>

        <div>
          <h3 className="text-base font-black text-white">{title}</h3>
          <p className="text-xs text-slate-400 leading-relaxed mt-1 font-medium">{description}</p>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={isLoading} className="flex-1">
            {cancelText}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            onClick={onConfirm}
            isLoading={isLoading}
            className="flex-1"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  </div>
)

  return createPortal(content, document.body)
}
