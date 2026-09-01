// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Package, Plus, QrCode, Loader2, X, Check, Warehouse, ArrowRight,
  Calendar, Printer, FileText, ChevronLeft, ChevronRight, Copy, Sparkles,
  Save, User, Box, ShieldAlert, CheckCircle2, Layers, Tag, Scan, Barcode
} from 'lucide-react'
import { toast } from 'sonner'
import { generarCodigoPaquete, getSemanaAnio, getDiaSemana } from '@/lib/utils'
import { convertirDocenasAPares } from '@/lib/domain/packaging'
import QRCode from 'qrcode'
import CustomSelect from '@/components/ui/CustomSelect'

interface Preparador { id: string; nombre: string }
interface StockEmpacar { id: string; docenas: number; catalogo_media_id: string; catalogo_media: { id: string; sku?: string; codigo: string; talla: string; publico: string } }
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
interface Cronograma {
  id: string
  semana: number
  anio: number
  dia_semana: string
  criterio: string
  valor_criterio: string
  preparador_id: string
  preparador?: { nombre: string }
}
interface CatalogoMedia { id: string; sku?: string; codigo: string; talla: string; publico: string }

interface SacoMaestroGenerado {
  codigo_saco: string
  preparador_id: string
  preparador_nombre: string
  salon_destino_id: string
  salon_destino_nombre: string
  items: { catalogo_media_id: string; sku: string; codigo: string; docenas: number; pares: number }[]
  totalDocenas: number
  totalPares: number
  qrDataURL: string
  qrPayloadJson: string
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

export default function PreparadoPage() {
  const [preparadores, setPreparadores] = useState<Preparador[]>([])
  const [stock, setStock] = useState<StockEmpacar[]>([])
  const [paquetes, setPaquetes] = useState<Paquete[]>([])
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [cronograma, setCronograma] = useState<Cronograma[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Semana y año actual del calendario
  const { semana: semanaHoy, anio: anioHoy } = getSemanaAnio()

  const [semanaSeleccionada, setSemanaSeleccionada] = useState<number>(semanaHoy)
  const [anioSeleccionado, setAnioSeleccionado] = useState<number>(anioHoy)
  const [diaSeleccionado, setDiaSeleccionado] = useState<string>(getDiaSemana())

  // Modales
  const [showPaqueteModal, setShowPaqueteModal] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showTraslado, setShowTraslado] = useState(false)
  const [showCronoModal, setShowCronoModal] = useState(false)
  const [showSacoMaestroModal, setShowSacoMaestroModal] = useState(false)

  const [paqueteQR, setPaqueteQR] = useState<Paquete | null>(null)
  const [qrDataURL, setQrDataURL] = useState('')
  const [paqueteForm, setPaqueteForm] = useState({ catalogo_media_id: '', docenas: '' })
  const [trasladoForm, setTrasladoForm] = useState({ paquete_id: '', ubicacion_id: '' })

  const [cronoForm, setCronoForm] = useState({
    id: null as string | null,
    preparador_id: '',
    dia_semana: 'lunes',
    criterio: 'media',
    valor_criterio: ''
  })

  // Producción masiva por empacador
  const [produccionMasiva, setProduccionMasiva] = useState<Record<string, { empacadas: string; defectuosas: string }>>({})
  const [mediaManualPorPreparador, setMediaManualPorPreparador] = useState<Record<string, string>>({})

  // Saco Maestro generado para vista previa e impresión de QR
  const [sacoMaestroActual, setSacoMaestroActual] = useState<SacoMaestroGenerado | null>(null)

  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [st, pq, ub, cr, cat] = await Promise.all([
      supabase.from('stock_listo_planchar').select('id, docenas, catalogo_media_id, catalogo_media:catalogo_medias(id, sku, codigo, talla, publico)').gt('docenas', 0),
      supabase.from('paquetes').select('id, codigo_paquete, docenas, total_pares, detalles_contenido, estado, preparador:usuarios(nombre), catalogo_media:catalogo_medias(sku, codigo), ubicacion:ubicaciones(nombre)').order('created_at', { ascending: false }).limit(30),
      supabase.from('ubicaciones').select('id, nombre, tipo').eq('activo', true),
      supabase.from('cronograma_preparado').select('id, semana, anio, dia_semana, criterio, valor_criterio, preparador_id, preparador:usuarios(nombre)').eq('semana', semanaSeleccionada).eq('anio', anioSeleccionado),
      supabase.from('catalogo_medias').select('id, sku, codigo, talla, publico').eq('estado', 'activo').order('codigo'),
    ])

    if (st.error) toast.error(`Error al cargar stock listo para planchar: ${st.error.message}`)
    if (pq.error) toast.error(`Error al cargar sacos maestros: ${pq.error.message}`)
    if (ub.error) toast.error(`Error al cargar ubicaciones: ${ub.error.message}`)
    if (cr.error) toast.error(`Error al cargar cronograma de empaque: ${cr.error.message}`)
    if (cat.error) toast.error(`Error al cargar catálogo de medias: ${cat.error.message}`)

    const hoy = new Date().toISOString().split('T')[0]
    const [espRes, asigRes] = await Promise.all([
      supabase.from('usuarios').select('id, nombre').eq('rol', 'preparador').eq('activo', true).order('nombre'),
      supabase.from('asignaciones_turno').select('operador_id, operador:usuarios(id, nombre)').eq('area', 'preparado').eq('fecha', hoy)
    ])

    const mapaPreparadores = new Map<string, { id: string; nombre: string }>()
    if (espRes.data) {
      espRes.data.forEach((u: any) => mapaPreparadores.set(u.id, u))
    }
    if (asigRes.data) {
      asigRes.data.forEach((a: any) => {
        if (a.operador) {
          mapaPreparadores.set(a.operador.id, a.operador)
        }
      })
    }

    const preparadoresList = Array.from(mapaPreparadores.values())

    setPreparadores(preparadoresList)
    setStock((st.data ?? []) as StockEmpacar[])
    setPaquetes((pq.data ?? []) as Paquete[])
    setUbicaciones(ub.data ?? [])
    setCronograma((cr.data ?? []) as Cronograma[])
    setCatalogo((cat.data ?? []) as CatalogoMedia[])
    setLoading(false)
  }, [semanaSeleccionada, anioSeleccionado, supabase])


  useEffect(() => { cargarDatos() }, [cargarDatos])

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

  const clonarSemanaAnterior = async () => {
    const semanaOrigen = semanaSeleccionada === 1 ? 52 : semanaSeleccionada - 1
    const anioOrigen = semanaSeleccionada === 1 ? anioSeleccionado - 1 : anioSeleccionado

    setSaving(true)
    const { data: origen } = await supabase.from('cronograma_preparado')
      .select('*').eq('semana', semanaOrigen).eq('anio', anioOrigen)

    if (!origen || origen.length === 0) {
      toast.error(`No existe programación previa en la Semana ${semanaOrigen}`)
      setSaving(false)
      return
    }

    await supabase.from('cronograma_preparado')
      .delete().eq('semana', semanaSeleccionada).eq('anio', anioSeleccionado)

    const nuevos = origen.map(item => ({
      semana: semanaSeleccionada,
      anio: anioSeleccionado,
      dia_semana: item.dia_semana,
      criterio: item.criterio,
      valor_criterio: item.valor_criterio,
      preparador_id: item.preparador_id
    }))

    const { error } = await supabase.from('cronograma_preparado').insert(nuevos)

    if (error) {
      toast.error('Error al copiar programación')
    } else {
      toast.success(`✓ Programación copiada de la Semana ${semanaOrigen} a la Semana ${semanaSeleccionada}`)
      cargarDatos()
    }
    setSaving(false)
  }

  const handleProduccionChange = (prepId: string, field: 'empacadas' | 'defectuosas', val: string) => {
    setProduccionMasiva(prev => ({
      ...prev,
      [prepId]: {
        ...prev[prepId] || { empacadas: '', defectuosas: '' },
        [field]: val
      }
    }))
  }

  // ── GENERAR BOLSA GRANDE / SACO MAESTRO CON CÓDIGO QR ─────────────────────
  const abrirModalGenerarSacoMaestro = async (prep: Preparador) => {
    const dataPrep = produccionMasiva[prep.id]
    const docenasIngresadas = parseFloat(dataPrep?.empacadas || '0')

    if (docenasIngresadas <= 0) {
      toast.error(`Ingresa la cantidad de paquetes (docenas) producidos por ${prep.nombre}`)
      return
    }

    // Identificar SKU seleccionado o asignado
    const mediaIdManual = mediaManualPorPreparador[prep.id]
    const asignacionDia = cronograma.find(c => c.preparador_id === prep.id && c.dia_semana === diaSeleccionado)
    let mediaObj = catalogo.find(c => c.id === mediaIdManual)

    if (!mediaObj && asignacionDia) {
      mediaObj = catalogo.find(c =>
        c.codigo.toLowerCase().includes(asignacionDia.valor_criterio.toLowerCase()) ||
        c.talla.toLowerCase() === asignacionDia.valor_criterio.toLowerCase() ||
        c.publico.toLowerCase() === asignacionDia.valor_criterio.toLowerCase()
      )
    }

    if (!mediaObj) mediaObj = catalogo[0]

    const skuMedia = mediaObj.sku || `SKU-${mediaObj.codigo.toUpperCase()}`
    const totalPares = Math.round(convertirDocenasAPares(docenasIngresadas))

    // Código de Saco Maestro (B-1005 / PKG-2005)
    const { count } = await supabase.from('paquetes').select('*', { count: 'exact', head: true })
    const codigoSaco = `B-${(count ?? 0) + 1005}`

    const salonA = ubicaciones.find(u => u.nombre.toLowerCase().includes('salón a') || u.nombre.toLowerCase().includes('salon a')) || ubicaciones[0]

    const items = [
      {
        catalogo_media_id: mediaObj.id,
        sku: skuMedia,
        codigo: mediaObj.codigo,
        docenas: docenasIngresadas,
        pares: totalPares
      }
    ]

    const qrPayloadObj = {
      tipo: 'saco_maestro',
      codigo_saco: codigoSaco,
      preparador_id: prep.id,
      preparador_nombre: prep.nombre,
      salon_destino_id: salonA?.id || '',
      salon_destino_nombre: salonA?.nombre || 'Salón A',
      total_docenas: docenasIngresadas,
      total_pares: totalPares,
      items: items.map(i => ({ sku: i.sku, codigo: i.codigo, docenas: i.docenas, pares: i.pares }))
    }

    const qrPayloadJson = JSON.stringify(qrPayloadObj)
    const qrDataURL = await QRCode.toDataURL(qrPayloadJson, { width: 300, margin: 2 })

    setSacoMaestroActual({
      codigo_saco: codigoSaco,
      preparador_id: prep.id,
      preparador_nombre: prep.nombre,
      salon_destino_id: salonA?.id || '',
      salon_destino_nombre: salonA?.nombre || 'Salón A',
      items,
      totalDocenas: docenasIngresadas,
      totalPares,
      qrDataURL,
      qrPayloadJson
    })

    setShowSacoMaestroModal(true)
  }

  // ── CONFIRMAR Y GUARDAR SACO MAESTRO EN BD PARA BAJAR A ALMACÉN ───────────
  const confirmarGuardarSacoMaestro = async () => {
    if (!sacoMaestroActual) return
    setSaving(true)

    const payload = {
      codigo_paquete: sacoMaestroActual.codigo_saco,
      preparador_id: sacoMaestroActual.preparador_id,
      docenas: sacoMaestroActual.totalDocenas,
      total_pares: sacoMaestroActual.totalPares,
      catalogo_media_id: sacoMaestroActual.items[0]?.catalogo_media_id,
      ubicacion_id: sacoMaestroActual.salon_destino_id,
      detalles_contenido: sacoMaestroActual.items,
      estado: 'pendiente_almacenar'
    }

    const { error } = await supabase.from('paquetes').insert(payload)

    if (error) {
      toast.error('Error al registrar el Saco Maestro')
      setSaving(false)
      return
    }

    toast.success(`📦 Saco Maestro ${sacoMaestroActual.codigo_saco} registrado con ${sacoMaestroActual.totalPares} pares. Listo para bajar a ${sacoMaestroActual.salon_destino_nombre}.`)

    // Limpiar entrada del preparador
    setProduccionMasiva(prev => ({ ...prev, [sacoMaestroActual.preparador_id]: { empacadas: '', defectuosas: '' } }))

    setShowSacoMaestroModal(false)
    setSaving(false)
    cargarDatos()
  }

  // ── IMPRIMIR ETIQUETA MAESTRA FÍSICA PARA EL SACO ─────────────────────────
  const imprimirEtiquetaSacoMaestro = () => {
    if (!sacoMaestroActual) return

    const filasHtml = sacoMaestroActual.items.map(i => `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:6px;font-family:monospace;font-weight:bold;font-size:11px">${i.sku}</td>
        <td style="border:1px solid #cbd5e1;padding:6px;font-size:11px">${i.codigo}</td>
        <td style="border:1px solid #cbd5e1;padding:6px;text-align:center;font-weight:bold;font-size:11px">${i.docenas} doc (${i.pares} pares)</td>
      </tr>
    `).join('')

    const html = `
      <html>
        <head>
          <title>Etiqueta de Saco Maestro — ${sacoMaestroActual.codigo_saco}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #0f172a; max-width: 450px; margin: 0 auto; }
            .label-box { border: 3px solid #0f172a; border-radius: 16px; padding: 18px; background: #ffffff; text-align: center; }
            h2 { margin: 0; font-size: 22px; color: #059669; }
            .salon-badge { background: #10b981; color: white; font-size: 14px; font-weight: bold; padding: 6px 14px; border-radius: 9999px; display: inline-block; margin: 10px 0; }
            .qr-img { width: 180px; height: 180px; margin: 10px auto; border: 2px solid #e2e8f0; border-radius: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; text-align: left; }
            th { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 6px; font-size: 10px; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <div class="label-box">
            <h2>SACO MAESTRO DE EMPAQUE</h2>
            <div style="font-family:monospace;font-size:18px;font-weight:bold;color:#0f172a;margin-top:2px">${sacoMaestroActual.codigo_saco}</div>

            <div class="salon-badge">📍 DESTINO: ${sacoMaestroActual.salon_destino_nombre.toUpperCase()}</div>

            <div><img src="${sacoMaestroActual.qrDataURL}" class="qr-img" /></div>

            <p style="font-size:12px;margin:4px 0;color:#475569">
              Empacador: <strong>${sacoMaestroActual.preparador_nombre}</strong> · Fecha: <strong>${new Date().toLocaleDateString('es-PE')}</strong>
            </p>

            <div style="margin-top:8px;background:#f0fdf4;border:1px solid #bbf7d0;padding:8px;border-radius:8px;font-size:13px;font-weight:bold;color:#15803d font-mono">
              TOTAL CONTENIDO: ${sacoMaestroActual.totalDocenas} PACKS (${sacoMaestroActual.totalPares} PARES)
            </div>

            <table>
              <thead>
                <tr>
                  <th>SKU Media</th>
                  <th>Variante</th>
                  <th style="text-align:center font-bold">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                ${filasHtml}
              </tbody>
            </table>
          </div>
        </body>
      </html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  const verQR = async (p: Paquete) => {
    setPaqueteQR(p)
    const payload = JSON.stringify({
      tipo: 'saco_maestro',
      codigo_saco: p.codigo_paquete,
      salon_destino: p.ubicacion?.nombre || 'Salón A',
      preparador: p.preparador?.nombre || 'Lucia Preparadora',
      docenas: p.docenas,
      pares: p.total_pares || convertirDocenasAPares(p.docenas)
    })
    const url = await QRCode.toDataURL(payload, { width: 300, margin: 2 })
    setQrDataURL(url)
    setShowQRModal(true)
  }

  const isSemanaActual = semanaSeleccionada === semanaHoy && anioSeleccionado === anioHoy

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER SUPERIOR ─────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Preparado y Embolsado</h1>
            <p className="text-slate-400 text-xs font-medium">Embolsado por SKU de media (1 docena = 12 pares), empaque consolidado en Bolsa Grande / Saco Maestro y etiquetado QR para bajar a Salones de Almacén</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <a href="/dashboard/almacen" className="btn-primary text-xs py-2 px-4 rounded-2xl bg-cyan-600 hover:bg-cyan-500 border-none flex items-center gap-1.5 font-bold shadow-lg shadow-cyan-600/20">
            <Scan className="w-4 h-4" /> 🔫 Escáner de Pistola / Salones
          </a>
        </div>
      </div>

      {/* ── CONTROL NAVEGADOR DE SEMANAS Y PROGRAMACIÓN ANTICIPADA ───────────── */}
      <div className="glass rounded-3xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-2xl border border-white/[0.08]">
            <button onClick={irASemanaAnterior} className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-1 text-center">
              <span className="text-xs text-slate-400 block font-medium">Semana de Programación</span>
              <span className="text-sm font-black text-white">Semana N° {semanaSeleccionada} · {anioSeleccionado}</span>
            </div>
            <button onClick={irASemanaSiguiente} className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {isSemanaActual ? (
            <span className="badge bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs py-1 px-3">
              Semana Actual (En Curso)
            </span>
          ) : (
            <span className="badge bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs py-1 px-3">
              Programación Anticipada
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clonarSemanaAnterior}
            disabled={saving}
            className="btn-secondary text-xs py-2 px-3 rounded-2xl text-purple-300 border-purple-500/30 hover:bg-purple-500/10 flex items-center gap-1.5 font-bold"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
            Copiar Programación de la Semana Anterior
          </button>
        </div>
      </div>

      {/* ── SELECTOR DE DÍAS DE LA SEMANA ROTATIVA ──────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-white/[0.06]">
        {DIAS.map(d => (
          <button
            key={d}
            onClick={() => setDiaSeleccionado(d)}
            className={`px-5 py-2.5 rounded-2xl text-xs font-bold capitalize transition-all whitespace-nowrap ${
              diaSeleccionado === d
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                : 'glass text-slate-400 hover:text-slate-200 border border-white/[0.06]'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* ── CARDS DE EMPACADORES PARA REGISTRO Y CONSOLIDACIÓN EN SACO MAESTRO ─ */}
      <div className="space-y-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <User className="w-4 h-4 text-emerald-400" />
          Empacadores Activos — Día <span className="text-white capitalize">{diaSeleccionado}</span> (Semana N° {semanaSeleccionada})
        </h2>

        {preparadores.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/40 rounded-3xl border border-white/[0.06] text-slate-400 text-xs font-medium">
            ⚠️ No hay empacadores/preparadores asignados a esta área hoy — pide al supervisor que complete el Calendario de Turnos en el módulo de Personal.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {preparadores.map(prep => {
            const asignacionDia = cronograma.find(c => c.preparador_id === prep.id && c.dia_semana === diaSeleccionado)
            const inputVals = produccionMasiva[prep.id] || { empacadas: '', defectuosas: '' }

            const mediaIdManual = mediaManualPorPreparador[prep.id]
            let mediaAsignadaObj = catalogo.find(c => c.id === mediaIdManual)

            if (!mediaAsignadaObj && asignacionDia) {
              mediaAsignadaObj = catalogo.find(c =>
                c.codigo.toLowerCase().includes(asignacionDia.valor_criterio.toLowerCase()) ||
                c.talla.toLowerCase() === asignacionDia.valor_criterio.toLowerCase() ||
                c.publico.toLowerCase() === asignacionDia.valor_criterio.toLowerCase()
              )
            }
            if (!mediaAsignadaObj) mediaAsignadaObj = catalogo[0]

            const docenasNum = parseFloat(inputVals.empacadas || '0')
            const paresCalculados = Math.round(convertirDocenasAPares(docenasNum))

            return (
              <div key={prep.id} className="glass rounded-3xl p-5 border border-white/[0.08] flex flex-col justify-between space-y-4 shadow-xl">
                <div>
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center text-sm border border-emerald-500/30">
                        📦
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-sm">{prep.nombre}</h3>
                        <span className="text-[10px] text-slate-400 font-medium block">Empacador de Turno</span>
                      </div>
                    </div>

                    <span className="badge bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-[10px] font-bold">
                      Preparado
                    </span>
                  </div>

                  {/* Programación del día */}
                  <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/[0.04] mb-3 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Programado hoy:</span>
                    {asignacionDia ? (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-emerald-300 font-bold capitalize">
                          {asignacionDia.criterio}: {asignacionDia.valor_criterio}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Semana {semanaSeleccionada}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic block">Sin programación fija. Selecciona abajo.</span>
                    )}
                  </div>

                  {/* Selector de SKU de media */}
                  <div className="mb-3">
                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">SKU / Media a Embolsar</label>
                    <CustomSelect
                      value={mediaManualPorPreparador[prep.id] || mediaAsignadaObj?.id || ''}
                      onChange={val => setMediaManualPorPreparador(prev => ({ ...prev, [prep.id]: val }))}
                      options={catalogo.map(c => ({
                        value: c.id,
                        label: `${c.sku ? `[${c.sku}] ` : ''}${c.codigo} (${c.publico})`
                      }))}
                      triggerClassName="text-xs font-mono font-bold text-emerald-300 border-emerald-500/30"
                      placeholder="Seleccionar SKU..."
                    />
                  </div>

                  {/* Input de docenas empacadas */}
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">
                        Paquetes (Docenas)
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={inputVals.empacadas}
                        onChange={e => handleProduccionChange(prep.id, 'empacadas', e.target.value)}
                        className="input-dark text-xs font-bold text-center w-full font-mono"
                      />
                    </div>

                    <div className="flex flex-col justify-end">
                      <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                        <span className="text-[9px] text-slate-400 block font-bold uppercase">Total Pares (12/pack):</span>
                        <span className="text-sm font-black text-emerald-400 font-mono">
                          {paresCalculados} PARES
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => abrirModalGenerarSacoMaestro(prep)}
                  className="btn-primary w-full justify-center py-2.5 text-xs bg-emerald-600 hover:bg-emerald-500 border-none font-bold shadow-lg shadow-emerald-600/20 flex items-center gap-1.5"
                >
                  <Barcode className="w-4 h-4" />
                  📦 Embolsar y Crear Saco Maestro / QR
                </button>
              </div>
            )
          })}
        </div>
        )}
      </div>

      {/* ── LISTADO DE SACOS MAESTROS Y PAQUETES GENERADOS ───────────────────── */}
      <div className="glass rounded-3xl p-6 border border-white/[0.08] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            Sacos Maestros y Paquetes de Empaque Listos para Bajar a Almacén
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>Código Saco</th>
                <th>SKU Media</th>
                <th>Empacador</th>
                <th>Paquetes (Doc.)</th>
                <th>Total Pares</th>
                <th>Salón Destino</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paquetes.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-500">No hay sacos maestros registrados aún</td></tr>
              ) : paquetes.map(p => (
                <tr key={p.id}>
                  <td><code className="text-emerald-300 font-mono text-xs bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 font-bold">{p.codigo_paquete}</code></td>
                  <td className="font-mono text-xs text-slate-200">{p.catalogo_media?.sku || p.catalogo_media?.codigo || 'SKU-VARIOS'}</td>
                  <td className="text-white text-xs font-semibold">{p.preparador?.nombre || 'Lucia Preparadora'}</td>
                  <td className="font-bold text-white font-mono">{p.docenas} doc.</td>
                  <td className="font-black text-emerald-400 font-mono">{p.total_pares || convertirDocenasAPares(p.docenas)} pares</td>
                  <td><span className="badge badge-info font-bold">📍 {p.ubicacion?.nombre || 'Salón A'}</span></td>
                  <td>
                    <span className={`badge ${p.estado === 'almacenado' ? 'badge-success' : 'badge-warning'}`}>
                      {p.estado === 'almacenado' ? 'Almacenado en Salón' : 'Pendiente de Almacenar'}
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => verQR(p)} className="btn-secondary py-1.5 px-3 text-xs">
                      <QrCode className="w-3.5 h-3.5 text-emerald-400" /> Ver QR
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODAL: CREADOR Y PREVISUALIZACIÓN DE SACO MAESTRO (QR DE EMPAQUE) ───── */}
      {showSacoMaestroModal && sacoMaestroActual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-lg p-7 shadow-2xl border border-emerald-500/30 animate-fadeInUp max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-white">Bolsa Grande / Saco Maestro de Empaque</h2>
              </div>
              <button onClick={() => setShowSacoMaestroModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Código y Salón Destino */}
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-emerald-500/20 text-center">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Código del Saco Maestro</span>
                <code className="text-2xl font-black text-emerald-400 font-mono block mb-2">{sacoMaestroActual.codigo_saco}</code>

                <div className="mt-2">
                  <label className="block text-[10px] font-bold text-slate-300 uppercase mb-1">📍 Salón Físico Destino para Almacenar</label>
                  <CustomSelect
                    value={sacoMaestroActual.salon_destino_id}
                    onChange={val => {
                      const ub = ubicaciones.find(u => u.id === val)
                      setSacoMaestroActual(prev => prev ? ({ ...prev, salon_destino_id: val, salon_destino_nombre: ub?.nombre || 'Salón A' }) : null)
                    }}
                    options={ubicaciones.map(u => ({
                      value: u.id,
                      label: `📍 ${u.nombre}`
                    }))}
                    triggerClassName="text-xs font-bold text-center border-emerald-500/30 text-emerald-300"
                  />
                </div>
              </div>

              {/* Imagen QR */}
              <div className="p-4 rounded-2xl bg-white text-center shadow-inner">
                <img src={sacoMaestroActual.qrDataURL} alt="Código QR del Saco Maestro" className="w-44 h-44 mx-auto" />
                <p className="text-[11px] text-slate-600 font-bold mt-1">Escaneable en Almacén con Pistola de Código de Barras / QR</p>
              </div>

              {/* Contenido Desglosado */}
              <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/[0.06] space-y-2">
                <div className="flex justify-between items-center text-slate-300 font-bold">
                  <span>Empacador Responsable:</span>
                  <span className="text-white">{sacoMaestroActual.preparador_nombre}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300 font-bold">
                  <span>Total Contenido:</span>
                  <span className="text-emerald-400 font-mono">{sacoMaestroActual.totalDocenas} Pack Docenas ({sacoMaestroActual.totalPares} Pares)</span>
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.08] overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.04] text-slate-400 font-bold">
                    <tr>
                      <th className="p-2">SKU</th>
                      <th className="p-2">Media</th>
                      <th className="p-2 text-right">Pares</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {sacoMaestroActual.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-mono font-bold text-emerald-300">{item.sku}</td>
                        <td className="p-2 text-slate-300">{item.codigo}</td>
                        <td className="p-2 text-right font-mono font-bold text-white">{item.pares} pares</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={imprimirEtiquetaSacoMaestro} className="btn-secondary flex-1 justify-center py-2 text-xs border-emerald-500/30 text-emerald-300 hover:text-white">
                <Printer className="w-4 h-4 text-emerald-400" /> Imprimir Etiqueta Saco
              </button>
              <button
                onClick={confirmarGuardarSacoMaestro}
                disabled={saving}
                className="btn-primary flex-1 justify-center py-2 text-xs bg-emerald-600 hover:bg-emerald-500 border-none font-bold shadow-lg shadow-emerald-600/20"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirmar y Bajar a Almacén
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: VER QR EXISTENTE ─────────────────────────────────────────── */}
      {showQRModal && paqueteQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-sm p-7 shadow-2xl border border-white/10 animate-fadeInUp text-center">
            <h2 className="text-lg font-bold text-white mb-1">Saco Maestro {paqueteQR.codigo_paquete}</h2>
            <p className="text-xs text-slate-400 mb-4">Salón Destino: <strong className="text-emerald-400">{paqueteQR.ubicacion?.nombre || 'Salón A'}</strong></p>

            <div className="p-4 rounded-2xl bg-white mb-4">
              <img src={qrDataURL} alt="QR Saco Maestro" className="w-48 h-48 mx-auto" />
            </div>

            <p className="text-xs font-mono text-emerald-400 font-bold mb-6">
              {paqueteQR.docenas} Docenas ({paqueteQR.total_pares || convertirDocenasAPares(paqueteQR.docenas)} Pares Totales)
            </p>

            <button onClick={() => setShowQRModal(false)} className="btn-primary w-full justify-center py-2 text-xs bg-emerald-600 border-none font-bold">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
