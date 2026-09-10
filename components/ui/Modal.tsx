'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface ModalProps {
  /** Controla la visibilidad del modal (acepta open o isOpen) */
  open?: boolean
  isOpen?: boolean
  /** Callback para cerrar el modal */
  onClose: () => void
  /** Título principal del modal */
  title: string
  /** Subtítulo opcional explicativo */
  subtitle?: string
  /** Contenido del cuerpo del modal */
  children: React.ReactNode
  /** Acciones o botones de pie de página opcionales (fijos abajo) */
  footer?: React.ReactNode
  /** Ancho máximo del modal */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full'
  /** Clases adicionales para el contenedor del diálogo */
  className?: string
  /** Si debe cerrarse al hacer clic en el backdrop oscuro (por defecto: true) */
  closeOnBackdrop?: boolean
}

export function Modal({
  open,
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 'lg',
  className = '',
  closeOnBackdrop = true
}: ModalProps) {
  const [mounted, setMounted] = useState(false)

  // Solo renderizar en cliente para evitar diferencias de hidratación SSR con createPortal
  useEffect(() => {
    setMounted(true)
  }, [])

  const isVisible = open ?? isOpen ?? false

  // Bloqueo del scroll del body y captura de la tecla Escape
  useEffect(() => {
    if (!isVisible) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isVisible, onClose])

  if (!mounted || !isVisible) return null

  const widths: Record<string, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    full: 'max-w-full'
  }

  const modalContent = (
    /* 
      1. Overlay a nivel raíz con overflow-y-auto para pantallas con poca altura.
         Al ser portaleado a document.body, ningún contenedor padre con transform 
         (animate-fadeInUp) puede atrapar el position: fixed.
    */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto animate-fadeIn"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
          onClose()
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* 
        2. Fondo sólido bg-slate-900 (NO glass) con borde y sombra profunda.
           max-h-[90vh] y flex flex-col garantizan que el contenido tenga scroll 
           interno y los botones/títulos queden visibles.
           my-auto previene que el diálogo se corte en pantallas pequeñas.
      */}
      <div
        className={`bg-slate-900 border border-white/10 rounded-3xl w-full ${widths[maxWidth] || 'max-w-lg'} p-6 sm:p-7 shadow-2xl animate-fadeInUp max-h-[90vh] flex flex-col my-auto ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera (Fija / shrink-0) */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/[0.08] shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 font-medium mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3. Cuerpo con scroll interno independiente */}
        <div className="flex-1 overflow-y-auto pr-1">
          {children}
        </div>

        {/* Pie opcional para botones de acción fijos */}
        {footer && (
          <div className="mt-5 pt-3 border-t border-white/[0.06] shrink-0 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

export default Modal
