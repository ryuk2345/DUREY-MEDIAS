'use client'

// Preparado (Fase 5A, migración 032): igual que Planchado. Cronograma semanal con
// uno o varios SKU por preparador y día; planilla diaria; al embolsar se descuenta
// de "por preparar" (lo planchado y el stock de fuera) y se crea el saco con su QR,
// todo en una función atómica (registrar_produccion_preparado).
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  Package, QrCode, Loader2, Check, Calendar, Printer, ChevronLeft, ChevronRight, Copy,
  User, Layers, Scan, Barcode, Plus, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getSemanaAnio, getDiaSemana, formatearRangoSemana } from '@/lib/utils'
import { convertirDocenasAPares, construirQrSacoMaestro, siguienteCodigoSaco } from '@/lib/domain/packaging'
import QRCode from 'qrcode'
import SelectorMedia from '@/components/ui/SelectorMedia'
import Modal from '@/components/ui/Modal'
import IngresoStockFuera from '@/components/produccion/IngresoStockFuera'

interface Preparador { id: string; nombre: string }
interface StockPreparar { catalogo_media_id: string; docenas: number }
interface Paquete {
  id: string
  codigo_paquete: string
  docenas: number
  estado: string
  catalogo_media?: { sku?: string; codigo: string }
  preparador?: { nombre: string }
  ubicacion?: { nombre: string }
  detalles_contenido?: { sku?: string; codigo: string; docenas: number; pares: number }[]
  total_pares?: number
}
interface Ubicacion { id: string; nombre: string; tipo: string }
interface Cronograma { id: string; semana: number; anio: number; dia_semana: string; criterio: string; valor_criterio: string; preparador_id: string }
interface CatalogoMedia { id: string; sku?: string; codigo: string; talla: string; publico: string; modelo?: string; diseno_color?: string }
interface ItemSaco { catalogo_media_id: string; sku: string; codigo: string; docenas: number; defectuosas: number; pares: number }
interface SacoPrevio {
  codigo_saco: string
  preparador: Preparador
  salon_id: string
  items: ItemSaco[]
  totalDocenas: number
  totalPares: number
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

export default function PreparadoPage() {
  const supabase = createClient()
  const { semana: semanaHoy, anio: anioHoy } = getSemanaAnio()
  const [semana, setSemana] = useState(semanaHoy)
  const [anio, setAnio] = useState(anioHoy)
  const [dia, setDia] = useState(getDiaSemana())

  const [preparadores, setPreparadores] = useState<Preparador[]>([])
  const [stock, setStock] = useState<StockPreparar[]>([])
  const [paquetes, setPaquetes] = useState<Paquete[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [cronograma, setCronograma] = useState<Cronograma[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Planilla del día: clave preparador__producto
  const [planilla, setPlanilla] = useState<Record<string, { docenas: string; defectuosas: string }>>({})
  const [extraPorPreparador, setExtraPorPreparador] = useState<Record<string, string[]>>({})

  // Asignación en el cronograma (varios SKU a la vez)
  const [asignar, setAsignar] = useState<{ preparador_id: string; dia: string; actual: string; elegidos: string[] } | null>(null)

  const [saco, setSaco] = useState<SacoPrevio | null>(null)
  const [qrSaco, setQrSaco] = useState('')
  const [paqueteQR, setPaqueteQR] = useState<Paquete | null>(null)
  const [qrPaquete, setQrPaquete] = useState('')

  const leer = useCallback(async () => {
    const hoy = new Date().toISOString().split('T')[0]
    const [st, pq, ub, cr, cat, esp, asig] = await Promise.all([
      supabase.from('stock_listo_preparar').select('catalogo_media_id, docenas'),
      supabase.from('paquetes').select('id, codigo_paquete, docenas, total_pares, detalles_contenido, estado, preparador:usuarios(nombre), catalogo_media:catalogo_medias(sku, codigo), ubicacion:ubicaciones(nombre)').order('created_at', { ascending: false }).limit(30),
      supabase.from('ubicaciones').select('id, nombre, tipo').eq('activo', true),
      supabase.from('cronograma_preparado').select('id, semana, anio, dia_semana, criterio, valor_criterio, preparador_id').eq('semana', semana).eq('anio', anio),
      supabase.from('catalogo_medias').select('id, sku, codigo, talla, publico, modelo, diseno_color').eq('estado', 'activo').order('codigo'),
      supabase.from('usuarios').select('id, nombre').eq('rol', 'preparador').eq('activo', true).order('nombre'),
      supabase.from('asignaciones_turno').select('operador:usuarios(id, nombre)').eq('area', 'preparado').eq('fecha', hoy),
    ])
    for (const [nombre, r] of [['stock por preparar', st], ['sacos', pq], ['salones', ub], ['cronograma', cr], ['catálogo', cat], ['preparadores', esp]] as const) {
      if (r.error) toast.error(`Error al cargar ${nombre}: ${r.error.message}`)
    }
    const mapa = new Map<string, Preparador>(((esp.data ?? []) as Preparador[]).map(u => [u.id, u]))
    for (const a of (asig.data ?? []) as unknown as { operador: Preparador | null }[]) if (a.operador) mapa.set(a.operador.id, a.operador)
    return {
      preparadores: [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      stock: (st.data ?? []) as StockPreparar[],
      paquetes: (pq.data ?? []) as unknown as Paquete[],
      ubicaciones: (ub.data ?? []) as Ubicacion[],
      cronograma: (cr.data ?? []) as Cronograma[],
      catalogo: (cat.data ?? []) as CatalogoMedia[],
    }
  }, [supabase, semana, anio])

  const aplicar = useCallback((d: Awaited<ReturnType<typeof leer>>) => {
    setPreparadores(d.preparadores); setStock(d.stock); setPaquetes(d.paquetes); setUbicaciones(d.ubicaciones)
    setCronograma(d.cronograma); setCatalogo(d.catalogo); setLoading(false)
  }, [])

  useEffect(() => {
    let vigente = true
    ;(async () => { const d = await leer(); if (vigente) aplicar(d) })()
    return () => { vigente = false }
  }, [leer, aplicar])
  const recargar = async () => aplicar(await leer())

  const porCodigo = useMemo(() => new Map(catalogo.map(c => [c.codigo, c])), [catalogo])
  const stockDe = (id: string) => Number(stock.find(s => s.catalogo_media_id === id)?.docenas ?? 0)

  /** SKU de un preparador en el día elegido: los del cronograma y los añadidos a mano. */
  const skusDelDia = useCallback((prepId: string) => {
    const ids = new Set<string>()
    for (const c of cronograma) {
      if (c.preparador_id !== prepId || c.dia_semana !== dia) continue
      const prod = porCodigo.get(c.valor_criterio) ?? catalogo.find(x => x.id === c.valor_criterio)
      if (prod) ids.add(prod.id)
    }
    for (const id of extraPorPreparador[prepId] ?? []) ids.add(id)
    return [...ids].map(id => catalogo.find(c => c.id === id)!).filter(Boolean)
  }, [cronograma, dia, porCodigo, catalogo, extraPorPreparador])

  const editar = (clave: string, campo: 'docenas' | 'defectuosas', valor: string) =>
    setPlanilla(prev => ({ ...prev, [clave]: { docenas: '', defectuosas: '', ...prev[clave], [campo]: valor } }))

  // ── Semanas ──
  const semanaAnterior = () => { if (semana === 1) { setSemana(52); setAnio(a => a - 1) } else setSemana(s => s - 1) }
  const semanaSiguiente = () => { if (semana === 52) { setSemana(1); setAnio(a => a + 1) } else setSemana(s => s + 1) }

  const copiarSemanaAnterior = async () => {
    const sOrigen = semana === 1 ? 52 : semana - 1
    const aOrigen = semana === 1 ? anio - 1 : anio
    setSaving(true)
    const { data: origen } = await supabase.from('cronograma_preparado').select('*').eq('semana', sOrigen).eq('anio', aOrigen)
    if (!origen || origen.length === 0) { toast.error(`No existe programación previa para ${formatearRangoSemana(sOrigen, aOrigen)} (Sem. ${sOrigen})`); setSaving(false); return }
    const { error: errLimpiar } = await supabase.from('cronograma_preparado').delete().eq('semana', semana).eq('anio', anio)
    if (errLimpiar) { toast.error(`No se pudo preparar la semana destino: ${errLimpiar.message}`); setSaving(false); return }
    const { error } = await supabase.from('cronograma_preparado').insert(origen.map(i => ({
      semana, anio, dia_semana: i.dia_semana, criterio: i.criterio, valor_criterio: i.valor_criterio, preparador_id: i.preparador_id,
    })))
    setSaving(false)
    if (error) { toast.error('Error al copiar programación'); return }
    toast.success(`Programación copiada de ${formatearRangoSemana(sOrigen, aOrigen)}`)
    recargar()
  }

  // ── Cronograma: varios SKU por preparador y día ──
  const guardarAsignacion = async () => {
    if (!asignar) return
    const yaTiene = new Set(cronograma.filter(c => c.preparador_id === asignar.preparador_id && c.dia_semana === asignar.dia).map(c => c.valor_criterio))
    const valores = [...new Set([...asignar.elegidos, asignar.actual].filter(v => v && !yaTiene.has(v)))]
    if (valores.length === 0) { toast.error('Elige al menos un SKU que no tenga ya asignado ese día'); return }
    const { error } = await supabase.from('cronograma_preparado').insert(valores.map(v => ({
      semana, anio, preparador_id: asignar.preparador_id, dia_semana: asignar.dia, criterio: 'media', valor_criterio: v,
    })))
    if (error) { toast.error(`Error al guardar asignación: ${error.message}`); return }
    toast.success(valores.length > 1 ? `${valores.length} SKU asignados en el cronograma` : 'Nueva asignación agregada al cronograma')
    setAsignar(null)
    recargar()
  }

  const quitarAsignacion = async (id: string) => {
    if (!confirm('¿Quitar esta asignación del cronograma?')) return
    const { error } = await supabase.from('cronograma_preparado').delete().eq('id', id)
    if (error) { toast.error('Error al quitar asignación'); return }
    toast.success('Asignación quitada del cronograma')
    recargar()
  }

  // ── Saco ──
  const prepararSaco = async (prep: Preparador) => {
    const items: ItemSaco[] = skusDelDia(prep.id).flatMap(c => {
      const v = planilla[`${prep.id}__${c.id}`]
      const docenas = Number(v?.docenas || 0)
      const defectuosas = Number(v?.defectuosas || 0)
      if (!(docenas > 0 || defectuosas > 0)) return []
      return [{ catalogo_media_id: c.id, sku: c.sku || `SKU-${c.codigo.toUpperCase()}`, codigo: c.codigo, docenas, defectuosas, pares: Math.round(convertirDocenasAPares(docenas)) }]
    })
    if (items.some(i => !Number.isFinite(i.docenas) || !Number.isFinite(i.defectuosas) || i.docenas < 0 || i.defectuosas < 0)) { toast.error('Las docenas no pueden ser negativas'); return }
    const totalDocenas = items.reduce((s, i) => s + i.docenas, 0)
    if (totalDocenas <= 0) { toast.error(`Anota las docenas preparadas por ${prep.nombre}`); return }
    const falta = items.find(i => i.docenas + i.defectuosas > stockDe(i.catalogo_media_id))
    if (falta) { toast.error(`No hay suficiente stock por preparar de ${falta.codigo}: hay ${stockDe(falta.catalogo_media_id)} docenas`); return }

    const { data: codigosRes, error: codigosErr } = await supabase.from('paquetes').select('codigo_paquete')
    if (codigosErr) { toast.error(`No se pudo generar el código del saco: ${codigosErr.message}`); return }
    const salon = ubicaciones.find(u => /sal[oó]n a/i.test(u.nombre)) ?? ubicaciones[0]
    if (!salon) { toast.error('No hay salones registrados en Almacén para recibir el saco'); return }
    const previo: SacoPrevio = {
      codigo_saco: siguienteCodigoSaco((codigosRes ?? []).map((r: { codigo_paquete: string }) => r.codigo_paquete)),
      preparador: prep, salon_id: salon.id, items, totalDocenas, totalPares: Math.round(convertirDocenasAPares(totalDocenas)),
    }
    setSaco(previo)
    setQrSaco(await QRCode.toDataURL(qrDe(previo), { width: 300, margin: 2 }))
  }

  const qrDe = (s: SacoPrevio) => {
    const salon = ubicaciones.find(u => u.id === s.salon_id)
    return construirQrSacoMaestro({
      codigo_saco: s.codigo_saco, preparador_id: s.preparador.id, preparador_nombre: s.preparador.nombre,
      salon_destino_id: s.salon_id, salon_destino_nombre: salon?.nombre ?? null, total_docenas: s.totalDocenas, total_pares: s.totalPares,
      items: s.items.map(i => ({ sku: i.sku, codigo: i.codigo, docenas: i.docenas, pares: i.pares })),
    })
  }

  const cambiarSalon = async (id: string) => {
    if (!saco) return
    const nuevo = { ...saco, salon_id: id }
    setSaco(nuevo)
    setQrSaco(await QRCode.toDataURL(qrDe(nuevo), { width: 300, margin: 2 }))
  }

  const confirmarSaco = async () => {
    if (!saco) return
    setSaving(true)
    const { error } = await supabase.rpc('registrar_produccion_preparado', {
      p_preparador_id: saco.preparador.id, p_codigo_paquete: saco.codigo_saco, p_ubicacion_id: saco.salon_id,
      p_items: saco.items.map(i => ({ catalogo_media_id: i.catalogo_media_id, docenas: i.docenas, defectuosas: i.defectuosas })),
      p_qr_data: qrDe(saco),
    })
    setSaving(false)
    if (error) { toast.error(`No se pudo registrar el saco: ${error.message}`); return }
    const salon = ubicaciones.find(u => u.id === saco.salon_id)?.nombre ?? ''
    toast.success(`Saco ${saco.codigo_saco} registrado con ${saco.totalPares} pares. Listo para bajar a ${salon}.`)
    setPlanilla(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${saco.preparador.id}__`))))
    setSaco(null)
    recargar()
  }

  const imprimirEtiqueta = () => {
    if (!saco) return
    const salon = ubicaciones.find(u => u.id === saco.salon_id)?.nombre ?? ''
    const filas = saco.items.map(i => `<tr><td style="border:1px solid #cbd5e1;padding:6px;font-family:monospace;font-weight:bold;font-size:11px">${i.sku}</td>
      <td style="border:1px solid #cbd5e1;padding:6px;font-size:11px">${i.codigo}</td>
      <td style="border:1px solid #cbd5e1;padding:6px;text-align:center;font-weight:bold;font-size:11px">${i.docenas} doc (${i.pares} pares)</td></tr>`).join('')
    const html = `<html><head><title>Etiqueta de Saco Maestro — ${saco.codigo_saco}</title></head>
      <body style="font-family:Arial,sans-serif;padding:20px;max-width:450px;margin:0 auto">
        <div style="border:3px solid #0f172a;border-radius:16px;padding:18px;text-align:center">
          <h2 style="margin:0;color:#059669">SACO MAESTRO DE EMPAQUE</h2>
          <div style="font-family:monospace;font-size:18px;font-weight:bold">${saco.codigo_saco}</div>
          <div style="background:#10b981;color:white;font-weight:bold;padding:6px 14px;border-radius:9999px;display:inline-block;margin:10px 0">DESTINO: ${salon.toUpperCase()}</div>
          <div><img src="${qrSaco}" style="width:180px;height:180px" /></div>
          <p style="font-size:12px">Preparador: <strong>${saco.preparador.nombre}</strong> · Fecha: <strong>${new Date().toLocaleDateString('es-PE')}</strong></p>
          <p style="font-weight:bold">TOTAL: ${saco.totalDocenas} DOCENAS (${saco.totalPares} PARES)</p>
          <table style="width:100%;border-collapse:collapse"><thead><tr><th>SKU</th><th>Media</th><th>Cantidad</th></tr></thead><tbody>${filas}</tbody></table>
        </div></body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  const verQR = async (p: Paquete) => {
    setPaqueteQR(p)
    setQrPaquete(await QRCode.toDataURL(construirQrSacoMaestro({
      codigo_saco: p.codigo_paquete, preparador_nombre: p.preparador?.nombre ?? null, salon_destino_nombre: p.ubicacion?.nombre ?? null,
      total_docenas: p.docenas, total_pares: p.total_pares,
    }), { width: 300, margin: 2 }))
  }

  const esSemanaActual = semana === semanaHoy && anio === anioHoy

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"><Package className="w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Preparado y Embolsado</h1>
            <p className="text-slate-400 text-xs font-medium">Programación semanal por SKU, registro diario por preparador y saco con QR para Almacén</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <IngresoStockFuera etapa="preparado" catalogo={catalogo} onIngreso={recargar} />
          <Link href="/dashboard/almacen" className="btn-primary text-xs py-2 px-4 rounded-2xl bg-cyan-600 hover:bg-cyan-500 border-none flex items-center gap-1.5 font-bold">
            <Scan className="w-4 h-4" /> Escáner / Salones
          </Link>
        </div>
      </div>

      <div className="glass rounded-3xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-white/[0.08]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-900/80 p-1.5 rounded-2xl border border-white/[0.08]">
            <button onClick={semanaAnterior} aria-label="Semana anterior" className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-white/10"><ChevronLeft className="w-4 h-4" /></button>
            <div className="px-3 py-0.5 text-center min-w-[210px]">
              <div className="flex items-center justify-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs sm:text-sm font-black text-white">{formatearRangoSemana(semana, anio)}</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">Semana N° {semana} · {anio}</span>
            </div>
            <button onClick={semanaSiguiente} aria-label="Semana siguiente" className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-white/10"><ChevronRight className="w-4 h-4" /></button>
          </div>
          {!esSemanaActual && <button onClick={() => { setSemana(semanaHoy); setAnio(anioHoy) }} className="text-[11px] font-bold text-emerald-400 hover:underline px-2">Ir a la semana actual</button>}
        </div>
        <button onClick={copiarSemanaAnterior} disabled={saving} className="btn-secondary text-xs py-2 px-3 rounded-2xl">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />} Copiar programación de la semana anterior
        </button>
      </div>

      {/* ── Cronograma semanal ── */}
      <div className="glass rounded-3xl overflow-hidden border border-white/[0.08]">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-white">Cronograma semanal — {formatearRangoSemana(semana, anio)}</h2>
          <p className="text-xs text-slate-400">Toca una celda para asignar uno o varios SKU a ese preparador ese día</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-emerald-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark min-w-max">
              <thead><tr><th className="w-48">Preparador</th>{DIAS.map(d => <th key={d} className={`capitalize text-center ${d === dia ? 'text-emerald-400' : ''}`}>{d}</th>)}</tr></thead>
              <tbody>
                {preparadores.length === 0 ? (
                  <tr><td colSpan={DIAS.length + 1} className="text-center py-8 text-slate-400 text-xs">No hay preparadores registrados ni asignados hoy en el Calendario de Turnos</td></tr>
                ) : preparadores.map(p => (
                  <tr key={p.id}>
                    <td className="font-bold text-white py-4"><span className="flex items-center gap-2"><User className="w-4 h-4 text-slate-400" />{p.nombre}</span></td>
                    {DIAS.map(d => {
                      const lista = cronograma.filter(c => c.preparador_id === p.id && c.dia_semana === d)
                      return (
                        <td key={d} onClick={() => setAsignar({ preparador_id: p.id, dia: d, actual: '', elegidos: [] })} aria-label={`Asignar a ${p.nombre} el ${d}`}
                          className={`cursor-pointer hover:bg-white/[0.04] p-3 text-center ${d === dia ? 'bg-emerald-500/[0.04]' : ''}`}>
                          {lista.length > 0 ? (
                            <div className="space-y-1">
                              {lista.map(a => (
                                <div key={a.id} className="inline-flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 text-[11px] font-bold w-full">
                                  <span className="truncate max-w-[120px] font-mono">{a.valor_criterio}</span>
                                  <button type="button" onClick={e => { e.stopPropagation(); quitarAsignacion(a.id) }} aria-label={`Quitar ${a.valor_criterio}`} className="text-slate-400 hover:text-red-400"><X className="w-3 h-3" /></button>
                                </div>
                              ))}
                            </div>
                          ) : <span className="text-slate-700 text-xs"><Plus className="w-3.5 h-3.5 inline opacity-40" /></span>}
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

      {/* ── Planilla del día ── */}
      <div className="glass rounded-3xl p-6 border border-emerald-500/20 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white">Registro diario — <span className="capitalize text-emerald-400">{dia}</span></h2>
          <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Día">
            {DIAS.map(d => (
              <button key={d} type="button" aria-pressed={dia === d} onClick={() => setDia(d)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize ${dia === d ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>{d}</button>
            ))}
          </div>
        </div>
        {preparadores.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-xs">No hay preparadores</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-slate-400 uppercase text-[10px]">
                <tr><th className="p-3">Preparador</th><th className="p-3">SKU</th><th className="p-3 text-right">Por preparar</th>
                  <th className="p-3 w-28">Preparadas</th><th className="p-3 w-28">Defectuosas</th><th className="p-3 text-right">Saco</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] text-slate-300">
                {preparadores.map(p => {
                  const skus = skusDelDia(p.id)
                  return (
                    <tr key={p.id} data-testid={`planilla-preparado-${p.nombre}`} className="align-top">
                      <td className="p-3 font-bold text-white">{p.nombre}</td>
                      <td className="p-3 space-y-2" colSpan={4}>
                        {skus.length === 0 && <p className="text-slate-500">Sin SKU asignado este día</p>}
                        {skus.map(c => {
                          const clave = `${p.id}__${c.id}`
                          const v = planilla[clave] ?? { docenas: '', defectuosas: '' }
                          return (
                            <div key={c.id} className="grid grid-cols-[1fr_6rem_7rem_7rem] gap-3 items-center">
                              <span className="font-mono">{c.codigo}</span>
                              <span className="text-right font-mono text-emerald-300">{stockDe(c.id)} doc.</span>
                              <input type="number" min="0" step="0.5" aria-label={`Preparadas de ${c.codigo} por ${p.nombre}`} value={v.docenas}
                                onChange={e => editar(clave, 'docenas', e.target.value)} className="input-dark text-xs py-1.5" />
                              <input type="number" min="0" step="0.5" aria-label={`Defectuosas de ${c.codigo} por ${p.nombre}`} value={v.defectuosas}
                                onChange={e => editar(clave, 'defectuosas', e.target.value)} className="input-dark text-xs py-1.5" />
                            </div>
                          )
                        })}
                        <div className="max-w-xs">
                          <SelectorMedia items={catalogo} value="" onChange={val => val && setExtraPorPreparador(prev => ({ ...prev, [p.id]: [...new Set([...(prev[p.id] ?? []), val])] }))}
                            emptyOption={{ value: '', label: '+ Añadir otro SKU hoy…' }} toOption={c => ({ value: c.id, label: c.codigo })}
                            triggerClassName="text-[11px] py-1.5 font-mono" placeholder="+ Añadir otro SKU hoy…" />
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <button type="button" onClick={() => prepararSaco(p)} disabled={skus.length === 0}
                          className="btn-primary text-xs py-2 bg-emerald-600 hover:bg-emerald-500 border-none disabled:opacity-40">
                          <Barcode className="w-4 h-4" /> Embolsar y crear saco
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Sacos ── */}
      <div className="glass rounded-3xl p-6 border border-white/[0.08] space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2"><Layers className="w-5 h-5 text-emerald-400" />Sacos listos para bajar a Almacén</h2>
        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead><tr><th>Código</th><th>SKU</th><th>Preparador</th><th>Docenas</th><th>Pares</th><th>Salón</th><th>Estado</th><th className="text-right">Acciones</th></tr></thead>
            <tbody>
              {paquetes.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-500">No hay sacos registrados aún</td></tr>
              ) : paquetes.map(p => (
                <tr key={p.id}>
                  <td><code className="text-emerald-300 font-mono text-xs font-bold">{p.codigo_paquete}</code></td>
                  <td className="font-mono text-xs">{p.detalles_contenido?.length ? p.detalles_contenido.map(i => i.codigo).join(', ') : (p.catalogo_media?.sku || p.catalogo_media?.codigo || 'Sin SKU')}</td>
                  <td className="text-white text-xs">{p.preparador?.nombre || 'Sin preparador registrado'}</td>
                  <td className="font-mono">{p.docenas} doc.</td>
                  <td className="font-mono text-emerald-400">{p.total_pares || convertirDocenasAPares(p.docenas)} pares</td>
                  <td><span className="badge badge-info">{p.ubicacion?.nombre || 'Sin salón'}</span></td>
                  <td><span className={`badge ${p.estado === 'almacenado' ? 'badge-success' : 'badge-warning'}`}>{p.estado === 'almacenado' ? 'Almacenado en Salón' : 'Pendiente de Almacenar'}</span></td>
                  <td className="text-right"><button onClick={() => verQR(p)} className="btn-secondary py-1.5 px-3 text-xs"><QrCode className="w-3.5 h-3.5" /> Ver QR</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={!!asignar} onClose={() => setAsignar(null)} title="Asignar SKU"
        subtitle={asignar ? `${preparadores.find(p => p.id === asignar.preparador_id)?.nombre ?? ''} · ${asignar.dia}` : undefined}
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setAsignar(null)}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={guardarAsignacion}>Guardar Asignación</button></div>}>
        {asignar && (
          <div className="space-y-2 text-xs">
            <SelectorMedia items={catalogo} value={asignar.actual} onChange={v => setAsignar({ ...asignar, actual: v })} valorDe={c => c.codigo}
              emptyOption={{ value: '', label: 'Seleccionar media...' }} toOption={c => ({ value: c.codigo, label: c.codigo })} placeholder="Seleccionar media..." />
            <button type="button" className="btn-secondary text-[11px] py-1 px-2" disabled={!asignar.actual}
              onClick={() => setAsignar({ ...asignar, elegidos: [...new Set([...asignar.elegidos, asignar.actual])], actual: '' })}>
              <Plus className="w-3 h-3" /> Añadir otro SKU
            </button>
            {asignar.elegidos.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid="skus-elegidos">
                {asignar.elegidos.map(v => (
                  <span key={v} className="badge badge-success text-[10px] font-mono inline-flex items-center gap-1">{v}
                    <button type="button" aria-label={`Quitar ${v}`} onClick={() => setAsignar({ ...asignar, elegidos: asignar.elegidos.filter(x => x !== v) })}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={!!saco} onClose={() => setSaco(null)} title="Saco Maestro de Empaque" maxWidth="lg"
        footer={<>
          <button onClick={imprimirEtiqueta} className="btn-secondary flex-1 justify-center py-2 text-xs"><Printer className="w-4 h-4" /> Imprimir Etiqueta Saco</button>
          <button onClick={confirmarSaco} disabled={saving} className="btn-primary flex-1 justify-center py-2 text-xs bg-emerald-600 hover:bg-emerald-500 border-none font-bold">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar y Bajar a Almacén
          </button></>}>
        {saco && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-2xl bg-slate-900/80 border border-emerald-500/20 text-center">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Código del saco</span>
              <code className="text-2xl font-black text-emerald-400 font-mono block mb-2">{saco.codigo_saco}</code>
              <label htmlFor="saco-salon" className="block text-[10px] font-bold text-slate-300 uppercase mb-1">Salón destino</label>
              <select id="saco-salon" value={saco.salon_id} onChange={e => cambiarSalon(e.target.value)} className="input-dark text-xs">
                {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            {qrSaco && <div className="p-4 rounded-2xl bg-white text-center"><img src={qrSaco} alt="Código QR del saco" className="w-44 h-44 mx-auto" /></div>}
            <p className="text-slate-300 font-bold">Preparador: <span className="text-white">{saco.preparador.nombre}</span> · Total: <span className="text-emerald-400 font-mono">{saco.totalDocenas} docenas ({saco.totalPares} pares)</span></p>
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400"><tr><th className="p-2">SKU</th><th className="p-2">Media</th><th className="p-2 text-right">Docenas</th><th className="p-2 text-right">Defectuosas</th></tr></thead>
              <tbody className="divide-y divide-white/[0.04]">
                {saco.items.map(i => <tr key={i.catalogo_media_id}><td className="p-2 font-mono text-emerald-300">{i.sku}</td><td className="p-2">{i.codigo}</td><td className="p-2 text-right font-mono">{i.docenas}</td><td className="p-2 text-right font-mono">{i.defectuosas}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!paqueteQR} onClose={() => setPaqueteQR(null)} title={paqueteQR ? `Saco ${paqueteQR.codigo_paquete}` : 'Saco'}
        subtitle={paqueteQR ? `Salón: ${paqueteQR.ubicacion?.nombre || 'Sin salón'}` : undefined} maxWidth="sm"
        footer={<button onClick={() => setPaqueteQR(null)} className="btn-primary w-full justify-center py-2 text-xs">Cerrar</button>}>
        {qrPaquete && <div className="p-4 rounded-2xl bg-white mb-4 text-center"><img src={qrPaquete} alt="QR del saco" className="w-48 h-48 mx-auto" /></div>}
        <p className="text-xs font-mono text-emerald-400 font-bold text-center">{paqueteQR?.docenas} docenas ({paqueteQR?.total_pares || convertirDocenasAPares(paqueteQR?.docenas || 0)} pares)</p>
      </Modal>
    </div>
  )
}
