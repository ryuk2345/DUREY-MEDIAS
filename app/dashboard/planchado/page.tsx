// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Wind, Plus, Calendar, CheckCircle2, Loader2, X, User, Printer,
  Sparkles, Trash2, Edit3, FileText, CheckSquare, Shirt, Save, Layers,
  ChevronLeft, ChevronRight, Copy
} from 'lucide-react'
import { toast } from 'sonner'
import { getSemanaAnio, getDiaSemana } from '@/lib/utils'

interface Planchador { id: string; nombre: string }
interface StockPlanchar {
  id: string
  docenas: number
  catalogo_media_id: string
  catalogo_media: { id: string; codigo: string; talla: string; publico: string }
}
interface Cronograma {
  id: string
  semana: number
  anio: number
  dia_semana: string
  criterio: string // 'talla', 'publico', 'media'
  valor_criterio: string
  planchador_id: string
  planchador?: { nombre: string }
}
interface CatalogoMedia { id: string; codigo: string; talla: string; publico: string }

interface MediaItemParaPlanchar {
  catalogo_media_id: string
  codigo: string
  stockDisponible: number
  keyId: string
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

export default function PlanchadoPage() {
  const [planchadores, setPlanchadores] = useState<Planchador[]>([])
  const [stock, setStock] = useState<StockPlanchar[]>([])
  const [cronograma, setCronograma] = useState<Cronograma[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Semana y año actual del calendario
  const { semana: semanaHoy, anio: anioHoy } = getSemanaAnio()

  // Estado de la semana y año seleccionados para ver / programar
  const [semanaSeleccionada, setSemanaSeleccionada] = useState<number>(semanaHoy)
  const [anioSeleccionado, setAnioSeleccionado] = useState<number>(anioHoy)

  // Estado del día activo para registro diario
  const [diaSeleccionado, setDiaSeleccionado] = useState<string>(getDiaSemana())

  // Modal para agregar/editar asignación en celda
  const [showCronoModal, setShowCronoModal] = useState(false)

  // Formulario de asignación a celda
  const [cronoForm, setCronoForm] = useState({
    id: null as string | null,
    planchador_id: '',
    dia_semana: 'lunes',
    criterio: 'media',
    valor_criterio: ''
  })

  // Estado de inputs para TODOS los planchadores en el día seleccionado
  const [produccionMasiva, setProduccionMasiva] = useState<Record<string, { planchadas: string; defectuosas: string }>>({})

  // Selección manual de media por planchador en caso de no tener asignación
  const [mediaManualPorPlanchador, setMediaManualPorPlanchador] = useState<Record<string, string>>({})

  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [st, cr, cat] = await Promise.all([
      supabase.from('stock_listo_planchar')
        .select('id, docenas, catalogo_media_id, catalogo_media:catalogo_medias(id, codigo, talla, publico)')
        .gt('docenas', 0),
      supabase.from('cronograma_planchado')
        .select('id, semana, anio, dia_semana, criterio, valor_criterio, planchador_id, planchador:usuarios(nombre)')
        .eq('semana', semanaSeleccionada).eq('anio', anioSeleccionado),
      supabase.from('catalogo_medias').select('id, codigo, talla, publico').eq('estado', 'activo').order('codigo'),
    ])

    if (st.error) toast.error(`Error al cargar stock listo para planchar: ${st.error.message}`)
    if (cr.error) toast.error(`Error al cargar cronograma: ${cr.error.message}`)
    if (cat.error) toast.error(`Error al cargar catálogo de medias: ${cat.error.message}`)

    const hoy = new Date().toISOString().split('T')[0]
    const { data: asigData, error: asigErr } = await supabase
      .from('asignaciones_turno')
      .select('operador_id, operador:usuarios(id, nombre)')
      .eq('area', 'planchado')
      .eq('fecha', hoy)

    let planchadoresList = []
    if (asigErr) {
      toast.error(`Error al cargar asignaciones de turno: ${asigErr.message}`)
    } else if (asigData && asigData.length > 0) {
      planchadoresList = asigData.map((a: any) => a.operador).filter(Boolean)
    } else {
      const { data: usersData, error: usersErr } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .in('rol', ['operador', 'planchador'])
        .eq('activo', true)
        .order('nombre')
      if (usersErr) {
        toast.error(`Error al cargar operarios: ${usersErr.message}`)
      } else if (usersData) {
        planchadoresList = usersData
      }
    }

    setPlanchadores(planchadoresList)
    setStock((st.data ?? []) as StockPlanchar[])
    setCronograma((cr.data ?? []) as Cronograma[])
    setCatalogo((cat.data ?? []) as CatalogoMedia[])
    setLoading(false)
  }, [semanaSeleccionada, anioSeleccionado, supabase])


  useEffect(() => { cargarDatos() }, [cargarDatos])

  // ── NAVEGACIÓN DE SEMANAS ──────────────────────────────────────────────────
  const irASemanaAnterior = () => {
    if (semanaSeleccionada === 1) {
      setSemanaSeleccionada(52)
      setAnioSeleccionado(a => a - 1)
    } else {
      setSemanaSeleccionada(s => s - 1)
    }
  }

  const irASemanaSiguiente = () => {
    if (semanaSeleccionada === 52) {
      setSemanaSeleccionada(1)
      setAnioSeleccionado(a => a + 1)
    } else {
      setSemanaSeleccionada(s => s + 1)
    }
  }

  const irASemanaActual = () => {
    setSemanaSeleccionada(semanaHoy)
    setAnioSeleccionado(anioHoy)
  }

  // ── COPIAR CRONOGRAMA COMPLETO A LA SIGUIENTE SEMANA ──────────────────────
  const copiarCronogramaASiguienteSemana = async () => {
    if (cronograma.length === 0) {
      toast.error('No hay asignaciones en la semana actual para copiar')
      return
    }

    const proxSemana = semanaSeleccionada === 52 ? 1 : semanaSeleccionada + 1
    const proxAnio = semanaSeleccionada === 52 ? anioSeleccionado + 1 : anioSeleccionado

    if (!confirm(`¿Copiar las ${cronograma.length} asignaciones de la Semana N° ${semanaSeleccionada} a la Semana N° ${proxSemana} (${proxAnio})?`)) return

    const nuevasAsignaciones = cronograma.map(c => ({
      semana: proxSemana,
      anio: proxAnio,
      planchador_id: c.planchador_id,
      dia_semana: c.dia_semana,
      criterio: c.criterio,
      valor_criterio: c.valor_criterio,
    }))

    const { error } = await supabase.from('cronograma_planchado').insert(nuevasAsignaciones)

    if (error) {
      toast.error('Error al copiar el cronograma a la siguiente semana')
      return
    }

    toast.success(`🎉 Cronograma duplicado exitosamente para la Semana N° ${proxSemana} / ${proxAnio}`)
    setSemanaSeleccionada(proxSemana)
    setAnioSeleccionado(proxAnio)
  }

  // ── OBTENER MEDIAS INDEPENDIENTES PARA CADA PLANCHADOR EN EL DÍA SELECCIONADO ──
  const planchadoresMediasMap = useMemo(() => {
    const map = new Map<string, {
      planchador: Planchador
      asignaciones: Cronograma[]
      mediasParaPlanchar: MediaItemParaPlanchar[]
    }>()

    planchadores.forEach(p => {
      const asigList = cronograma.filter(c =>
        c.planchador_id === p.id && c.dia_semana.toLowerCase() === diaSeleccionado.toLowerCase()
      )

      const itemsMap = new Map<string, MediaItemParaPlanchar>()

      // 1. Convertir asignaciones del cronograma a items para planchar
      asigList.forEach(a => {
        if (a.criterio === 'media') {
          const catItem = catalogo.find(c => c.codigo === a.valor_criterio || c.id === a.valor_criterio)
          const mediaId = catItem?.id || a.valor_criterio
          const mediaCodigo = catItem?.codigo || a.valor_criterio
          const stockRef = stock.find(s => s.catalogo_media_id === mediaId || s.catalogo_media?.codigo === mediaCodigo)

          itemsMap.set(mediaId, {
            catalogo_media_id: mediaId,
            codigo: mediaCodigo,
            stockDisponible: stockRef?.docenas || 0,
            keyId: mediaId
          })
        } else if (a.criterio === 'talla') {
          const coinc = catalogo.filter(c => c.talla?.toLowerCase() === a.valor_criterio.toLowerCase())
          coinc.forEach(c => {
            const stockRef = stock.find(s => s.catalogo_media_id === c.id)
            itemsMap.set(c.id, {
              catalogo_media_id: c.id,
              codigo: c.codigo,
              stockDisponible: stockRef?.docenas || 0,
              keyId: c.id
            })
          })
        } else if (a.criterio === 'publico') {
          const coinc = catalogo.filter(c => c.publico?.toLowerCase() === a.valor_criterio.toLowerCase())
          coinc.forEach(c => {
            const stockRef = stock.find(s => s.catalogo_media_id === c.id)
            itemsMap.set(c.id, {
              catalogo_media_id: c.id,
              codigo: c.codigo,
              stockDisponible: stockRef?.docenas || 0,
              keyId: c.id
            })
          })
        }
      })

      // 2. Si se seleccionó una media manual en la tarjeta
      const mediaManualId = mediaManualPorPlanchador[p.id]
      if (mediaManualId) {
        const catItem = catalogo.find(c => c.id === mediaManualId)
        if (catItem && !itemsMap.has(catItem.id)) {
          const stockRef = stock.find(s => s.catalogo_media_id === catItem.id)
          itemsMap.set(catItem.id, {
            catalogo_media_id: catItem.id,
            codigo: catItem.codigo,
            stockDisponible: stockRef?.docenas || 0,
            keyId: catItem.id
          })
        }
      }

      map.set(p.id, {
        planchador: p,
        asignaciones: asigList,
        mediasParaPlanchar: Array.from(itemsMap.values())
      })
    })

    return map
  }, [planchadores, cronograma, stock, catalogo, diaSeleccionado, mediaManualPorPlanchador])

  // Manejo de cambio en los inputs de producción masiva
  const handleProduccionInput = (planchadorId: string, keyId: string, field: 'planchadas' | 'defectuosas', value: string) => {
    const key = `${planchadorId}__${keyId}`
    setProduccionMasiva(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }))
  }

  // ── GUARDAR REGISTRO CONSOLIDADO DIARIO ───────────────────────────────────
  const guardarProduccionMasivaDiaria = async () => {
    setSaving(true)
    const fechaHoy = new Date().toISOString().split('T')[0]
    const itemsToInsert: any[] = []
    const stockToUpdate = new Map<string, number>()

    planchadores.forEach(p => {
      const info = planchadoresMediasMap.get(p.id)
      if (!info) return

      info.mediasParaPlanchar.forEach(m => {
        const key = `${p.id}__${m.keyId}`
        const entry = produccionMasiva[key]
        if (entry) {
          const planchadas = parseFloat(entry.planchadas || '0') || 0
          const defectuosas = parseFloat(entry.defectuosas || '0') || 0

          if (planchadas > 0 || defectuosas > 0) {
            itemsToInsert.push({
              planchador_id: p.id,
              catalogo_media_id: m.catalogo_media_id,
              docenas_planchadas: planchadas,
              docenas_defectuosas: defectuosas,
              fecha: fechaHoy,
            })

            const total = planchadas + defectuosas
            const currentSub = stockToUpdate.get(m.catalogo_media_id) || 0
            stockToUpdate.set(m.catalogo_media_id, currentSub + total)
          }
        }
      })
    })

    if (itemsToInsert.length === 0) {
      toast.error('Ingresa al menos una docena planchada o defectuosa para guardar')
      setSaving(false)
      return
    }

    const { error: rErr } = await supabase.from('reportes_planchado').insert(itemsToInsert)

    if (rErr) {
      toast.error('Error al guardar los reportes de producción')
      setSaving(false)
      return
    }

    for (const [mediaId, cantDescontar] of stockToUpdate.entries()) {
      const itemStock = stock.find(s => s.catalogo_media_id === mediaId)
      if (itemStock) {
        await supabase.from('stock_listo_planchar')
          .update({ docenas: Math.max(0, itemStock.docenas - cantDescontar) })
          .eq('id', itemStock.id)
      }
    }

    toast.success(`🎉 Producción del día ${diaSeleccionado.toUpperCase()} guardada exitosamente.`)
    setProduccionMasiva({})
    setSaving(false)
    cargarDatos()
  }

  // ── MANEJO DE ASIGNACIÓN INTERACTIVA DE CELDA EN GRILLA ───────────────────
  const abrirModalAsignacionCelda = (planchadorId: string, dia: string, asignacionExistente?: Cronograma) => {
    if (asignacionExistente) {
      setCronoForm({
        id: asignacionExistente.id,
        planchador_id: planchadorId,
        dia_semana: dia,
        criterio: asignacionExistente.criterio || 'media',
        valor_criterio: asignacionExistente.valor_criterio
      })
    } else {
      setCronoForm({
        id: null,
        planchador_id: planchadorId,
        dia_semana: dia,
        criterio: 'media',
        valor_criterio: catalogo[0]?.codigo || ''
      })
    }
    setShowCronoModal(true)
  }

  const guardarAsignacion = async () => {
    if (!cronoForm.planchador_id || !cronoForm.valor_criterio) {
      toast.error('Selecciona el planchador y el tipo de media / criterio')
      return
    }

    if (cronoForm.id) {
      const { error } = await supabase.from('cronograma_planchado')
        .update({
          criterio: cronoForm.criterio,
          valor_criterio: cronoForm.valor_criterio,
        })
        .eq('id', cronoForm.id)

      if (error) { toast.error('Error al actualizar asignación: ' + (error.message || JSON.stringify(error))); return }
      toast.success('✅ Asignación actualizada en el cronograma')
    } else {
      const { error } = await supabase.from('cronograma_planchado').insert({
        semana: semanaSeleccionada,
        anio: anioSeleccionado,
        planchador_id: cronoForm.planchador_id,
        dia_semana: cronoForm.dia_semana,
        criterio: cronoForm.criterio,
        valor_criterio: cronoForm.valor_criterio,
      })

      if (error) { toast.error('Error al guardar asignación: ' + (error.message || JSON.stringify(error))); return }
      toast.success('✅ Nueva asignación agregada al cronograma')
    }


    setShowCronoModal(false)
    cargarDatos()
  }

  const eliminarAsignacion = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('¿Eliminar esta asignación del cronograma?')) return

    const { error } = await supabase.from('cronograma_planchado').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar asignación'); return }
    toast.success('Asignación removida del cronograma')
    cargarDatos()
  }

  // ── IMPRESIÓN DEL CRONOGRAMA SEMANAL COMPLETO ────────────────────────────
  const imprimirCronogramaSemanal = () => {
    const contenidoFilas = planchadores.map(p => {
      const celdas = DIAS.map(d => {
        const asigList = cronograma.filter(c => c.planchador_id === p.id && c.dia_semana.toLowerCase() === d)
        const texto = asigList.length > 0
          ? asigList.map(a => `<div style="font-weight:bold;color:#1e293b;padding:2px 0">${a.valor_criterio}</div>`).join('')
          : '<span style="color:#cbd5e1">—</span>'
        return `<td style="border:1px solid #cbd5e1;padding:8px;text-align:center;font-size:12px;background:#f8fafc">${texto}</td>`
      }).join('')
      return `<tr><td style="border:1px solid #cbd5e1;padding:8px;font-weight:bold;background:#e2e8f0;font-size:12px">${p.nombre}</td>${celdas}</tr>`
    }).join('')

    const html = `
      <html>
        <head>
          <title>Cronograma Semanal Planchado — Semana ${semanaSeleccionada}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #0f172a; }
            h2 { margin-bottom: 4px; font-size: 20px; color: #1e3a8a; }
            p { margin-top: 0; color: #64748b; font-size: 13px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { background: #1e293b; color: white; border: 1px solid #0f172a; padding: 10px; font-size: 12px; text-transform: uppercase; }
            .footer { margin-top: 30px; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }
          </style>
        </head>
        <body>
          <h2>FÁBRICA DE MEDIAS DUREY — Programación de Planchado</h2>
          <p>Cronograma Rotativo Semanal · Semana N° ${semanaSeleccionada} / Año ${anioSeleccionado}</p>
          <table>
            <thead>
              <tr>
                <th>Planchador</th>
                ${DIAS.map(d => `<th style="text-transform:capitalize">${d}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${contenidoFilas}
            </tbody>
          </table>
          <div class="footer">
            <span>Fecha de emisión: ${new Date().toLocaleDateString('es-PE')}</span>
            <span>Firma Supervisor: ________________________</span>
          </div>
        </body>
      </html>`

    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.print()
    }
  }

  // ── IMPRESIÓN DE HOJA DE CONTROL FÍSICO POR DÍA ───────────────────────────
  const imprimirHojaControlDia = () => {
    const diaCapitalizado = diaSeleccionado.charAt(0).toUpperCase() + diaSeleccionado.slice(1)

    const contenidoFilas = planchadores.map(p => {
      const asigList = cronograma.filter(c => c.planchador_id === p.id && c.dia_semana.toLowerCase() === diaSeleccionado.toLowerCase())
      const asignacionTexto = asigList.length > 0
        ? asigList.map(a => a.valor_criterio).join(', ')
        : 'Sin asignación'

      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:10px;font-weight:bold;font-size:12px">${p.nombre}</td>
          <td style="border:1px solid #cbd5e1;padding:10px;font-size:12px;font-family:monospace">${asignacionTexto}</td>
          <td style="border:1px solid #cbd5e1;padding:10px;text-align:center;width:120px"></td>
          <td style="border:1px solid #cbd5e1;padding:10px;text-align:center;width:120px"></td>
          <td style="border:1px solid #cbd5e1;padding:10px;text-align:center;width:150px"></td>
        </tr>`
    }).join('')

    const html = `
      <html>
        <head>
          <title>Hoja de Control Diario Planchado — ${diaCapitalizado}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #0f172a; }
            .header-box { border-bottom: 2px solid #ef4444; padding-bottom: 10px; margin-bottom: 20px; }
            h2 { margin: 0; font-size: 18px; color: #b91c1c; }
            p { margin: 4px 0 0 0; color: #64748b; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; padding: 10px; font-size: 11px; text-transform: uppercase; }
            .notes { margin-top: 40px; font-size: 11px; color: #64748b; border: 1px dashed #cbd5e1; padding: 12px; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div class="header-box">
            <h2>DUREY — Planilla de Control Físico de Planchado</h2>
            <p>Día: <strong>${diaCapitalizado}</strong> · Semana N° ${semanaSeleccionada} / ${anioSeleccionado} · Fecha de Registro: ____ / ____ / ________</p>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:200px">Planchador</th>
                <th>Criterio / Media Asignada</th>
                <th>Doc. Planchadas</th>
                <th>Doc. Defectuosas</th>
                <th>Firma Operario</th>
              </tr>
            </thead>
            <tbody>
              ${contenidoFilas}
            </tbody>
          </table>
          <div class="notes">
            <strong>Instrucciones para el Operario:</strong> Anotar en números legibles las docenas terminadas y las mermas al finalizar el turno. Entregar firmado al supervisor de planta.
          </div>
        </body>
      </html>`

    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.print()
    }
  }

  const isSemanaActual = semanaSeleccionada === semanaHoy && anioSeleccionado === anioHoy

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER SUPERIOR ─────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
            <Wind className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Área de Planchado</h1>
            <p className="text-slate-400 text-xs font-medium">Programación semanal rotativa por tipo de media y registro diario por planchador</p>
          </div>
        </div>

        {/* Botones de Impresión */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button onClick={imprimirCronogramaSemanal} className="btn-secondary text-xs py-2 rounded-2xl">
            <Printer className="w-4 h-4 text-red-400" /> Imprimir Cronograma Semanal
          </button>
          <button onClick={imprimirHojaControlDia} className="btn-secondary text-xs py-2 rounded-2xl border-red-500/30 text-red-300 hover:text-white">
            <FileText className="w-4 h-4 text-red-400" /> Imprimir Control Diario
          </button>
        </div>
      </div>

      {/* ── CONTROL NAVEGADOR DE SEMANAS Y PROGRAMACIÓN ANTICIPADA ───────────── */}
      <div className="glass rounded-3xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-white/[0.08]">
        {/* Selector de Semana con botones ◀ y ▶ */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-2xl border border-white/[0.08]">
            <button
              onClick={irASemanaAnterior}
              className="p-1.5 rounded-xl hover:bg-white/10 text-slate-300 transition-colors"
              title="Semana anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono font-bold text-white text-xs px-3">
              Semana N° {semanaSeleccionada} · {anioSeleccionado}
            </span>
            <button
              onClick={irASemanaSiguiente}
              className="p-1.5 rounded-xl hover:bg-white/10 text-slate-300 transition-colors"
              title="Semana siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {!isSemanaActual && (
            <button
              onClick={irASemanaActual}
              className="text-[11px] font-bold text-red-400 hover:underline px-2"
            >
              Ir a Semana Actual ({semanaHoy})
            </button>
          )}

          {isSemanaActual ? (
            <span className="badge badge-success text-[10px]">● Semana Actual</span>
          ) : semanaSeleccionada > semanaHoy ? (
            <span className="badge badge-info text-[10px]">📅 Programación Anticipada</span>
          ) : (
            <span className="badge badge-neutral text-[10px]">Histórico</span>
          )}
        </div>

        {/* Duplicador rápido de Cronograma a la siguiente semana */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <button
            onClick={copiarCronogramaASiguienteSemana}
            className="btn-secondary text-xs py-2 px-3 rounded-2xl border-white/10 hover:border-red-500/30 text-slate-300 hover:text-white"
            title="Copiar las asignaciones de esta semana a la próxima semana"
          >
            <Copy className="w-3.5 h-3.5 text-red-400" />
            Copiar a la Próxima Semana (Sem. {semanaSeleccionada === 52 ? 1 : semanaSeleccionada + 1})
          </button>

          <div className="flex items-center gap-2 bg-slate-900/60 p-1.5 rounded-2xl border border-white/[0.06] text-xs">
            <span className="text-slate-400 font-semibold px-2">Día:</span>
            <select
              value={diaSeleccionado}
              onChange={e => setDiaSeleccionado(e.target.value)}
              className="bg-transparent text-white font-black capitalize focus:outline-none cursor-pointer py-1 pr-2"
            >
              {DIAS.map(d => (
                <option key={d} value={d} className="bg-slate-900 text-white capitalize">{d}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── MATRIZ / GRILLA INTERACTIVA DEL CRONOGRAMA SEMANAL ────────────────── */}
      <div className="glass rounded-3xl overflow-hidden border border-white/[0.08]">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">
              Cronograma Semanal Rotativo — Semana N° {semanaSeleccionada}
            </h2>
            <p className="text-xs text-slate-400">
              Programación anticipada: Haz clic en cualquier celda para asignar qué tipo de media planchará cada trabajador cada día
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-red-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark min-w-max">
              <thead>
                <tr>
                  <th className="w-48">Planchador</th>
                  {DIAS.map(d => (
                    <th key={d} className={`capitalize text-center ${d === diaSeleccionado ? 'text-red-400 bg-red-500/10 font-black' : ''}`}>
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planchadores.length === 0 ? (
                  <tr><td colSpan={DIAS.length + 1} className="text-center py-8 text-slate-500">No hay planchadores registrados en el sistema</td></tr>
                ) : planchadores.map(p => (
                  <tr key={p.id}>
                    <td className="font-bold text-white py-4">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-slate-400" />
                        <span>{p.nombre}</span>
                      </div>
                    </td>

                    {/* Celdas interactivas por día */}
                    {DIAS.map(d => {
                      const asigList = cronograma.filter(c => c.planchador_id === p.id && c.dia_semana.toLowerCase() === d)
                      const isSelectedDay = d === diaSeleccionado

                      return (
                        <td
                          key={d}
                          onClick={() => abrirModalAsignacionCelda(p.id, d, asigList[0])}
                          className={`cursor-pointer hover:bg-white/[0.04] transition-all p-3 text-center ${
                            isSelectedDay ? 'bg-red-500/[0.04]' : ''
                          }`}
                        >
                          {asigList.length > 0 ? (
                            <div className="space-y-1">
                              {asigList.map(a => (
                                <div
                                  key={a.id}
                                  className="inline-flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-xl bg-red-500/20 text-red-200 border border-red-500/30 text-[11px] font-bold shadow-sm hover:bg-red-500/30 w-full"
                                >
                                  <span className="truncate max-w-[120px] font-mono">{a.valor_criterio}</span>
                                  <button
                                    onClick={e => eliminarAsignacion(a.id, e)}
                                    className="text-slate-400 hover:text-red-400 p-0.5 rounded"
                                    title="Quitar asignación"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="group flex items-center justify-center text-slate-700 hover:text-red-400 text-xs font-semibold py-1">
                              <Plus className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100" />
                              <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-100">Asignar</span>
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── REGISTRO SIMULTÁNEO DE PRODUCCIÓN DIARIA PARA TODOS LOS PLANCHADORES ── */}
      <div className="glass rounded-3xl p-6 border border-red-500/20 shadow-xl bg-red-500/[0.01]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-red-400" />
              <h2 className="text-lg font-bold text-white">
                Registro de Producción Diaria — Día <span className="capitalize text-red-400">{diaSeleccionado}</span> (Semana N° {semanaSeleccionada})
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Ingresa las docenas planchadas y mermas de cada trabajador para el día {diaSeleccionado}.
            </p>
          </div>

          <button
            onClick={guardarProduccionMasivaDiaria}
            disabled={saving || planchadores.length === 0}
            className="btn-primary text-xs py-2.5 px-6 font-bold bg-red-600 hover:bg-red-500 text-white rounded-xl shadow-lg shadow-red-600/20 border-none disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar Registro Diario ({diaSeleccionado.toUpperCase()})
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-red-400" /></div>
        ) : planchadores.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No hay planchadores registrados
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {planchadores.map(p => {
              const info = planchadoresMediasMap.get(p.id)
              const asignaciones = info?.asignaciones || []
              const mediasParaPlanchar = info?.mediasParaPlanchar || []

              return (
                <div
                  key={p.id}
                  className="glass rounded-2xl p-5 border border-white/[0.08] hover:border-red-500/30 transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Header del Planchador */}
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-red-500/20 text-red-300 font-bold flex items-center justify-center text-xs">
                          {p.nombre.charAt(0).toUpperCase()}
                        </div>
                        <p className="font-bold text-white text-sm">{p.nombre}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 capitalize font-medium">
                        {diaSeleccionado} (Sem. {semanaSeleccionada})
                      </span>
                    </div>

                    {/* Asignación de la grilla superior para este día */}
                    <div className="mb-3">
                      <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">
                        Criterio / Media Asignada:
                      </p>
                      {asignaciones.length === 0 ? (
                        <span className="text-slate-600 text-xs italic">Sin asignación en la grilla</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {asignaciones.map(a => (
                            <span key={a.id} className="badge badge-danger text-[10px] font-mono">
                              {a.valor_criterio}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Selector rápido si se quiere agregar una media adicional */}
                    <div className="mb-3">
                      <select
                        value={mediaManualPorPlanchador[p.id] || ''}
                        onChange={e => setMediaManualPorPlanchador(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="input-dark text-[11px] py-1.5 w-full font-mono text-slate-300"
                      >
                        <option value="">+ Añadir/Seleccionar media del catálogo...</option>
                        {catalogo.map(c => (
                          <option key={c.id} value={c.id}>{c.codigo}</option>
                        ))}
                      </select>
                    </div>

                    {/* Inputs de producción directos por cada media para planchar */}
                    {mediasParaPlanchar.length === 0 ? (
                      <div className="p-3 rounded-xl bg-white/[0.02] border border-dashed border-white/10 text-center text-slate-500 text-[11px]">
                        Selecciona un tipo de media arriba para registrar producción
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {mediasParaPlanchar.map(m => {
                          const inputKey = `${p.id}__${m.keyId}`
                          const entry = produccionMasiva[inputKey] || { planchadas: '', defectuosas: '' }

                          return (
                            <div key={m.keyId} className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.06]">
                              <div className="flex items-center justify-between mb-2">
                                <p className="font-mono text-xs font-bold text-white truncate max-w-[170px]">
                                  {m.codigo}
                                </p>
                                {m.stockDisponible > 0 ? (
                                  <span className="text-[10px] text-emerald-400 font-semibold">{m.stockDisponible} doc. libre</span>
                                ) : (
                                  <span className="text-[10px] text-slate-500">Sin stock remallado</span>
                                )}
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-emerald-400 mb-0.5">
                                    ✓ Planchadas
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={entry.planchadas ?? ''}
                                    onChange={e => handleProduccionInput(p.id, m.keyId, 'planchadas', e.target.value)}
                                    className="input-dark text-center font-bold text-xs py-1 w-full"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold text-red-400 mb-0.5">
                                    ✕ Mermas
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={entry.defectuosas ?? ''}
                                    onChange={e => handleProduccionInput(p.id, m.keyId, 'defectuosas', e.target.value)}
                                    className="input-dark text-center font-bold text-xs py-1 w-full border-red-500/20"
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── MODAL: ASIGNACIÓN DE CELDA (ASIGNAR MEDIA A PLANCHADOR/DÍA) ───────── */}
      {showCronoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-red-400" />
                <h2 className="text-lg font-bold text-white">
                  {cronoForm.id ? 'Modificar Asignación' : 'Asignar a Planchador'}
                </h2>
              </div>
              <button onClick={() => setShowCronoModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300">
                Programando para la <strong>Semana N° {semanaSeleccionada} ({anioSeleccionado})</strong>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Planchador</label>
                <select
                  value={cronoForm.planchador_id}
                  onChange={e => setCronoForm({ ...cronoForm, planchador_id: e.target.value })}
                  className="input-dark text-xs w-full font-medium"
                >
                  {planchadores.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Día de la Semana</label>
                <select
                  value={cronoForm.dia_semana}
                  onChange={e => setCronoForm({ ...cronoForm, dia_semana: e.target.value })}
                  className="input-dark text-xs w-full capitalize font-medium"
                >
                  {DIAS.map(d => (
                    <option key={d} value={d} className="capitalize">{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Modo de Criterio</label>
                <select
                  value={cronoForm.criterio}
                  onChange={e => {
                    const nuevoCrit = e.target.value
                    let defaultVal = ''
                    if (nuevoCrit === 'media') defaultVal = catalogo[0]?.codigo || ''
                    if (nuevoCrit === 'talla') defaultVal = 'única'
                    if (nuevoCrit === 'publico') defaultVal = 'Dama'
                    setCronoForm({ ...cronoForm, criterio: nuevoCrit, valor_criterio: defaultVal })
                  }}
                  className="input-dark text-xs w-full font-medium"
                >
                  <option value="media">Código Específico del Catálogo</option>
                  <option value="talla">Por Talla (ej. 10-13, 5, Única)</option>
                  <option value="publico">Por Público (Dama, Hombre, Niño)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Valor Asignado</label>
                {cronoForm.criterio === 'media' ? (
                  <select
                    value={cronoForm.valor_criterio}
                    onChange={e => setCronoForm({ ...cronoForm, valor_criterio: e.target.value })}
                    className="input-dark text-xs w-full font-mono font-medium"
                  >
                    <option value="">Seleccionar media...</option>
                    {catalogo.map(c => (
                      <option key={c.id} value={c.codigo}>{c.codigo}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={cronoForm.criterio === 'talla' ? 'Ej. 10-13, 5, única' : 'Ej. Dama, Hombre, Niño'}
                    value={cronoForm.valor_criterio}
                    onChange={e => setCronoForm({ ...cronoForm, valor_criterio: e.target.value })}
                    className="input-dark text-xs w-full"
                  />
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCronoModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">
                Cancelar
              </button>
              <button onClick={guardarAsignacion} className="btn-primary flex-1 justify-center py-2 text-xs bg-red-600 hover:bg-red-500 border-none shadow-lg shadow-red-600/20">
                <CheckCircle2 className="w-4 h-4" />
                Guardar Asignación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
