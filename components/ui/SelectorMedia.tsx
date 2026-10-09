'use client'

import React, { useState } from 'react'
import { Search } from 'lucide-react'
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect'
import { filtrarCatalogo, ProductoBuscable } from '@/lib/domain/catalogo'

// Selector de media del catálogo con buscador encima: al escribir (modelo, talla, color, SKU...)
// la lista solo muestra los productos que coinciden.
export interface SelectorMediaProps<T extends ProductoBuscable & { id: string }> {
  items: T[]
  value: string
  onChange: (value: string) => void
  /** Cómo se muestra cada producto en la lista */
  toOption: (item: T) => SelectOption
  /** Valor que guarda el selector (por defecto el id) */
  valorDe?: (item: T) => string
  /** Opción vacía al inicio de la lista (ej. "Seleccionar media...") */
  emptyOption?: SelectOption
  placeholder?: string
  className?: string
  triggerClassName?: string
}

export function SelectorMedia<T extends ProductoBuscable & { id: string }>({
  items,
  value,
  onChange,
  toOption,
  valorDe = item => item.id,
  emptyOption,
  placeholder = 'Seleccionar media...',
  className,
  triggerClassName
}: SelectorMediaProps<T>) {
  const [texto, setTexto] = useState('')
  const filtrados = filtrarCatalogo(items, texto)
  // La media ya elegida se mantiene en la lista aunque no coincida con el filtro
  const seleccionada = value ? items.find(item => valorDe(item) === value) : undefined
  const visibles = seleccionada && !filtrados.includes(seleccionada) ? [seleccionada, ...filtrados] : filtrados

  const options: SelectOption[] = [
    ...(emptyOption ? [emptyOption] : []),
    ...visibles.map(item => ({ ...toOption(item), value: valorDe(item) }))
  ]

  return (
    <div className={className}>
      <div className="relative mb-1.5">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Filtrar: modelo, talla, color, SKU..."
          className="input-dark text-xs w-full py-1.5 pl-8"
        />
      </div>
      <CustomSelect
        value={value}
        onChange={onChange}
        options={options}
        triggerClassName={triggerClassName}
        placeholder={texto && filtrados.length === 0 ? 'Sin resultados para ese filtro' : `${placeholder} (${filtrados.length})`}
      />
    </div>
  )
}

export default SelectorMedia
