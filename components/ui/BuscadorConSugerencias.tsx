'use client'

/**
 * Buscador con sugerencias al escribir (Fase 7, 1-A). Muestra hasta 8 coincidencias debajo
 * del campo; con flechas y Enter se elige, Escape cierra. Las sugerencias las calcula quien
 * lo usa con `sugerir` / `sugerirProductos` (lib/domain/catalogo.ts).
 */
import { useId, useState } from 'react'
import { Search } from 'lucide-react'
import type { Sugerencia } from '@/lib/domain/catalogo'

type Props = {
  value: string
  onChange: (texto: string) => void
  sugerencias: Sugerencia[]
  /** Al elegir una sugerencia. Por defecto escribe su etiqueta en el campo. */
  onElegir?: (s: Sugerencia) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  inputClassName?: string
}

export default function BuscadorConSugerencias({ value, onChange, sugerencias, onElegir, placeholder, ariaLabel, className = '', inputClassName = '' }: Props) {
  const idLista = useId()
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const visibles = abierto && value.trim() ? sugerencias : []

  const elegir = (s: Sugerencia) => {
    if (onElegir) onElegir(s); else onChange(s.etiqueta)
    setAbierto(false)
  }

  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={visibles.length > 0}
        aria-controls={idLista}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setAbierto(true); setActivo(0) }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={e => {
          if (!visibles.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => (i + 1) % visibles.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(i => (i - 1 + visibles.length) % visibles.length) }
          else if (e.key === 'Enter') { e.preventDefault(); elegir(visibles[Math.min(activo, visibles.length - 1)]) }
          else if (e.key === 'Escape') setAbierto(false)
        }}
        className={`input-dark w-full pl-9 ${inputClassName}`}
      />
      {visibles.length > 0 && (
        <ul id={idLista} role="listbox" aria-label="Sugerencias"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 shadow-xl">
          {visibles.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === activo}
              onMouseDown={e => { e.preventDefault(); elegir(s) }} onMouseEnter={() => setActivo(i)}
              className={`px-3 py-2 cursor-pointer text-xs ${i === activo ? 'bg-cyan-500/15 text-white' : 'text-slate-300'}`}>
              <span className="font-mono font-semibold">{s.etiqueta}</span>
              {s.detalle && <span className="ml-2 text-slate-500">{s.detalle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
