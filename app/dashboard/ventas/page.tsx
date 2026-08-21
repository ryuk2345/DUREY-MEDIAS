// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ShoppingCart, Plus, Search, CreditCard, Banknote,
  Loader2, X, Check, AlertCircle, Upload, DollarSign,
  Calendar, User, ClipboardList, Phone, MapPin, FileText,
  Printer, Clock, CheckCircle2, UserCheck, Filter, ChevronRight,
  ArrowLeft, ChevronDown, UserX, AlertTriangle, Eye, Camera, Zap, Image as ImageIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { formatearMoneda, formatearFecha, generarCodigoVenta } from '@/lib/utils'
import { generarCronogramaCuotas } from '@/lib/domain/finance'

interface Cliente {
  id: string
  nombre: string
  numero_documento: string
  tipo_documento: string
  telefono?: string
  direccion?: string
}

interface Vendedora { id: string; nombre: string }
interface MediaItem { id: string; codigo: string; modelo: string; publico: string }
interface Venta {
  id: string; codigo_venta: string; total_soles: number; tipo_pago: string; estado: string; fecha: string
  cliente: { id: string; nombre: string; numero_documento: string; telefono?: string; direccion?: string }
  asesora: { id: string; nombre: string }
}
interface Deuda {
  id: string
  numero_cuota: number
  monto: number
  fecha_vencimiento: string
  estado: string
  metodo_pago?: string
  comprobante_url?: string
  venta: { id: string; codigo_venta: string; total_soles: number; cliente: { id: string; nombre: string; numero_documento: string; telefono?: string; direccion?: string }; asesora: { id: string; nombre: string } }
}
interface CajaDiaria {
  id: string; saldo_inicial: number; ventas_efectivo: number; cobros_efectivo: number; estado: string
}

interface CarritoItem { catalogo_media_id: string; codigo: string; docenas: number; precio_docena: number }

interface CuotaCronogramaItem {
  numero_cuota: number
  fecha_vencimiento: string
  monto: number
}

export default function VentasPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [vendedoras, setVendedoras] = useState<Vendedora[]>([])
  const [catalogo, setCatalogo] = useState<MediaItem[]>([])
  // Stock disponible en almacén por catalogo_media_id → docenas totales en paquetes 'almacenado'
  const [stockPorMedia, setStockPorMedia] = useState<Record<string, number>>({})
  const [ventas, setVentas] = useState<Venta[]>([])
  const [deudas, setDeudas] = useState<Deuda[]>([])
  const [caja, setCaja] = useState<CajaDiaria | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'ventas' | 'deudas' | 'caja'>('ventas')

  // Nueva Venta
  const [showVentaModal, setShowVentaModal] = useState(false)
  const [vendedoraSeleccionadaId, setVendedoraSeleccionadaId] = useState<string>('')
  const [clienteSeleccionadoId, setClienteSeleccionadoId] = useState<string>('')
  const [clienteForm, setClienteForm] = useState({
    id: '',
    tipo_documento: 'dni',
    numero_documento: '',
    nombre: '',
    telefono: '',
    direccion: ''
  })
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [carrito, setCarrito] = useState<CarritoItem[]>([])
  const [tipoPago, setTipoPago] = useState<'directo' | 'cuotas'>('directo')

  // Adelanto y Financiación
  const [montoAdelanto, setMontoAdelanto] = useState<string>('0')
  const [numeroCuotas, setNumeroCuotas] = useState('3')
  const [frecuenciaPago, setFrecuenciaPago] = useState<'semanal' | 'quincenal' | 'mensual'>('quincenal')
  const [cronogramaCuotas, setCronogramaCuotas] = useState<CuotaCronogramaItem[]>([])

  const [guardandoVenta, setGuardandoVenta] = useState(false)

  // ── NAVEGACIÓN JERÁRQUICA EN CUENTAS POR COBRAR (3 NIVELES) ───────────────
  const [vendedoraSeleccionadaCartera, setVendedoraSeleccionadaCartera] = useState<string | null>(null)
  const [clienteSeleccionadoCartera, setClienteSeleccionadoCartera] = useState<string | null>(null)

  // ── COBRO Y ADJUNTO DE FOTO / VOUCHER / LIQUIDACIÓN ───────────────────────
  const [showCobroModal, setShowCobroModal] = useState(false)
  const [cuotaSeleccionada, setCuotaSeleccionada] = useState<Deuda | null>(null)
  const [isLiquidacionTotal, setIsLiquidacionTotal] = useState(false)
  const [cuotasToLiquidate, setCuotasToLiquidate] = useState<Deuda[]>([])
  const [cobroForm, setCobroForm] = useState({
    metodo: 'efectivo',
    fotoPreview: '',
    procesando: false
  })

  // ── VISOR MODAL DE COMPROBANTES (PARA EL ADMINISTRADOR) ────────────────────
  const [showComprobanteModal, setShowComprobanteModal] = useState(false)
  const [comprobanteData, setComprobanteData] = useState<{
    titulo: string
    cliente: string
    monto: number
    metodo: string
    url: string
  } | null>(null)

  // Caja
  const [showAperturaModal, setShowAperturaModal] = useState(false)
  const [showCierreModal, setShowCierreModal] = useState(false)
  const [saldoInicial, setSaldoInicial] = useState('')
  const [cierreForm, setCierreForm] = useState({ efectivo: '', digital: '', justificacion: '' })

  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const hoy = new Date().toISOString().split('T')[0]
    const [cli, vend, cat, ven, deu, caj, paq] = await Promise.all([
      supabase.from('clientes').select('*').order('nombre'),
      supabase.from('usuarios').select('id, nombre').eq('rol', 'vendedora').eq('activo', true).order('nombre'),
      supabase.from('catalogo_medias').select('id, codigo, modelo, publico').eq('estado', 'activo').order('codigo'),
      supabase.from('ventas').select(`
        id, codigo_venta, total_soles, tipo_pago, estado, fecha,
        cliente:clientes(id, nombre, numero_documento, telefono, direccion),
        asesora:usuarios(id, nombre)
      `).order('created_at', { ascending: false }).limit(30),
      supabase.from('cuotas').select(`
        id, numero_cuota, monto, fecha_vencimiento, estado, metodo_pago, comprobante_url,
        venta:ventas(id, codigo_venta, total_soles, cliente:clientes(id, nombre, numero_documento, telefono, direccion), asesora:usuarios(id, nombre))
      `).order('fecha_vencimiento'),
      supabase.from('cajas_diarias').select('*').eq('fecha', hoy).single(),
      // Stock en almacén: paquetes con estado almacenado o pendiente_almacenar (usando vista en prod)
      (() => {
        const urlEnv = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
        const isMock = !urlEnv || urlEnv.includes('tu-proyecto') || urlEnv.includes('placeholder') || !urlEnv.includes('.supabase.co')
        return isMock
          ? supabase.from('paquetes').select('catalogo_media_id, docenas').in('estado', ['almacenado', 'pendiente_almacenar'])
          : supabase.from('vista_stock_medias').select('catalogo_media_id, stock_docenas')
      })()
    ])

    if (cli.error) toast.error(`Error al cargar clientes: ${cli.error.message}`)
    if (vend.error) toast.error(`Error al cargar vendedoras: ${vend.error.message}`)
    if (cat.error) toast.error(`Error al cargar catálogo: ${cat.error.message}`)
    if (ven.error) toast.error(`Error al cargar ventas: ${ven.error.message}`)
    if (deu.error) toast.error(`Error al cargar deudas: ${deu.error.message}`)

    setClientes(cli.data ?? [])
    setVendedoras(vend.data ?? [])
    setCatalogo(cat.data ?? [])
    setVentas((ven.data ?? []) as unknown as Venta[])
    setDeudas((deu.data ?? []) as unknown as Deuda[])
    setCaja(caj.data ?? null)

    const urlEnv = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const isMock = !urlEnv || urlEnv.includes('tu-proyecto') || urlEnv.includes('placeholder') || !urlEnv.includes('.supabase.co')

    // Calcular stock total por tipo de media
    const stockMap: Record<string, number> = {}
    if (isMock) {
      for (const p of paq.data ?? []) {
        if (!p.catalogo_media_id) continue
        stockMap[p.catalogo_media_id] = (stockMap[p.catalogo_media_id] ?? 0) + Number(p.docenas ?? 0)
      }
    } else {
      for (const row of paq.data ?? []) {
        if (!row.catalogo_media_id) continue
        stockMap[row.catalogo_media_id] = Number(row.stock_docenas ?? 0)
      }
    }
    setStockPorMedia(stockMap)

    if (vend.data && vend.data.length > 0 && !vendedoraSeleccionadaId) {
      setVendedoraSeleccionadaId(vend.data[0].id)
    }

    setLoading(false)
  }, [vendedoraSeleccionadaId])


  useEffect(() => { cargarDatos() }, [cargarDatos])

  const totalCarrito = useMemo(() => {
    return carrito.reduce((sum, i) => sum + i.docenas * i.precio_docena, 0)
  }, [carrito])

  const adelantoNum = useMemo(() => {
    return Math.min(totalCarrito, Math.max(0, parseFloat(montoAdelanto || '0') || 0))
  }, [totalCarrito, montoAdelanto])

  const saldoFinanciado = useMemo(() => {
    return Math.max(0, totalCarrito - adelantoNum)
  }, [totalCarrito, adelantoNum])

  // ── CALCULAR FECHAS EXACTAS DEL CRONOGRAMA DE PAGOS ───────────────────────
  useEffect(() => {
    if (tipoPago !== 'cuotas' || saldoFinanciado <= 0) {
      setCronogramaCuotas([])
      return
    }

    const nCuotas = parseInt(numeroCuotas) || 2
    let diasIntervalo = 15
    if (frecuenciaPago === 'semanal') diasIntervalo = 7
    if (frecuenciaPago === 'quincenal') diasIntervalo = 15
    if (frecuenciaPago === 'mensual') diasIntervalo = 30

    // Llamada centralizada a la lógica de dominio
    const cronograma = generarCronogramaCuotas(saldoFinanciado, nCuotas, diasIntervalo)

    // Mapear al formato esperado por el estado local de la UI
    const arrayCuotas: CuotaCronogramaItem[] = cronograma.map(c => ({
      numero_cuota: c.numero,
      fecha_vencimiento: c.fecha_vencimiento,
      monto: c.monto
    }))

    setCronogramaCuotas(arrayCuotas)
  }, [saldoFinanciado, numeroCuotas, frecuenciaPago, tipoPago])

  const handleCambiarFechaCuotaManualmente = (index: number, nuevaFecha: string) => {
    setCronogramaCuotas(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], fecha_vencimiento: nuevaFecha }
      return copy
    })
  }

  // ── ESTRUCTURA JERÁRQUICA DE CARTERA DE COBRANZA (3 NIVELES) ──────────────
  const deudasPendientesOnly = useMemo(() => {
    return deudas.filter(d => d.estado === 'pendiente')
  }, [deudas])

  const vendedorasCarteraList = useMemo(() => {
    const map = new Map<string, {
      vendedora: { id: string; nombre: string }
      totalCartera: number
      clientesMap: Map<string, { cliente: Cliente; cuotas: Deuda[] }>
      totalCuotas: number
    }>()

    vendedoras.forEach(v => {
      const key = v.nombre.toLowerCase().trim()
      if (!map.has(key)) {
        map.set(key, {
          vendedora: v,
          totalCartera: 0,
          clientesMap: new Map(),
          totalCuotas: 0
        })
      }
    })

    deudasPendientesOnly.forEach(d => {
      const vendNombre = d.venta?.asesora?.nombre || 'Sofia Vendedora'
      const vendId = d.venta?.asesora?.id || '8'
      const key = vendNombre.toLowerCase().trim()
      const clienteId = d.venta?.cliente?.id || d.venta?.cliente?.numero_documento || 'sin_cliente'

      let entryVend = map.get(key)
      if (!entryVend) {
        const match = vendedoras.find(v => v.id === vendId)
        entryVend = {
          vendedora: match || { id: vendId, nombre: vendNombre },
          totalCartera: 0,
          clientesMap: new Map(),
          totalCuotas: 0
        }
        map.set(key, entryVend)
      }

      entryVend.totalCartera += d.monto
      entryVend.totalCuotas += 1

      let entryCliente = entryVend.clientesMap.get(clienteId)
      if (!entryCliente) {
        entryCliente = {
          cliente: d.venta?.cliente as unknown as Cliente,
          cuotas: []
        }
        entryVend.clientesMap.set(clienteId, entryCliente)
      }

      entryCliente.cuotas.push(d)
    })

    return Array.from(map.values())
  }, [vendedoras, deudasPendientesOnly])

  const vendedoraActivaObj = useMemo(() => {
    if (!vendedoraSeleccionadaCartera) return null
    return vendedorasCarteraList.find(v => v.vendedora.id === vendedoraSeleccionadaCartera) || null
  }, [vendedorasCarteraList, vendedoraSeleccionadaCartera])

  const clientesDeudoresActivos = useMemo(() => {
    if (!vendedoraActivaObj) return []
    return Array.from(vendedoraActivaObj.clientesMap.values())
  }, [vendedoraActivaObj])

  const clienteActivoObj = useMemo(() => {
    if (!vendedoraActivaObj || !clienteSeleccionadoCartera) return null
    return vendedoraActivaObj.clientesMap.get(clienteSeleccionadoCartera) || null
  }, [vendedoraActivaObj, clienteSeleccionadoCartera])

  // ── MANEJADOR DE CARGA DE IMAGEN DEL COMPROBANTE / FOTO DE BILLETES ────────
  const handleSeleccionarFotoComprobante = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen supera el límite de 5MB')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setCobroForm(prev => ({ ...prev, fotoPreview: reader.result as string }))
      toast.success('Foto / comprobante adjuntado correctamente')
    }
    reader.readAsDataURL(file)
  }

  // ── INICIAR COBRO INDIVIDUAL O LIQUIDACIÓN TOTAL ─────────────────────────
  const abrirModalCobroIndividual = (cuota: Deuda) => {
    setIsLiquidacionTotal(false)
    setCuotasToLiquidate([cuota])
    setCuotaSeleccionada(cuota)
    setCobroForm({ metodo: 'efectivo', fotoPreview: '', procesando: false })
    setShowCobroModal(true)
  }

  const abrirModalLiquidacionTotalCliente = () => {
    if (!clienteActivoObj || clienteActivoObj.cuotas.length === 0) return
    setIsLiquidacionTotal(true)
    setCuotasToLiquidate(clienteActivoObj.cuotas)
    setCuotaSeleccionada(clienteActivoObj.cuotas[0])
    setCobroForm({ metodo: 'efectivo', fotoPreview: '', procesando: false })
    setShowCobroModal(true)
  }

  const confirmarCobroOJuiquidacion = async () => {
    if (cuotasToLiquidate.length === 0) return

    setCobroForm(prev => ({ ...prev, procesando: true }))

    const ids = cuotasToLiquidate.map(q => q.id)

    const { error } = await supabase.from('cuotas').update({
      estado: 'pagada',
      metodo_pago: cobroForm.metodo,
      comprobante_url: cobroForm.fotoPreview || null
    }).in('id', ids)

    if (error) {
      toast.error('Error al procesar el registro de cobro')
      setCobroForm(prev => ({ ...prev, procesando: false }))
      return
    }

    const montoTotal = cuotasToLiquidate.reduce((sum, q) => sum + q.monto, 0)
    toast.success(`🎉 ${isLiquidacionTotal ? 'Liquidación Total' : 'Cobro'} registrado por ${formatearMoneda(montoTotal)}`)

    setShowCobroModal(false)
    setCuotaSeleccionada(null)
    setCuotasToLiquidate([])
    setCobroForm({ metodo: 'efectivo', fotoPreview: '', procesando: false })
    cargarDatos()
  }

  // ── SELECCIONAR CLIENTE REGISTRADO O BUSCAR POR DNI/RUC ────────────────────
  const handleSeleccionarClienteExistente = (clienteId: string) => {
    setClienteSeleccionadoId(clienteId)
    if (!clienteId) {
      setClienteForm({ id: '', tipo_documento: 'dni', numero_documento: '', nombre: '', telefono: '', direccion: '' })
      return
    }

    const c = clientes.find(item => item.id === clienteId)
    if (c) {
      setClienteForm({
        id: c.id,
        tipo_documento: c.tipo_documento || (c.numero_documento?.length === 11 ? 'ruc' : 'dni'),
        numero_documento: c.numero_documento || '',
        nombre: c.nombre || '',
        telefono: c.telefono || '',
        direccion: c.direccion || ''
      })
      toast.success(`Cliente seleccionado: ${c.nombre}`)
    }
  }

  const buscarClientePorDocumento = async () => {
    const doc = clienteForm.numero_documento.trim()
    if (doc.length < 8) { toast.error('Ingresa un DNI (8 dígitos) o RUC (11 dígitos)'); return }
    setBuscandoCliente(true)

    const { data } = await supabase.from('clientes').select('*').eq('numero_documento', doc).single()

    if (data) {
      setClienteForm({
        id: data.id,
        tipo_documento: data.tipo_documento || (doc.length === 11 ? 'ruc' : 'dni'),
        numero_documento: data.numero_documento,
        nombre: data.nombre,
        telefono: data.telefono || '',
        direccion: data.direccion || ''
      })
      setClienteSeleccionadoId(data.id)
      toast.success(`Cliente registrado encontrado: ${data.nombre}`)
    } else {
      const tipo = doc.length === 11 ? 'ruc' : 'dni'
      const nombreSugerido = doc.length === 8 ? `Persona Natural DNI ${doc}` : `Empresa RUC ${doc}`

      setClienteForm(prev => ({
        ...prev,
        id: '',
        tipo_documento: tipo,
        nombre: prev.nombre || nombreSugerido
      }))
      setClienteSeleccionadoId('')
      toast.info('Cliente no encontrado en base de datos. Completa los datos para registrarlo al vuelo.')
    }
    setBuscandoCliente(false)
  }

  const agregarAlCarrito = () => {
    setCarrito(c => [...c, { catalogo_media_id: catalogo[0]?.id || '', codigo: catalogo[0]?.codigo || '', docenas: 1, precio_docena: 15.00 }])
  }

  // ── IMPRIMIR CRONOGRAMA DE PAGOS FÍSICO (TICKET) ──────────────────────────
  const imprimirCronogramaPagosTicket = (
    codigoVenta: string,
    nombreCliente: string,
    documentoCliente: string,
    telefonoCliente: string,
    vendedoraNombre: string,
    adelantoPagado: number,
    cuotasToPrint: CuotaCronogramaItem[],
    totalSoles: number
  ) => {
    const filasHtml = cuotasToPrint.map(c => `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:8px;font-weight:bold;text-align:center;font-size:12px">Cuota N° ${c.numero_cuota}</td>
        <td style="border:1px solid #cbd5e1;padding:8px;text-align:center;font-mono;font-size:12px;color:#0f172a;font-weight:bold">${c.fecha_vencimiento}</td>
        <td style="border:1px solid #cbd5e1;padding:8px;text-align:right;font-weight:bold;font-size:12px;color:#059669">S/ ${c.monto.toFixed(2)}</td>
      </tr>
    `).join('')

    const html = `
      <html>
        <head>
          <title>Cronograma de Pagos — Venta ${codigoVenta}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #0f172a; max-width: 480px; margin: 0 auto; }
            .ticket { border: 2px solid #0f172a; border-radius: 16px; padding: 20px; background: #ffffff; }
            h2 { margin: 0; font-size: 18px; color: #db2777; text-align: center; }
            p { margin: 4px 0; font-size: 12px; color: #475569; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 8px; font-size: 11px; text-transform: uppercase; }
            .sig-box { margin-top: 35px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; }
            .sig-line { border-top: 1px solid #94a3b8; width: 45%; text-align: center; padding-top: 4px; }
          </style>
        </head>
        <body>
          <div class="ticket">
            <h2>FÁBRICA DE MEDIAS DUREY</h2>
            <div style="text-align:center;font-size:12px;font-weight:bold;color:#0f172a;margin-bottom:12px">COMPROMISO Y CRONOGRAMA DE PAGOS</div>
            <p>Venta N°: <strong>${codigoVenta}</strong> · Vendedora: <strong>${vendedoraNombre}</strong></p>
            <p>Cliente: <strong>${nombreCliente}</strong></p>
            <p>DNI/RUC: <strong>${documentoCliente}</strong> · Teléfono: <strong>${telefonoCliente || '—'}</strong></p>
            <p>Fecha Emisión: <strong>${new Date().toLocaleDateString('es-PE')}</strong></p>

            <div style="margin-top:10px;background:#f0fdf4;border:1px solid #bbf7d0;padding:8px;border-radius:8px;font-size:12px;font-weight:bold;color:#15803d">
              TOTAL VENTA: S/ ${totalSoles.toFixed(2)} | ADELANTO PAGADO: S/ ${adelantoPagado.toFixed(2)}
            </div>

            <table>
              <thead>
                <tr>
                  <th>N° Cuota</th>
                  <th>Fecha de Vencimiento</th>
                  <th style="text-align:right">Monto a Pagar</th>
                </tr>
              </thead>
              <tbody>
                ${filasHtml}
              </tbody>
            </table>

            <div class="sig-box">
              <div class="sig-line">Firma Cliente / DNI</div>
              <div class="sig-line">Firma Vendedora (${vendedoraNombre})</div>
            </div>
          </div>
        </body>
      </html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  // ── IMPRIMIR CARTERA DE COBRANZA COMPLETA DE UNA VENDEDORA ────────────────
  const imprimirCarteraCobranzaVendedora = () => {
    if (!vendedoraActivaObj) return

    const cuotasList = Array.from(vendedoraActivaObj.clientesMap.values()).flatMap(c => c.cuotas)

    const filasHtml = cuotasList.map(d => `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:8px;font-family:monospace;font-size:11px">${d.venta?.codigo_venta}</td>
        <td style="border:1px solid #cbd5e1;padding:8px;font-weight:bold;font-size:11px">${d.venta?.cliente?.nombre}</td>
        <td style="border:1px solid #cbd5e1;padding:8px;font-size:11px;font-family:monospace">${d.venta?.cliente?.telefono || '—'}</td>
        <td style="border:1px solid #cbd5e1;padding:8px;text-align:center;font-size:11px">Cuota ${d.numero_cuota}</td>
        <td style="border:1px solid #cbd5e1;padding:8px;text-align:center;font-weight:bold;font-size:11px;color:#b91c1c">${d.fecha_vencimiento}</td>
        <td style="border:1px solid #cbd5e1;padding:8px;text-align:right;font-weight:bold;font-size:11px;color:#047857">S/ ${d.monto.toFixed(2)}</td>
      </tr>
    `).join('')

    const html = `
      <html>
        <head>
          <title>Cartera de Cobranza — ${vendedoraActivaObj.vendedora.nombre}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #0f172a; }
            h2 { margin: 0; font-size: 18px; color: #be185d; }
            p { margin: 4px 0 15px 0; color: #64748b; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th { background: #fce7f3; color: #9d174d; border: 1px solid #fbcfe8; padding: 8px; font-size: 11px; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <h2>FÁBRICA DE MEDIAS DUREY — CARTERA DE COBRANZA DE VENTAS</h2>
          <p>Asesora / Vendedora: <strong>${vendedoraActivaObj.vendedora.nombre}</strong> · Total Pendiente de Cobro: <strong>S/ ${vendedoraActivaObj.totalCartera.toFixed(2)}</strong> (${cuotasList.length} cuotas)</p>
          <table>
            <thead>
              <tr>
                <th>Venta</th>
                <th>Cliente / Razón Social</th>
                <th>Teléfono Contacto</th>
                <th>Cuota</th>
                <th>Fecha Vencimiento</th>
                <th style="text-align:right">Monto Pendiente</th>
              </tr>
            </thead>
            <tbody>
              ${filasHtml}
            </tbody>
          </table>
        </body>
      </html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  // ── GUARDAR VENTA CON VENDEDORA Y CRONOGRAMA FINANCIADO ─────────────────
  const guardarVenta = async () => {
    if (!vendedoraSeleccionadaId) { toast.error('Selecciona la Vendedora / Asesora encargada'); return }
    if (!clienteForm.nombre.trim()) { toast.error('Ingresa el Nombre o Razón Social del cliente'); return }
    if (!clienteForm.numero_documento.trim()) { toast.error('Ingresa el DNI o RUC del cliente'); return }
    if (carrito.length === 0) { toast.error('Agrega al menos un producto a la venta'); return }

    setGuardandoVenta(true)

    // Usar upsert para evitar errores de DNI/RUC duplicado y asegurar que siempre tengamos un ID válido
    const { data: nuevoCliente, error: cErr } = await supabase.from('clientes').upsert({
      tipo_documento: clienteForm.tipo_documento,
      numero_documento: clienteForm.numero_documento.trim(),
      nombre: clienteForm.nombre.trim(),
      telefono: clienteForm.telefono ? clienteForm.telefono.trim() : '',
      direccion: clienteForm.direccion ? clienteForm.direccion.trim() : '',
    }, { onConflict: 'numero_documento' }).select().single()

    if (cErr || !nuevoCliente) {
      toast.error(`Error al guardar datos del cliente: ${cErr?.message || 'Error al obtener el registro'}`)
      setGuardandoVenta(false)
      return
    }

    const clienteId = nuevoCliente.id

    const { count } = await supabase.from('ventas').select('*', { count: 'exact', head: true })
    const codigoVenta = generarCodigoVenta((count ?? 0) + 1001)

    const { data: venta, error } = await supabase.from('ventas').insert({
      codigo_venta: codigoVenta,
      cliente_id: clienteId,
      asesora_id: vendedoraSeleccionadaId,
      tipo_pago: tipoPago,
      total_soles: totalCarrito,
      monto_adelanto: adelantoNum,
      estado: 'pendiente',
    }).select().single()

    if (error || !venta) { 
      toast.error(`Error al registrar la venta: ${error?.message || 'Fallo en la inserción'}`)
      setGuardandoVenta(false)
      return 
    }


    await supabase.from('items_venta').insert(
      carrito.map(i => ({ venta_id: venta.id, catalogo_media_id: i.catalogo_media_id, docenas: i.docenas, precio_docena: i.precio_docena }))
    )

    if (tipoPago === 'cuotas' && cronogramaCuotas.length > 0) {
      const cuotasToInsert = cronogramaCuotas.map(c => ({
        venta_id: venta.id,
        numero_cuota: c.numero_cuota,
        monto: c.monto,
        fecha_vencimiento: c.fecha_vencimiento,
        estado: 'pendiente'
      }))
      await supabase.from('cuotas').insert(cuotasToInsert)

      const vendObj = vendedoras.find(v => v.id === vendedoraSeleccionadaId)

      if (confirm(`Venta a crédito generada. ¿Deseas imprimir el Cronograma de Pagos para el cliente ${clienteForm.nombre}?`)) {
        imprimirCronogramaPagosTicket(
          codigoVenta,
          clienteForm.nombre,
          clienteForm.numero_documento,
          clienteForm.telefono,
          vendObj?.nombre || 'Sofia Vendedora',
          adelantoNum,
          cronogramaCuotas,
          totalCarrito
        )
      }
    }

    toast.success(`🎉 Venta ${codigoVenta} registrada por ${formatearMoneda(totalCarrito)}`)
    setShowVentaModal(false)
    setCarrito([])
    setClienteSeleccionadoId('')
    setMontoAdelanto('0')
    setClienteForm({ id: '', tipo_documento: 'dni', numero_documento: '', nombre: '', telefono: '', direccion: '' })
    setGuardandoVenta(false)
    cargarDatos()
  }

  const abrirCaja = async () => {
    const { error } = await supabase.from('cajas_diarias').insert({
      asesora_id: vendedoraSeleccionadaId || null,
      fecha: new Date().toISOString().split('T')[0],
      saldo_inicial: parseFloat(saldoInicial || '0'),
      estado: 'abierta',
    })
    if (error) { toast.error('Error al abrir caja'); return }
    toast.success('Caja abierta exitosamente')
    setShowAperturaModal(false)
    cargarDatos()
  }

  const cerrarCaja = async () => {
    if (!caja) return
    const esperadoEfectivo = (caja.saldo_inicial ?? 0) + (caja.ventas_efectivo ?? 0) + (caja.cobros_efectivo ?? 0)
    const declaradoEfectivo = parseFloat(cierreForm.efectivo || '0')
    const diferencia = declaradoEfectivo - esperadoEfectivo
    const estado = diferencia === 0 ? 'cerrada_cuadrada' : diferencia < 0 ? 'cerrada_faltante' : 'cerrada_sobrante'

    if (estado !== 'cerrada_cuadrada' && !cierreForm.justificacion) {
      toast.error('Debes ingresar una justificación para el faltante/sobrante'); return
    }

    const { error } = await supabase.from('cajas_diarias').update({
      saldo_declarado_efectivo: declaradoEfectivo,
      diferencia, estado,
      justificacion: cierreForm.justificacion,
    }).eq('id', caja.id)
    if (error) { toast.error('Error al cerrar caja'); return }
    toast.success(`Caja ${estado.replace('_', ' ')} · Diferencia: ${formatearMoneda(diferencia)}`)
    setShowCierreModal(false)
    cargarDatos()
  }

  const tabs = [
    { id: 'ventas', label: 'Ventas Realizadas', icon: <ShoppingCart className="w-4 h-4" /> },
    { id: 'deudas', label: 'Cuentas por Cobrar (por Vendedora)', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'caja', label: 'Caja Diaria', icon: <DollarSign className="w-4 h-4" /> },
  ] as const

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-pink-500/10 text-pink-400 border border-pink-500/20">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">Ventas y Cobranzas</h1>
          </div>
          <p className="text-slate-400 text-xs font-medium ml-11">Ventas con inicial/adelanto, liquidación total de deuda, adjunto de billetes/vouchers y auditoría administradora</p>
        </div>
        <div className="flex items-center gap-3">
          {!caja ? (
            <button onClick={() => setShowAperturaModal(true)} className="btn-secondary text-xs py-2 rounded-2xl">
              <DollarSign className="w-4 h-4 text-emerald-400" /> Abrir Caja
            </button>
          ) : caja.estado === 'abierta' ? (
            <button onClick={() => setShowCierreModal(true)} className="btn-secondary text-xs py-2 rounded-2xl">
              <ClipboardList className="w-4 h-4 text-pink-400" /> Cerrar Caja
            </button>
          ) : null}
          <button
            onClick={() => {
              if (carrito.length === 0) agregarAlCarrito()
              setShowVentaModal(true)
            }}
            className="btn-primary text-xs py-2.5 px-5 font-bold bg-pink-600 hover:bg-pink-500 text-white rounded-2xl border-none shadow-lg shadow-pink-600/20"
          >
            <Plus className="w-4 h-4" /> Nueva Venta
          </button>
        </div>
      </div>

      {/* Estado de caja */}
      {caja && (
        <div className={`flex items-center gap-4 p-4 rounded-2xl border ${caja.estado === 'abierta' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-slate-800/40 border-white/[0.06]'}`}>
          <DollarSign className={`w-6 h-6 ${caja.estado === 'abierta' ? 'text-emerald-400' : 'text-slate-500'}`} />
          <div>
            <p className={`font-semibold text-sm ${caja.estado === 'abierta' ? 'text-emerald-300' : 'text-slate-400'}`}>
              Caja {caja.estado === 'abierta' ? 'Abierta' : 'Cerrada'} · Saldo inicial: {formatearMoneda(caja.saldo_inicial)}
            </p>
            <p className="text-xs text-slate-500">Ventas efectivo: {formatearMoneda(caja.ventas_efectivo ?? 0)} · Cobros efectivo: {formatearMoneda(caja.cobros_efectivo ?? 0)}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-pink-400 text-pink-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Contenido de tabs */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-pink-400" /></div>
      ) : (
        <>
          {activeTab === 'ventas' && (
            <div className="glass rounded-3xl overflow-hidden border border-white/[0.08]">
              <table className="table-dark">
                <thead>
                  <tr>
                    <th>Venta</th>
                    <th>Cliente / Razón Social</th>
                    <th>Vendedora / Asesora</th>
                    <th>Teléfono / WhatsApp</th>
                    <th>Total Venta</th>
                    <th>Tipo Pago</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-10 text-slate-500">No hay ventas registradas aún</td></tr>
                  ) : ventas.map(v => (
                    <tr key={v.id}>
                      <td><code className="text-pink-300 font-mono text-xs bg-pink-500/10 px-2.5 py-1 rounded-lg border border-pink-500/20">{v.codigo_venta}</code></td>
                      <td>
                        <p className="text-white text-xs font-bold">{v.cliente?.nombre || 'Cliente General'}</p>
                        <p className="text-slate-400 text-[11px] font-mono">{v.cliente?.numero_documento || '—'}</p>
                      </td>
                      <td className="text-slate-200 text-xs font-semibold">
                        <span className="badge badge-neutral text-[10px]">👩‍💼 {v.asesora?.nombre || 'Sofia Vendedora'}</span>
                      </td>
                      <td className="text-slate-300 text-xs font-mono">
                        {v.cliente?.telefono ? `📞 ${v.cliente.telefono}` : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="font-bold text-emerald-400 text-sm font-mono">{formatearMoneda(v.total_soles)}</td>
                      <td>
                        <span className={`badge ${v.tipo_pago === 'directo' ? 'badge-success' : 'badge-warning'}`}>
                          {v.tipo_pago === 'directo' ? '✓ Directo' : '⏳ Cuotas'}
                        </span>
                      </td>
                      <td className="text-slate-400 text-xs">{formatearFecha(v.fecha)}</td>
                      <td><span className="badge badge-info capitalize">{v.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── NAVEGACIÓN JERÁRQUICA EN CUENTAS POR COBRAR (3 NIVELES) ─────────────── */}
          {activeTab === 'deudas' && (
            <div className="space-y-5">
              {/* BREADCRUMBS BARRERA DE NAVEGACIÓN */}
              <div className="glass rounded-2xl px-5 py-3 flex items-center justify-between border border-white/[0.08]">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <button
                    onClick={() => { setVendedoraSeleccionadaCartera(null); setClienteSeleccionadoCartera(null) }}
                    className={`hover:underline flex items-center gap-1 ${!vendedoraSeleccionadaCartera ? 'text-pink-400 font-black' : 'text-slate-400'}`}
                  >
                    <UserCheck className="w-3.5 h-3.5 text-pink-400" />
                    Cartera de Vendedoras
                  </button>

                  {vendedoraActivaObj && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                      <button
                        onClick={() => setClienteSeleccionadoCartera(null)}
                        className={`hover:underline flex items-center gap-1 ${vendedoraSeleccionadaCartera && !clienteSeleccionadoCartera ? 'text-pink-400 font-black' : 'text-slate-300'}`}
                      >
                        👩‍💼 {vendedoraActivaObj.vendedora.nombre}
                      </button>
                    </>
                  )}

                  {clienteActivoObj && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                      <span className="text-pink-400 font-black">
                        👤 {clienteActivoObj.cliente.nombre}
                      </span>
                    </>
                  )}
                </div>

                {vendedoraActivaObj && (
                  <button
                    onClick={imprimirCarteraCobranzaVendedora}
                    className="btn-secondary text-xs py-1.5 px-3 rounded-xl border-pink-500/30 text-pink-300 hover:text-white"
                  >
                    <Printer className="w-3.5 h-3.5 text-pink-400" /> Imprimir Cartera Vendedora
                  </button>
                )}
              </div>

              {/* ── NIVEL 1: TARJETAS DE VENDEDORAS ───────────────────────────────── */}
              {!vendedoraSeleccionadaCartera && (
                <div>
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Selecciona una Vendedora para ver sus Clientes Deudores
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {vendedorasCarteraList.map(v => {
                      const countClientes = v.clientesMap.size

                      return (
                        <div
                          key={v.vendedora.id}
                          onClick={() => setVendedoraSeleccionadaCartera(v.vendedora.id)}
                          className="glass rounded-3xl p-5 border border-white/[0.08] hover:border-pink-500/40 hover:bg-pink-500/[0.02] transition-all cursor-pointer shadow-lg flex flex-col justify-between group"
                        >
                          <div>
                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.06]">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-pink-500/20 text-pink-300 font-bold flex items-center justify-center text-sm border border-pink-500/30 group-hover:scale-105 transition-transform">
                                  👩‍💼
                                </div>
                                <div>
                                  <p className="font-black text-white text-base group-hover:text-pink-300 transition-colors">
                                    {v.vendedora.nombre}
                                  </p>
                                  <span className="text-[10px] text-slate-400 uppercase font-bold">Asesora Comercial</span>
                                </div>
                              </div>
                              <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-pink-400 group-hover:translate-x-1 transition-all" />
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-2 text-center">
                              <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/[0.04]">
                                <p className="text-[10px] text-slate-400 font-bold uppercase">Clientes Deudores</p>
                                <p className="text-lg font-black text-white">{countClientes} Clientes</p>
                              </div>
                              <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/[0.04]">
                                <p className="text-[10px] text-slate-400 font-bold uppercase">Cuotas Pendientes</p>
                                <p className="text-lg font-black text-amber-400">{v.totalCuotas} Cuotas</p>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
                            <span className="text-xs text-slate-400 font-medium">Total Cartera por Cobrar:</span>
                            <span className="text-lg font-black text-emerald-400 font-mono">
                              {formatearMoneda(v.totalCartera)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── NIVEL 2: LISTA DE CLIENTES DEUDORES DE LA VENDEDORA ───────────── */}
              {vendedoraSeleccionadaCartera && !clienteSeleccionadoCartera && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>Clientes Deudores asignados a</span>
                        <span className="text-pink-400">👩‍💼 {vendedoraActivaObj?.vendedora.nombre}</span>
                      </h2>
                      <p className="text-xs text-slate-400">Haz clic en un cliente para ver o liquidar las cuotas exactas que le faltan pagar</p>
                    </div>
                    <button
                      onClick={() => setVendedoraSeleccionadaCartera(null)}
                      className="btn-secondary text-xs py-1.5 px-3 rounded-xl"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Volver a Vendedoras
                    </button>
                  </div>

                  {clientesDeudoresActivos.length === 0 ? (
                    <div className="glass rounded-3xl p-12 text-center text-slate-500 border border-white/[0.08]">
                      <UserX className="w-10 h-10 mx-auto mb-2 opacity-30 text-pink-400" />
                      <p className="text-sm font-bold text-slate-400">Esta vendedora no tiene clientes con deudas pendientes actualmente</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {clientesDeudoresActivos.map(cEntry => {
                        const totalCliente = cEntry.cuotas.reduce((sum, q) => sum + q.monto, 0)

                        return (
                          <div
                            key={cEntry.cliente.id}
                            onClick={() => setClienteSeleccionadoCartera(cEntry.cliente.id)}
                            className="glass rounded-3xl p-5 border border-white/[0.08] hover:border-pink-500/40 hover:bg-pink-500/[0.02] transition-all cursor-pointer flex flex-col justify-between group shadow-lg"
                          >
                            <div>
                              <div className="flex items-start justify-between mb-3 pb-3 border-b border-white/[0.06]">
                                <div>
                                  <p className="font-black text-white text-base group-hover:text-pink-300 transition-colors">
                                    {cEntry.cliente.nombre}
                                  </p>
                                  <p className="text-slate-400 text-xs font-mono">DNI/RUC: {cEntry.cliente.numero_documento || '—'}</p>
                                </div>
                                <span className="badge badge-warning text-[10px] font-bold">
                                  {cEntry.cuotas.length} cuotas faltantes
                                </span>
                              </div>

                              <div className="space-y-1.5 text-xs text-slate-300 mb-3">
                                {cEntry.cliente.telefono && (
                                  <div className="flex items-center gap-1.5 text-emerald-400 font-mono font-semibold">
                                    <Phone className="w-3.5 h-3.5" />
                                    <span>{cEntry.cliente.telefono}</span>
                                  </div>
                                )}
                                {cEntry.cliente.direccion && (
                                  <div className="flex items-center gap-1.5 text-slate-400">
                                    <MapPin className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                                    <span className="truncate">{cEntry.cliente.direccion}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
                              <div>
                                <span className="text-[10px] text-slate-500 uppercase font-bold block">Deuda Pendiente del Cliente:</span>
                                <span className="text-lg font-black text-emerald-400 font-mono">
                                  {formatearMoneda(totalCliente)}
                                </span>
                              </div>

                              <span className="btn-secondary text-[11px] py-1.5 px-3 rounded-xl group-hover:bg-pink-500 group-hover:text-white group-hover:border-none transition-all">
                                Ver Cuotas Faltantes ➔
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── NIVEL 3: DETALLE DE CUOTAS FALTANTES Y LIQUIDACIÓN TOTAL ─────── */}
              {vendedoraSeleccionadaCartera && clienteSeleccionadoCartera && clienteActivoObj && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 glass p-5 rounded-3xl border border-pink-500/30 bg-pink-500/[0.01]">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="badge badge-danger text-[10px]">Cuotas Faltantes ({clienteActivoObj.cuotas.length})</span>
                        <h2 className="text-lg font-black text-white">{clienteActivoObj.cliente.nombre}</h2>
                      </div>
                      <p className="text-xs text-slate-400">
                        Vendedora: <strong className="text-pink-300">👩‍💼 {vendedoraActivaObj?.vendedora.nombre}</strong> · DNI/RUC: {clienteActivoObj.cliente.numero_documento} · Tel: {clienteActivoObj.cliente.telefono || '—'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={abrirModalLiquidacionTotalCliente}
                        className="btn-primary text-xs py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white font-bold border-none shadow-lg shadow-amber-600/20 flex items-center gap-1.5"
                        title="Cancela la totalidad de las cuotas pendientes del cliente en 1 solo paso"
                      >
                        <Zap className="w-4 h-4 fill-white" />
                        💥 Liquidar Toda la Deuda ({formatearMoneda(clienteActivoObj.cuotas.reduce((s, q) => s + q.monto, 0))})
                      </button>

                      <button
                        onClick={() => setClienteSeleccionadoCartera(null)}
                        className="btn-secondary text-xs py-2 px-3 rounded-xl"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> Volver a Lista
                      </button>
                    </div>
                  </div>

                  <div className="glass rounded-3xl overflow-hidden border border-white/[0.08]">
                    <table className="table-dark">
                      <thead>
                        <tr>
                          <th>Venta</th>
                          <th>N° Cuota</th>
                          <th>Fecha Exacta de Vencimiento</th>
                          <th>Monto Cuota</th>
                          <th>Estado</th>
                          <th>Comprobante / Foto</th>
                          <th className="text-right">Acciones de Cobro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clienteActivoObj.cuotas.map(q => (
                          <tr key={q.id}>
                            <td>
                              <code className="text-pink-300 font-mono text-xs bg-pink-500/10 px-2.5 py-1 rounded-lg border border-pink-500/20 font-bold">
                                {q.venta?.codigo_venta}
                              </code>
                            </td>
                            <td className="font-bold text-white text-xs">Cuota N° {q.numero_cuota}</td>
                            <td>
                              <span className={`badge font-mono font-bold ${new Date(q.fecha_vencimiento) < new Date() ? 'badge-danger' : 'badge-warning'}`}>
                                📅 {formatearFecha(q.fecha_vencimiento)}
                              </span>
                            </td>
                            <td className="font-black text-emerald-400 text-sm font-mono">{formatearMoneda(q.monto)}</td>
                            <td>
                              {new Date(q.fecha_vencimiento) < new Date() ? (
                                <span className="badge badge-danger text-[10px]">⚠️ Vencida</span>
                              ) : (
                                <span className="badge badge-warning text-[10px]">⏳ Por Vencer</span>
                              )}
                            </td>
                            <td>
                              {q.comprobante_url ? (
                                <button
                                  onClick={() => {
                                    setComprobanteData({
                                      titulo: `Comprobante Cuota N° ${q.numero_cuota} (${q.venta?.codigo_venta})`,
                                      cliente: clienteActivoObj.cliente.nombre,
                                      monto: q.monto,
                                      metodo: q.metodo_pago === 'efectivo' ? '💵 Efectivo en Billetes' : '📲 Transferencia / Yape / Voucher',
                                      url: q.comprobante_url
                                    })
                                    setShowComprobanteModal(true)
                                  }}
                                  className="btn-secondary py-1 px-2 text-[11px] border-emerald-500/30 text-emerald-300 hover:text-white flex items-center gap-1 font-bold"
                                >
                                  <Eye className="w-3.5 h-3.5 text-emerald-400" /> Ver Foto
                                </button>
                              ) : (
                                <span className="text-slate-600 text-xs">— Sin adjunto —</span>
                              )}
                            </td>
                            <td className="text-right space-x-2">
                              <button
                                onClick={() => {
                                  imprimirCronogramaPagosTicket(
                                    q.venta?.codigo_venta,
                                    clienteActivoObj.cliente.nombre,
                                    clienteActivoObj.cliente.numero_documento,
                                    clienteActivoObj.cliente.telefono,
                                    vendedoraActivaObj?.vendedora.nombre || 'Sofia Vendedora',
                                    0,
                                    [{ numero_cuota: q.numero_cuota, fecha_vencimiento: q.fecha_vencimiento, monto: q.monto }],
                                    q.venta?.total_soles || q.monto
                                  )
                                }}
                                className="btn-secondary py-1.5 px-3 text-xs"
                                title="Imprimir compromiso de pago"
                              >
                                <Printer className="w-3.5 h-3.5 text-pink-400" />
                              </button>

                              <button
                                onClick={() => abrirModalCobroIndividual(q)}
                                className="btn-primary py-1.5 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 border-none font-bold shadow-lg shadow-emerald-600/20"
                              >
                                <Banknote className="w-3.5 h-3.5" /> Registrar Cobro
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'caja' && (
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Saldo Inicial', value: caja?.saldo_inicial ?? 0, color: 'text-slate-300' },
                { label: 'Ventas en Efectivo', value: caja?.ventas_efectivo ?? 0, color: 'text-emerald-400' },
                { label: 'Cobros en Efectivo', value: caja?.cobros_efectivo ?? 0, color: 'text-blue-400' },
                { label: 'Total Esperado en Caja', value: (caja?.saldo_inicial ?? 0) + (caja?.ventas_efectivo ?? 0) + (caja?.cobros_efectivo ?? 0), color: 'text-white' },
              ].map(s => (
                <div key={s.label} className="glass rounded-3xl p-5 border border-white/[0.08]">
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-2 font-bold">{s.label}</p>
                  <p className={`text-3xl font-black font-mono ${s.color}`}>{formatearMoneda(s.value)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── MODAL: REGISTRAR NUEVA VENTA CON VENDEDORA, INICIAL Y CRONOGRAMA ─── */}
      {showVentaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-2xl p-7 shadow-2xl border border-pink-500/20 animate-fadeInUp max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-pink-400" />
                <h2 className="text-lg font-bold text-white">Registrar Nueva Venta</h2>
              </div>
              <button onClick={() => setShowVentaModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* SECCIÓN VENDEDORA ENCARGADA */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Vendedora / Asesora Encargada *</label>
              <select
                value={vendedoraSeleccionadaId}
                onChange={e => setVendedoraSeleccionadaId(e.target.value)}
                className="input-dark text-xs w-full font-bold text-pink-300 border-pink-500/30"
              >
                {vendedoras.map(v => (
                  <option key={v.id} value={v.id}>👩‍💼 {v.nombre}</option>
                ))}
              </select>
            </div>

            {/* 1. SECCIÓN CLIENTE */}
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.08] mb-5 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-pink-400 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-4 h-4 text-pink-400" /> Datos del Cliente / Comprobante
                </label>

                <select
                  value={clienteSeleccionadoId}
                  onChange={e => handleSeleccionarClienteExistente(e.target.value)}
                  className="input-dark text-xs py-1 px-2.5 font-medium border-pink-500/30 text-pink-300 max-w-[220px]"
                >
                  <option value="">+ Cliente Frecuente / Nuevo</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre} ({c.numero_documento})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Tipo Doc.</label>
                  <select
                    value={clienteForm.tipo_documento}
                    onChange={e => setClienteForm({ ...clienteForm, tipo_documento: e.target.value })}
                    className="input-dark text-xs w-full font-bold"
                  >
                    <option value="dni">DNI (8 dígitos)</option>
                    <option value="ruc">RUC (11 dígitos)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Número de DNI / RUC</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      maxLength={11}
                      placeholder="Ej. 45678912 o 20601234567"
                      value={clienteForm.numero_documento}
                      onChange={e => setClienteForm({ ...clienteForm, numero_documento: e.target.value })}
                      className="input-dark text-xs font-mono font-bold flex-1"
                    />
                    <button
                      type="button"
                      onClick={buscarClientePorDocumento}
                      disabled={buscandoCliente}
                      className="btn-primary py-1.5 px-3 text-xs bg-pink-600 hover:bg-pink-500 border-none"
                    >
                      {buscandoCliente ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Nombre Completo / Razón Social *</label>
                <input
                  type="text"
                  placeholder="Ej. Juan Carlos Pérez / Comercial Gamarra S.A.C."
                  value={clienteForm.nombre}
                  onChange={e => setClienteForm({ ...clienteForm, nombre: e.target.value })}
                  className="input-dark text-xs w-full font-bold text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-emerald-400" /> Teléfono / WhatsApp
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. 987 654 321"
                    value={clienteForm.telefono}
                    onChange={e => setClienteForm({ ...clienteForm, telefono: e.target.value })}
                    className="input-dark text-xs font-mono w-full"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-cyan-400" /> Dirección de Envío / Agencia
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Jr. Gamarra 840 Stand 102 / Agencia Marvisur"
                    value={clienteForm.direccion}
                    onChange={e => setClienteForm({ ...clienteForm, direccion: e.target.value })}
                    className="input-dark text-xs w-full"
                  />
                </div>
              </div>
            </div>

            {/* 2. SECCIÓN PRODUCTOS / CARRITO */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Detalle de Productos</label>
                <button onClick={agregarAlCarrito} className="btn-secondary py-1 px-3 text-xs border-pink-500/30 text-pink-300">
                  <Plus className="w-3 h-3" /> Agregar Producto
                </button>
              </div>
              <div className="space-y-2.5">
                {carrito.map((item, idx) => {
                  const stockDisp = item.catalogo_media_id ? (stockPorMedia[item.catalogo_media_id] ?? 0) : null
                  const sinStock = stockDisp !== null && item.docenas > stockDisp
                  const stockBajo = stockDisp !== null && stockDisp <= 5 && stockDisp > 0
                  return (
                    <div key={idx} className={`rounded-xl border p-2 space-y-1.5 ${
                      sinStock ? 'border-red-500/40 bg-red-500/[0.04]' : 'border-white/[0.04] bg-slate-900/40'
                    }`}>
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <select
                          value={item.catalogo_media_id}
                          onChange={e => {
                            const media = catalogo.find(c => c.id === e.target.value)
                            const arr = [...carrito]
                            arr[idx] = { ...arr[idx], catalogo_media_id: e.target.value, codigo: media?.codigo ?? '' }
                            setCarrito(arr)
                          }}
                          className="input-dark col-span-5 text-xs font-mono font-medium"
                        >
                          <option value="">Tipo de media...</option>
                          {catalogo.map(c => {
                            const s = stockPorMedia[c.id] ?? 0
                            return (
                              <option key={c.id} value={c.id}>
                                {c.codigo} {s === 0 ? '⛔ SIN STOCK' : s <= 5 ? `⚠️ Stock: ${s} doc.` : ''}
                              </option>
                            )
                          })}
                        </select>

                        <div className="col-span-3">
                          <input
                            type="number"
                            min="1"
                            placeholder="Docenas"
                            value={item.docenas || ''}
                            onChange={e => {
                              const arr = [...carrito]
                              arr[idx].docenas = parseFloat(e.target.value) || 0
                              setCarrito(arr)
                            }}
                            className={`input-dark text-center text-xs py-1 font-bold w-full ${
                              sinStock ? 'border-red-500/60 text-red-300' : ''
                            }`}
                          />
                        </div>

                        <div className="col-span-3">
                          <input
                            type="number"
                            min="0"
                            step="0.50"
                            placeholder="S/ Docena"
                            value={item.precio_docena || ''}
                            onChange={e => {
                              const arr = [...carrito]
                              arr[idx].precio_docena = parseFloat(e.target.value) || 0
                              setCarrito(arr)
                            }}
                            className="input-dark text-xs py-1 font-mono font-bold w-full"
                          />
                        </div>

                        <button onClick={() => setCarrito(carrito.filter((_, i) => i !== idx))} className="col-span-1 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 flex justify-center">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Indicador de stock */}
                      {item.catalogo_media_id && stockDisp !== null && (
                        <div className={`flex items-center gap-1.5 text-[10px] font-semibold px-1 ${
                          sinStock ? 'text-red-400' : stockBajo ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                          <AlertTriangle className="w-3 h-3" />
                          {sinStock
                            ? `⛔ Stock insuficiente — Solo hay ${stockDisp} doc. disponibles (pides ${item.docenas})`
                            : stockBajo
                            ? `⚠️ Stock bajo — Disponibles: ${stockDisp} doc. en almacén`
                            : `✓ Stock OK — ${stockDisp} doc. disponibles`
                          }
                        </div>
                      )}
                      {item.catalogo_media_id && stockDisp === 0 && (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold px-1 text-red-400">
                          <AlertTriangle className="w-3 h-3" />
                          ⛔ SIN STOCK — No hay docenas de esta media en almacén
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 3. MODALIDAD DE PAGO Y GENERADOR DE CRONOGRAMA FINANCIADO */}
            <div className="mb-5 p-4 rounded-2xl bg-slate-900/60 border border-white/[0.08] space-y-4">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Modalidad de Pago</label>
              <div className="flex gap-3">
                <button onClick={() => setTipoPago('directo')} className={`flex-1 py-2.5 rounded-xl border font-bold text-xs transition-all ${tipoPago === 'directo' ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-400 hover:border-white/20'}`}>
                  <Check className="w-4 h-4 inline mr-1.5" /> Pago Directo (Al Contado)
                </button>
                <button onClick={() => setTipoPago('cuotas')} className={`flex-1 py-2.5 rounded-xl border font-bold text-xs transition-all ${tipoPago === 'cuotas' ? 'border-amber-400 bg-amber-500/10 text-amber-300' : 'border-white/10 text-slate-400 hover:border-white/20'}`}>
                  <Calendar className="w-4 h-4 inline mr-1.5" /> Crédito en Cuotas
                </button>
              </div>

              {tipoPago === 'cuotas' && (
                <div className="space-y-4 pt-3 border-t border-white/[0.06]">
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[10px] font-bold text-amber-300 mb-1 uppercase">
                          💵 Adelanto / Cuota Inicial (Al Contado)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={totalCarrito}
                          placeholder="Ej. 5000"
                          value={montoAdelanto}
                          onChange={e => setMontoAdelanto(e.target.value)}
                          className="input-dark text-xs font-mono font-bold text-amber-300 border-amber-500/30 w-full"
                        />
                      </div>

                      <div className="text-right flex flex-col justify-center">
                        <span className="text-[10px] text-slate-400 uppercase font-bold">Saldo a Financiar en Cuotas:</span>
                        <span className="text-lg font-black text-emerald-400 font-mono">
                          {formatearMoneda(saldoFinanciado)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Frecuencia de Pago</label>
                      <select
                        value={frecuenciaPago}
                        onChange={e => setFrecuenciaPago(e.target.value as any)}
                        className="input-dark text-xs w-full font-bold text-amber-300 border-amber-500/30"
                      >
                        <option value="semanal">Cada 7 días (Semanal)</option>
                        <option value="quincenal">Cada 15 días (Quincenal)</option>
                        <option value="mensual">Cada 30 días (Mensual)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Número de Cuotas Financiadas</label>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={numeroCuotas}
                        onChange={e => setNumeroCuotas(e.target.value)}
                        className="input-dark text-center font-bold text-xs w-full"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-500/20 overflow-hidden bg-slate-900/80">
                    <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
                      <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Cronograma de Pagos Financiado
                      </span>
                      <span className="text-[10px] text-slate-400">Pagas hoy la inicial + las cuotas en fechas exactas</span>
                    </div>

                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/[0.02] text-slate-400 font-semibold border-b border-white/[0.04]">
                        <tr>
                          <th className="p-2.5">Detalle Pago</th>
                          <th className="p-2.5">Fecha Exacta Vencimiento</th>
                          <th className="p-2.5 text-right">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {adelantoNum > 0 && (
                          <tr className="bg-emerald-500/[0.05]">
                            <td className="p-2.5 font-bold text-emerald-300">✓ Adelanto / Inicial</td>
                            <td className="p-2.5 font-mono text-emerald-400 font-bold">Hoy (Al Contado)</td>
                            <td className="p-2.5 text-right font-bold text-emerald-400 font-mono">
                              S/ {adelantoNum.toFixed(2)}
                            </td>
                          </tr>
                        )}
                        {cronogramaCuotas.map((c, idx) => (
                          <tr key={idx}>
                            <td className="p-2.5 font-bold text-slate-200">Cuota N° {c.numero_cuota}</td>
                            <td className="p-2.5">
                              <input
                                type="date"
                                value={c.fecha_vencimiento}
                                onChange={e => handleCambiarFechaCuotaManualmente(idx, e.target.value)}
                                className="input-dark py-1 px-2 text-xs font-mono font-bold text-amber-300 border-amber-500/20"
                              />
                            </td>
                            <td className="p-2.5 text-right font-bold text-emerald-400 font-mono">
                              S/ {c.monto.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* TOTAL */}
            {totalCarrito > 0 && (
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-pink-500/20 mb-6 flex justify-between items-center">
                <div>
                  <span className="text-slate-400 text-[11px] block uppercase font-bold">Total Venta: {formatearMoneda(totalCarrito)}</span>
                  {adelantoNum > 0 && (
                    <span className="text-emerald-400 text-xs block font-bold">Adelanto: {formatearMoneda(adelantoNum)}</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Saldo Financiado:</span>
                  <span className="text-2xl font-black text-emerald-400 font-mono">
                    {tipoPago === 'cuotas' ? formatearMoneda(saldoFinanciado) : formatearMoneda(totalCarrito)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowVentaModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">Cancelar</button>
              <button onClick={guardarVenta} disabled={guardandoVenta} className="btn-primary flex-1 justify-center py-2 text-xs bg-pink-600 hover:bg-pink-500 border-none font-bold shadow-lg shadow-pink-600/20">
                {guardandoVenta ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                Confirmar y Generar Venta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Apertura de Caja */}
      {showAperturaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-sm p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <h2 className="text-lg font-bold text-white mb-4">Apertura de Caja Diaria</h2>
            <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Saldo Inicial en Efectivo (S/)</label>
            <input type="number" min="0" step="0.50" placeholder="0.00" value={saldoInicial} onChange={e => setSaldoInicial(e.target.value)} className="input-dark w-full font-mono text-center font-bold text-lg mb-6" />
            <div className="flex gap-3">
              <button onClick={() => setShowAperturaModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">Cancelar</button>
              <button onClick={abrirCaja} className="btn-primary flex-1 justify-center py-2 text-xs bg-emerald-600 hover:bg-emerald-500 border-none font-bold"><DollarSign className="w-4 h-4" /> Abrir Caja</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cierre de Caja */}
      {showCierreModal && caja && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <h2 className="text-lg font-bold text-white mb-4">Arqueo y Cierre de Caja</h2>
            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Saldo Declarado en Efectivo (S/)</label>
                <input type="number" min="0" step="0.50" placeholder="0.00" value={cierreForm.efectivo} onChange={e => setCierreForm({ ...cierreForm, efectivo: e.target.value })} className="input-dark w-full font-mono font-bold text-center text-lg" />
              </div>
              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Justificación (en caso de faltante o sobrante)</label>
                <textarea rows={3} placeholder="Escribe el motivo de la diferencia si la hubiese..." value={cierreForm.justificacion} onChange={e => setCierreForm({ ...cierreForm, justificacion: e.target.value })} className="input-dark w-full text-xs" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCierreModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">Cancelar</button>
              <button onClick={cerrarCaja} className="btn-primary flex-1 justify-center py-2 text-xs bg-pink-600 hover:bg-pink-500 border-none font-bold"><ClipboardList className="w-4 h-4" /> Confirmar Cierre</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL DE COBRO DE CUOTA / LIQUIDACIÓN TOTAL CON ADJUNTO DE FOTO / VOUCHER ── */}
      {showCobroModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-emerald-500/30 animate-fadeInUp">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-white">
                  {isLiquidacionTotal ? '💥 Liquidar Deuda Total del Cliente' : 'Registrar Cobro de Cuota'}
                </h2>
              </div>
              <button onClick={() => setShowCobroModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs mb-6">
              {/* Tarjeta resumen */}
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-emerald-500/20">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold">Cliente</span>
                    <p className="font-black text-white text-sm">
                      {cuotaSeleccionada?.venta?.cliente?.nombre || clienteActivoObj?.cliente.nombre}
                    </p>
                  </div>
                  <span className="badge badge-success text-[10px] font-bold">
                    {isLiquidacionTotal ? `${cuotasToLiquidate.length} cuotas liquidadas` : `Cuota N° ${cuotaSeleccionada?.numero_cuota}`}
                  </span>
                </div>

                <div className="mt-3 pt-2 border-t border-white/[0.06] flex justify-between items-center">
                  <span className="text-slate-400 text-xs font-bold uppercase">Monto Total a Cancelar:</span>
                  <span className="text-xl font-black text-emerald-400 font-mono">
                    {formatearMoneda(cuotasToLiquidate.reduce((sum, q) => sum + q.monto, 0))}
                  </span>
                </div>
              </div>

              {/* Selector de Método de Pago */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                  Método de Pago Recibido
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCobroForm(prev => ({ ...prev, metodo: 'efectivo' }))}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      cobroForm.metodo === 'efectivo'
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                        : 'border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    💵 Efectivo en Billetes
                  </button>

                  <button
                    type="button"
                    onClick={() => setCobroForm(prev => ({ ...prev, metodo: 'transferencia' }))}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      cobroForm.metodo === 'transferencia'
                        ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300'
                        : 'border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    📲 Yape / Plin / Depósito
                  </button>
                </div>
              </div>

              {/* Campo para adjuntar Foto de Billetes o Voucher */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-400" />
                  {cobroForm.metodo === 'efectivo'
                    ? '📷 Adjuntar Foto de los Billetes en Efectivo'
                    : '📄 Adjuntar Voucher o Pantallazo de Yape/Plin'}
                </label>

                <div className="p-3 rounded-2xl border border-dashed border-white/20 bg-slate-900/40 text-center relative hover:border-emerald-400/50 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleSeleccionarFotoComprobante}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />

                  {cobroForm.fotoPreview ? (
                    <div className="space-y-2">
                      <img
                        src={cobroForm.fotoPreview}
                        alt="Vista previa comprobante"
                        className="max-h-36 mx-auto rounded-xl border border-emerald-500/30 object-contain"
                      />
                      <p className="text-[11px] text-emerald-400 font-bold flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Imagen adjuntada exitosamente (Clic para cambiar)
                      </p>
                    </div>
                  ) : (
                    <div className="py-3">
                      <Upload className="w-7 h-7 mx-auto mb-1 text-slate-500" />
                      <p className="text-xs text-slate-300 font-semibold">Toca o arrastra una foto aquí</p>
                      <p className="text-[10px] text-slate-500">
                        {cobroForm.metodo === 'efectivo' ? 'Captura la foto de los billetes entregados' : 'Sube la captura de la transferencia o Yape'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowCobroModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">Cancelar</button>
              <button
                onClick={confirmarCobroOJuiquidacion}
                disabled={cobroForm.procesando}
                className="btn-primary flex-1 justify-center py-2 text-xs bg-emerald-600 hover:bg-emerald-500 border-none font-bold shadow-lg shadow-emerald-600/20"
              >
                {cobroForm.procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirmar y Registrar Pago
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: VISOR DE COMPROBANTE PARA EL ADMINISTRADOR ────────────────── */}
      {showComprobanteModal && comprobanteData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-lg p-6 shadow-2xl border border-emerald-500/30 animate-fadeInUp">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white">{comprobanteData.titulo}</h2>
              </div>
              <button onClick={() => setShowComprobanteModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3 rounded-2xl bg-slate-900/80 border border-white/[0.06] text-xs grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Cliente</span>
                  <span className="text-white font-bold">{comprobanteData.cliente}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Método de Pago</span>
                  <span className="text-emerald-300 font-bold">{comprobanteData.metodo}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Monto Cancelado</span>
                  <span className="text-emerald-400 font-mono font-black text-sm">{formatearMoneda(comprobanteData.monto)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Verificado por Admin</span>
                  <span className="text-emerald-400 font-bold">✓ Conforme</span>
                </div>
              </div>

              {comprobanteData.url ? (
                <div className="rounded-2xl overflow-hidden border border-white/[0.1] bg-black/40 p-2 max-h-[60vh] flex items-center justify-center">
                  <img
                    src={comprobanteData.url}
                    alt="Foto de billetes o voucher de pago"
                    className="max-h-[55vh] w-auto object-contain rounded-xl shadow-2xl"
                  />
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Sin imagen adjuntada para este registro.
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button onClick={() => setShowComprobanteModal(false)} className="btn-primary py-2 px-6 text-xs bg-emerald-600 hover:bg-emerald-500 border-none font-bold">
                Cerrar Visor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
