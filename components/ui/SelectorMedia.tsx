'use client'

import React, { useState } from 'react'
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect'
import { filtrarCatalogo, sugerirProductos, ProductoBuscable } from '@/lib/domain/catalogo'
import BuscadorConSugerencias from '@/components/ui/BuscadorConSugerencias'

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
      {/* Fase 7 (1-A): sugerencias al escribir; elegir una selecciona la media (no se sugieren las deshabilitadas) */}
      <BuscadorConSugerencias className="mb-1.5" value={texto} onChange={setTexto} placeholder="Filtrar: modelo, talla, color, SKU..."
        inputClassName="text-xs py-1.5"
        sugerencias={sugerirProductos(items.filter(i => !toOption(i).disabled), texto)}
        onElegir={sg => { const item = items.find(i => i.id === sg.id); if (item) { onChange(valorDe(item)); setTexto('') } }} />
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
