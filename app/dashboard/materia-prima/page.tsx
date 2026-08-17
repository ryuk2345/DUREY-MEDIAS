'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { 
  Database, Plus, Check, X, RefreshCw, Truck, FileText, AlertTriangle, 
  TrendingUp, TrendingDown, CreditCard, DollarSign, Settings, BarChart3, Wrench, Calendar, Info
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface MateriaPrima {
  id: string
  material: string
  color: string
  stock_kg: number
  created_at: string
}

interface Proveedor {
  id: string
  nombre: string
  ruc: string
  contacto: string
  telefono: string
}

interface Compra {
  id: string
  proveedor_id: string
  materia_prima_id: string
  cantidad_kg: number
  costo_total: number
  estado: 'pendiente' | 'recibida' | 'devuelta'
  motivo_devolucion: string | null
  metodo_pago: string
  condicion_pago: 'contado' | 'pago_diferido'
  fecha: string
  created_at: string
  proveedores?: { nombre: string }
  materia_prima?: { material: string; color: string }
}

interface CuotaCompra {
  id: string
  compra_id: string
  monto: number
  fecha_vencimiento: string
  estado: 'pendiente' | 'pagado'
  fecha_pago: string | null
  metodo_pago: string | null
  comprobante_url: string | null
  compra?: {
    fecha: string
    costo_total: number
    proveedores?: { nombre: string }
    materia_prima?: { material: string; color: string }
  }
}

interface Repuesto {
  id: string
  nombre: string
  stock_actual: number
  costo_unitario: number
  created_at: string
}

interface EgresoAdicional {
  id: string
  concepto: string
  monto: number
  fecha: string
  categoria: string
  created_at: string
}

interface Movimiento {
  id: string
  materia_prima_id: string
  tipo: 'ingreso_compra' | 'consumo_produccion' | 'devolucion'
  cantidad_kg: number
  referencia_id: string | null
  created_at: string
  materia_prima?: { material: string; color: string }
}

export default function MateriaPrimaPage() {
  const [activeTab, setActiveTab] = useState<'hilos' | 'repuestos' | 'proveedores' | 'egresos' | 'balance'>('hilos')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Data lists
  const [stockHilos, setStockHilos] = useState<MateriaPrima[]>([])
  const [compras, setCompras] = useState<Compra[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [repuestos, setRepuestos] = useState<Repuesto[]>([])
  const [cuotasCompras, setCuotasCompras] = useState<CuotaCompra[]>([])
  const [egresosAdicionales, setEgresosAdicionales] = useState<EgresoAdicional[]>([])
  
  // Financial parameters
  const [ventasTotal, setVentasTotal] = useState(0)
  const [repairsTotal, setRepairsTotal] = useState(0)

  // Modals States
  const [showCompraModal, setShowCompraModal] = useState(false)
  const [showQcModal, setShowQcModal] = useState(false)
  const [selectedCompra, setSelectedCompra] = useState<Compra | null>(null)
  
  const [showAddHiloModal, setShowAddHiloModal] = useState(false)
  const [showAddRepuestoModal, setShowAddRepuestoModal] = useState(false)
  const [showAddEgresoModal, setShowAddEgresoModal] = useState(false)
  const [showPayCuotaModal, setShowPayCuotaModal] = useState(false)
  const [selectedCuota, setSelectedCuota] = useState<CuotaCompra | null>(null)

  // Forms
  const [hiloForm, setHiloForm] = useState({ material: '', color: '', stock_kg: '' })
  const [repuestoForm, setRepuestoForm] = useState({ nombre: '', stock_actual: '', costo_unitario: '' })
  const [egresoForm, setEgresoForm] = useState({ concepto: '', monto: '', categoria: 'planilla' })
  const [payCuotaForm, setPayCuotaForm] = useState({ metodo_pago: 'Transferencia', comprobante_url: '' })
  
  const [compraForm, setCompraForm] = useState({
    proveedor_id: '',
    materia_prima_id: '',
    cantidad_kg: '',
    costo_total: '',
    condicion_pago: 'contado' as 'contado' | 'pago_diferido',
    metodo_pago: 'Transferencia',
    cuotas_num: '3'
  })
  
  const [qcForm, setQcForm] = useState({
    aprobar: true,
    motivo_devolucion: ''
  })

  const supabase = createClient()

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      const [hilosRes, provRes, comprasRes, movRes, repRes, cuotasRes, egresosRes, ventasRes, repairsRes] = await Promise.all([
        supabase.from('materia_prima').select('*').order('material'),
        supabase.from('proveedores').select('*').order('nombre'),
        supabase.from('compras_materia_prima').select(`
          *,
          proveedores(nombre),
          materia_prima(material, color)
        `).order('created_at', { ascending: false }),
        supabase.from('movimientos_materia_prima').select(`
          *,
          materia_prima(material, color)
        `).order('created_at', { ascending: false }).limit(30),
        supabase.from('repuestos').select('*').order('nombre'),
        supabase.from('cuotas_compras').select(`
          *,
          compra:compras_materia_prima(
            fecha, costo_total,
            proveedores(nombre),
            materia_prima(material, color)
          )
        `).order('fecha_vencimiento'),
        supabase.from('egresos_adicionales').select('*').order('fecha', { ascending: false }),
        supabase.from('cobros').select('monto').eq('estado_validacion', 'validado'),
        supabase.from('reparaciones').select('costo_total')
      ])

      if (hilosRes.error) throw hilosRes.error
      if (provRes.error) throw provRes.error
      if (comprasRes.error) throw comprasRes.error
      if (movRes.error) throw movRes.error
      if (repRes.error) throw repRes.error
      if (cuotasRes.error) throw cuotasRes.error
      if (egresosRes.error) throw egresosRes.error
      if (ventasRes.error) throw ventasRes.error
      if (repairsRes.error) throw repairsRes.error

      setStockHilos(hilosRes.data ?? [])
      setProveedores(provRes.data ?? [])
      setCompras((comprasRes.data ?? []) as unknown as Compra[])
      setMovimientos((movRes.data ?? []) as unknown as Movimiento[])
      setRepuestos(repRes.data ?? [])
      setCuotasCompras((cuotasRes.data ?? []) as unknown as CuotaCompra[])
      setEgresosAdicionales(egresosRes.data ?? [])
      
      // Calculate financial statistics
      const totalRecaudadoVentas = (ventasRes.data ?? []).reduce((s, c) => s + c.monto, 0)
      const totalReparaciones = (repairsRes.data ?? []).reduce((s, r) => s + (Number(r.costo_total) || 0), 0)
      
      setVentasTotal(totalRecaudadoVentas)
      setRepairsTotal(totalReparaciones)

    } catch (err: any) {
      toast.error(`Error al cargar datos: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // ── AÑADIR NUEVO HILO ─────────────────────────────────────────────────────
  const handleAddHilo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hiloForm.material || !hiloForm.color) {
      toast.error('Material y color son obligatorios')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('materia_prima').insert({
        material: hiloForm.material.trim(),
        color: hiloForm.color.trim(),
        stock_kg: parseFloat(hiloForm.stock_kg || '0')
      })

      if (error) throw error

      toast.success('🧶 Nuevo tipo de fibra/hilo agregado al catálogo')
      setShowAddHiloModal(false)
      setHiloForm({ material: '', color: '', stock_kg: '' })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al registrar hilo: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── AÑADIR NUEVO REPUESTO ──────────────────────────────────────────────────
  const handleAddRepuesto = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repuestoForm.nombre || !repuestoForm.costo_unitario) {
      toast.error('Nombre y costo unitario son obligatorios')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('repuestos').insert({
        nombre: repuestoForm.nombre.trim(),
        stock_actual: parseInt(repuestoForm.stock_actual || '0'),
        costo_unitario: parseFloat(repuestoForm.costo_unitario)
      })

      if (error) throw error

      toast.success('🔧 Repuesto registrado en inventario')
      setShowAddRepuestoModal(false)
      setRepuestoForm({ nombre: '', stock_actual: '', costo_unitario: '' })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al registrar repuesto: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── AÑADIR EGRESO ADICIONAL ───────────────────────────────────────────────
  const handleAddEgreso = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!egresoForm.concepto || !egresoForm.monto) {
      toast.error('Concepto y monto son obligatorios')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('egresos_adicionales').insert({
        concepto: egresoForm.concepto.trim(),
        monto: parseFloat(egresoForm.monto),
        categoria: egresoForm.categoria,
        fecha: new Date().toISOString().split('T')[0]
      })

      if (error) throw error

      toast.success('💸 Egreso registrado correctamente')
      setShowAddEgresoModal(false)
      setEgresoForm({ concepto: '', monto: '', categoria: 'planilla' })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al registrar egreso: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── REGISTRAR ORDEN DE COMPRA DE HILO ─────────────────────────────────────
  const handleRegistrarCompra = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!compraForm.proveedor_id || !compraForm.materia_prima_id || !compraForm.cantidad_kg || !compraForm.costo_total) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    setSaving(true)
    try {
      const { data: compra, error } = await supabase.from('compras_materia_prima').insert({
        proveedor_id: compraForm.proveedor_id,
        materia_prima_id: compraForm.materia_prima_id,
        cantidad_kg: parseFloat(compraForm.cantidad_kg),
        costo_total: parseFloat(compraForm.costo_total),
        condicion_pago: compraForm.condicion_pago,
        metodo_pago: compraForm.metodo_pago,
        estado: 'pendiente'
      }).select().single()

      if (error) throw error

      // Si es pago diferido, generamos el cronograma de cuotas
      if (compraForm.condicion_pago === 'pago_diferido' && compra) {
        const total = parseFloat(compraForm.costo_total)
        const cuotasNum = parseInt(compraForm.cuotas_num) || 3
        const montoCuota = total / cuotasNum
        
        const cuotasToInsert = []
        const hoy = new Date()
        for (let i = 1; i <= cuotasNum; i++) {
          const due = new Date(hoy.getFullYear(), hoy.getMonth() + i, hoy.getDate())
          cuotasToInsert.push({
            compra_id: compra.id,
            monto: parseFloat(montoCuota.toFixed(2)),
            fecha_vencimiento: due.toISOString().split('T')[0],
            estado: 'pendiente'
          })
        }
        await supabase.from('cuotas_compras').insert(cuotasToInsert)
      }

      toast.success('📦 Orden de compra registrada. Pendiente de control de calidad.')
      setShowCompraModal(false)
      setCompraForm({
        proveedor_id: '', materia_prima_id: '', cantidad_kg: '', costo_total: '',
        condicion_pago: 'contado', metodo_pago: 'Transferencia', cuotas_num: '3'
      })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al registrar compra: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── CONTROL DE CALIDAD (APROBAR/RECHAZAR) ──────────────────────────────────
  const abrirModalQC = (compra: Compra) => {
    setSelectedCompra(compra)
    setQcForm({ aprobar: true, motivo_devolucion: '' })
    setShowQcModal(true)
  }

  const handleProcesarQC = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCompra) return

    if (!qcForm.aprobar && !qcForm.motivo_devolucion.trim()) {
      toast.error('Debes ingresar la justificación técnica de la devolución')
      return
    }

    setSaving(true)
    try {
      const nuevoEstado = qcForm.aprobar ? 'recibida' : 'devuelta'
      const motivo = qcForm.aprobar ? null : qcForm.motivo_devolucion

      // 1. Actualizar estado de la compra
      const { error: updErr } = await supabase
        .from('compras_materia_prima')
        .update({ estado: nuevoEstado, motivo_devolucion: motivo })
        .eq('id', selectedCompra.id)

      if (updErr) throw updErr

      // 2. Si se aprueba -> Aumentar el stock y registrar movimiento
      if (qcForm.aprobar) {
        const hilo = stockHilos.find(h => h.id === selectedCompra.materia_prima_id)
        const nuevoStock = Number(hilo?.stock_kg || 0) + Number(selectedCompra.cantidad_kg)

        const { error: stockErr } = await supabase
          .from('materia_prima')
          .update({ stock_kg: nuevoStock })
          .eq('id', selectedCompra.materia_prima_id)

        if (stockErr) throw stockErr

        const { error: movErr } = await supabase
          .from('movimientos_materia_prima').insert({
            materia_prima_id: selectedCompra.materia_prima_id,
            tipo: 'ingreso_compra',
            cantidad_kg: selectedCompra.cantidad_kg,
            referencia_id: selectedCompra.id
          })

        if (movErr) throw movErr
        toast.success(`✅ Entrega aprobada. Se agregaron ${selectedCompra.cantidad_kg} Kg al inventario.`)
      } else {
        // Si se rechaza -> registrar devolución sin alterar stock
        const { error: movErr } = await supabase
          .from('movimientos_materia_prima').insert({
            materia_prima_id: selectedCompra.materia_prima_id,
            tipo: 'devolucion',
            cantidad_kg: selectedCompra.cantidad_kg,
            referencia_id: selectedCompra.id
          })

        if (movErr) throw movErr
        toast.warning(`❌ Entrega rechazada. Lote marcado como devuelto al proveedor.`)
      }

      setShowQcModal(false)
      setSelectedCompra(null)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al procesar control de calidad: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── PAGAR CUOTA DE COMPRA (PAGO DIFERIDO) ─────────────────────────────────
  const abrirModalPagarCuota = (cuota: CuotaCompra) => {
    setSelectedCuota(cuota)
    setPayCuotaForm({ metodo_pago: 'Transferencia', comprobante_url: '' })
    setShowPayCuotaModal(true)
  }

  const handlePagarCuota = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCuota) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('cuotas_compras')
        .update({
          estado: 'pagado',
          fecha_pago: new Date().toISOString().split('T')[0],
          metodo_pago: payCuotaForm.metodo_pago,
          comprobante_url: payCuotaForm.comprobante_url || null
        })
        .eq('id', selectedCuota.id)

      if (error) throw error

      toast.success('💸 Cuota de compra marcada como pagada')
      setShowPayCuotaModal(false)
      setSelectedCuota(null)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al pagar cuota: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── CALCULOS FINANCIEROS (BALANCE) ───────────────────────────────────────
  const egresosData = useMemo(() => {
    const comprasCostos = compras
      .filter(c => c.estado === 'recibida')
      .reduce((s, c) => s + c.costo_total, 0)
      
    const egresosAdic = egresosAdicionales
      .reduce((s, e) => s + e.monto, 0)

    const repuestosAdic = repuestos
      .reduce((s, r) => s + (r.stock_actual * r.costo_unitario), 0)

    const totalEgresos = comprasCostos + repairsTotal + egresosAdic

    return {
      compras: comprasCostos,
      repuestos: repuestosAdic,
      repairs: repairsTotal,
      egresosAdic,
      totalEgresos
    }
  }, [compras, egresosAdicionales, repairsTotal, repuestos])

  const balanceResultado = useMemo(() => {
    const revenue = ventasTotal
    const expenses = egresosData.totalEgresos
    const profit = revenue - expenses

    return {
      revenue,
      expenses,
      profit
    }
  }, [ventasTotal, egresosData])

  const chartData = useMemo(() => {
    return [
      {
        name: 'Ingresos vs Egresos',
        Ingresos: balanceResultado.revenue,
        Egresos: balanceResultado.expenses
      }
    ]
  }, [balanceResultado])

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Gestión de Materia Prima y Finanzas</h1>
            <p className="text-slate-400 text-xs font-medium">Control integral de fibras, hilos, algodón, repuestos, egresos generales, balance de caja y cronograma diferido de proveedores</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {activeTab === 'hilos' && (
            <>
              <button 
                onClick={() => setShowAddHiloModal(true)} 
                className="btn-secondary text-xs py-2.5 px-4 rounded-2xl border-white/[0.08] text-slate-300 font-bold"
              >
                + Añadir Hilo / Algodón
              </button>
              <button 
                onClick={() => setShowCompraModal(true)} 
                className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 border-none flex items-center gap-1.5 font-bold shadow-lg shadow-emerald-600/20"
              >
                <Plus className="w-4 h-4" /> Registrar Compra
              </button>
            </>
          )}

          {activeTab === 'repuestos' && (
            <button 
              onClick={() => setShowAddRepuestoModal(true)} 
              className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-cyan-600 hover:bg-cyan-500 border-none flex items-center gap-1.5 font-bold shadow-lg"
            >
              + Nuevo Repuesto
            </button>
          )}

          {activeTab === 'egresos' && (
            <button 
              onClick={() => setShowAddEgresoModal(true)} 
              className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-red-600 hover:bg-red-500 border-none flex items-center gap-1.5 font-bold shadow-lg"
            >
              + Registrar Egreso
            </button>
          )}

          <button 
            onClick={cargarDatos} 
            className="btn-secondary p-2.5 rounded-2xl border-white/[0.08] hover:bg-white/5 text-slate-300"
            title="Recargar datos"
          >
            <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
          </button>
        </div>
      </div>

      {/* Tabs Selector */}
      <div className="flex gap-2 p-1 rounded-2xl bg-white/[0.02] border border-white/[0.06] w-fit overflow-x-auto max-w-full">
        <button 
          onClick={() => setActiveTab('hilos')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'hilos' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          🧶 Materia Prima
        </button>
        <button 
          onClick={() => setActiveTab('repuestos')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'repuestos' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          🔧 Stock Repuestos
        </button>
        <button 
          onClick={() => setActiveTab('proveedores')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'proveedores' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          📅 Pago Diferido (Proveedores)
        </button>
        <button 
          onClick={() => setActiveTab('egresos')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'egresos' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          💸 Egresos
        </button>
        <button 
          onClick={() => setActiveTab('balance')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'balance' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          📈 Balance Ventas vs Egresos
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs">Cargando datos...</div>
      ) : (
        <>
          {/* TAB 1: MATERIA PRIMA */}
          {activeTab === 'hilos' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
              <div className="lg:col-span-2 space-y-6">
                
                {/* Inventario Hilos */}
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    🧵 Inventario de Fibras, Hilo y Algodón
                  </h2>
                  
                  <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="p-4">Fibra / Material</th>
                          <th className="p-4">Color</th>
                          <th className="p-4 text-right">Stock (Kg)</th>
                          <th className="p-4 text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {stockHilos.map((hilo) => {
                          const isCritical = hilo.stock_kg < 5.0
                          return (
                            <tr key={hilo.id} className="hover:bg-white/[0.01] transition-colors">
                              <td className="p-4 font-bold text-white">{hilo.material}</td>
                              <td className="p-4">
                                <span className="flex items-center gap-2 text-slate-300 font-medium">
                                  <span 
                                    className="w-3.5 h-3.5 rounded-full border border-white/20" 
                                    style={{ 
                                      backgroundColor: hilo.color.toLowerCase() === 'rojo' ? '#ef4444' : 
                                                       hilo.color.toLowerCase() === 'negro' ? '#0f172a' : '#ffffff' 
                                    }} 
                                  />
                                  {hilo.color}
                                </span>
                              </td>
                              <td className="p-4 text-right font-mono font-black text-sm text-white">
                                {Number(hilo.stock_kg).toFixed(3)} Kg
                              </td>
                              <td className="p-4 text-center">
                                {isCritical ? (
                                  <span className="badge bg-red-500/20 text-red-400 border-red-500/30 text-[10px] py-1 px-2.5 font-bold animate-pulse inline-flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> Crítico (&lt;5kg)
                                  </span>
                                ) : (
                                  <span className="badge bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] py-1 px-2.5 font-bold">
                                    Adecuado
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Compras de Hilos */}
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    <Truck className="w-4 h-4 text-emerald-400" /> Registro de Compras de Materia Prima
                  </h2>

                  <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="p-4">Fecha</th>
                          <th className="p-4">Proveedor</th>
                          <th className="p-4">Insumo</th>
                          <th className="p-4 text-right">Cantidad</th>
                          <th className="p-4 text-right">Costo</th>
                          <th className="p-4 text-center">Condición</th>
                          <th className="p-4 text-center">Estado</th>
                          <th className="p-4 text-center">Control Calidad</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {compras.map((compra) => (
                          <tr key={compra.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="p-4 text-slate-300 font-medium font-mono">{compra.fecha}</td>
                            <td className="p-4 font-bold text-white">{compra.proveedores?.nombre || 'Desconocido'}</td>
                            <td className="p-4 text-slate-300 font-medium">{compra.materia_prima?.material} {compra.materia_prima?.color}</td>
                            <td className="p-4 text-right font-bold text-white">{Number(compra.cantidad_kg).toFixed(1)} Kg</td>
                            <td className="p-4 text-right font-bold text-slate-300">S/ {Number(compra.costo_total).toFixed(2)}</td>
                            <td className="p-4 text-center capitalize">{compra.condicion_pago === 'pago_diferido' ? 'Crédito' : 'Contado'}</td>
                            <td className="p-4 text-center">
                              <span className={`badge text-[9px] font-bold py-1 px-2.5 ${
                                compra.estado === 'recibida' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                                compra.estado === 'devuelta' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                                'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              }`}>
                                {compra.estado === 'recibida' ? 'Entregada' :
                                 compra.estado === 'devuelta' ? 'Devuelta' : 'Pendiente QC'}
                              </span>
                              {compra.estado === 'devuelta' && compra.motivo_devolucion && (
                                <p className="text-[9px] text-red-400 font-medium mt-1 text-center truncate max-w-[120px]" title={compra.motivo_devolucion}>
                                  Motivo: {compra.motivo_devolucion}
                                </p>
                              )}
                            </td>
                            <td className="p-4 text-center">
                              {compra.estado === 'pendiente' ? (
                                <button 
                                  onClick={() => abrirModalQC(compra)}
                                  className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shadow-lg"
                                >
                                  Inspeccionar
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-500 font-bold">Verificado</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

              {/* Kárdex / Movimientos */}
              <div className="space-y-6">
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400" /> Kárdex de Insumos (Movimientos)
                  </h2>

                  <div className="space-y-3 overflow-y-auto max-h-[450px] pr-1">
                    {movimientos.map((mov) => {
                      const isIngreso = mov.tipo === 'ingreso_compra'
                      const isDevolucion = mov.tipo === 'devolucion'
                      return (
                        <div key={mov.id} className="p-3.5 rounded-2xl bg-slate-900/60 border border-white/[0.06] flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl flex-shrink-0 ${
                              isIngreso ? 'bg-emerald-500/10 text-emerald-400' :
                              isDevolucion ? 'bg-red-500/10 text-red-400' :
                              'bg-purple-500/10 text-purple-400'
                            }`}>
                              {isIngreso ? <TrendingUp className="w-4 h-4" /> : 
                               isDevolucion ? <X className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            </div>
                            <div>
                              <h4 className="text-[11px] font-black text-white capitalize">
                                {mov.tipo === 'ingreso_compra' ? 'Ingreso por Compra' :
                                 mov.tipo === 'devolucion' ? 'Devolución de Compra' :
                                 'Consumo en Tejido'}
                              </h4>
                              <p className="text-[10px] text-slate-400 mt-0.5">{mov.materia_prima?.material} {mov.materia_prima?.color}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`font-mono font-black text-xs ${
                              isIngreso ? 'text-emerald-400' : 'text-slate-300'
                            }`}>
                              {isIngreso ? '+' : '-'}{Number(mov.cantidad_kg).toFixed(2)} Kg
                            </span>
                            <p className="text-[9px] text-slate-500 mt-0.5 font-mono">
                              {new Date(mov.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: STOCK REPUESTOS */}
          {activeTab === 'repuestos' && (
            <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4 animate-fadeIn">
              <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                🔧 Control de Inventario y Stock de Repuestos de Maquinaria
              </h2>

              <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-4">Nombre del Repuesto / Accesorio</th>
                      <th className="p-4 text-center">Stock Disponible (Unidades)</th>
                      <th className="p-4 text-right">Costo Unitario</th>
                      <th className="p-4 text-right">Valor Total en Stock</th>
                      <th className="p-4 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] text-slate-300">
                    {repuestos.map((rep) => {
                      const isLow = rep.stock_actual <= 5
                      return (
                        <tr key={rep.id} className="hover:bg-white/[0.01] transition-colors">
                          <td className="p-4 font-bold text-white">{rep.nombre}</td>
                          <td className="p-4 text-center font-mono font-bold text-sm text-white">{rep.stock_actual} Unid.</td>
                          <td className="p-4 text-right font-mono text-slate-400">S/ {Number(rep.costo_unitario).toFixed(2)}</td>
                          <td className="p-4 text-right font-mono font-bold text-white">S/ {(rep.stock_actual * rep.costo_unitario).toFixed(2)}</td>
                          <td className="p-4 text-center">
                            {isLow ? (
                              <span className="badge bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] py-1 px-2.5 font-bold animate-pulse">
                                Reabastecer (Bajo)
                              </span>
                            ) : (
                              <span className="badge bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] py-1 px-2.5 font-bold">
                                Óptimo
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: PAGO DIFERIDO / PROVEEDORES */}
          {activeTab === 'proveedores' && (
            <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4 animate-fadeIn">
              <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                📅 Cronograma de Pago Diferido a Proveedores (Cuentas por Pagar)
              </h2>

              <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-4">Vencimiento</th>
                      <th className="p-4">Proveedor</th>
                      <th className="p-4">Detalle de Compra</th>
                      <th className="p-4 text-right">Monto de Cuota</th>
                      <th className="p-4 text-center">Estado</th>
                      <th className="p-4 text-center">Fecha Pago</th>
                      <th className="p-4 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] text-slate-300">
                    {cuotasCompras.map((cuota) => (
                      <tr key={cuota.id} className="hover:bg-white/[0.01] transition-colors">
                        <td className="p-4 font-mono font-bold text-red-300">{cuota.fecha_vencimiento}</td>
                        <td className="p-4 font-bold text-white">{(cuota.compra as any)?.proveedores?.nombre || 'Desconocido'}</td>
                        <td className="p-4 text-slate-400">
                          {(cuota.compra as any)?.materia_prima?.material} {(cuota.compra as any)?.materia_prima?.color}
                        </td>
                        <td className="p-4 text-right font-mono font-black text-sm text-white">S/ {Number(cuota.monto).toFixed(2)}</td>
                        <td className="p-4 text-center">
                          <span className={`badge text-[9px] font-bold py-1 px-2.5 ${
                            cuota.estado === 'pagado' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
                          }`}>
                            {cuota.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="p-4 text-center font-mono text-slate-400">{cuota.fecha_pago || '-'}</td>
                        <td className="p-4 text-center">
                          {cuota.estado === 'pendiente' ? (
                            <button 
                              onClick={() => abrirModalPagarCuota(cuota)}
                              className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-[10px]"
                            >
                              Pagar Cuota
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500 font-bold flex items-center justify-center gap-1">
                              <Check className="w-3.5 h-3.5 text-emerald-400" /> Liquidado
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: EGRESOS */}
          {activeTab === 'egresos' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
              
              {/* Resumen Egresos */}
              <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4 lg:col-span-2">
                <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  💸 Egresos Generales Registrados (Outlays)
                </h2>

                <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-4">Fecha</th>
                        <th className="p-4">Concepto</th>
                        <th className="p-4">Categoría</th>
                        <th className="p-4 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04] text-slate-300">
                      {/* Egresos adicionales */}
                      {egresosAdicionales.map((e) => (
                        <tr key={e.id} className="hover:bg-white/[0.01] transition-colors">
                          <td className="p-4 font-mono text-slate-400">{e.fecha}</td>
                          <td className="p-4 font-bold text-white">{e.concepto}</td>
                          <td className="p-4 capitalize">
                            <span className="badge bg-slate-800 text-slate-300 border-white/5 py-1 px-2.5">
                              {e.categoria}
                            </span>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-red-300">S/ {Number(e.monto).toFixed(2)}</td>
                        </tr>
                      ))}
                      
                      {/* Compras recibidas como egresos de materia prima */}
                      {compras.filter(c => c.estado === 'recibida').map((c) => (
                        <tr key={c.id} className="hover:bg-white/[0.01] transition-colors">
                          <td className="p-4 font-mono text-slate-400">{c.fecha}</td>
                          <td className="p-4 font-bold text-white">Compra de Hilo: {c.materia_prima?.material} {c.materia_prima?.color}</td>
                          <td className="p-4 font-bold text-emerald-400">
                            <span className="badge bg-emerald-500/10 text-emerald-300 border-emerald-500/20 py-1 px-2.5">
                              materia prima
                            </span>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-red-300">S/ {Number(c.costo_total).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Estadísticas de Outlays */}
              <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl flex flex-col justify-between">
                <div className="space-y-4">
                  <h2 className="text-sm font-bold text-white tracking-tight">Desglose de Gastos en Planta</h2>
                  
                  <div className="space-y-4 text-xs">
                    <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/[0.05] flex justify-between items-center">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Materia Prima (Hilos)</p>
                        <h3 className="text-lg font-black text-white mt-1">S/ {egresosData.compras.toFixed(2)}</h3>
                      </div>
                      <Database className="w-7 h-7 text-emerald-400 opacity-60" />
                    </div>

                    <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/[0.05] flex justify-between items-center">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Mantenimiento y Reparaciones</p>
                        <h3 className="text-lg font-black text-white mt-1">S/ {egresosData.repairs.toFixed(2)}</h3>
                      </div>
                      <Wrench className="w-7 h-7 text-cyan-400 opacity-60" />
                    </div>

                    <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/[0.05] flex justify-between items-center">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Planillas, Alquileres y Servicios</p>
                        <h3 className="text-lg font-black text-white mt-1">S/ {egresosData.egresosAdic.toFixed(2)}</h3>
                      </div>
                      <CreditCard className="w-7 h-7 text-amber-400 opacity-60" />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/[0.08] mt-6">
                  <p className="text-[10px] text-slate-500 font-bold uppercase">Gasto Acumulado Total</p>
                  <h2 className="text-2xl font-black text-red-400 font-mono mt-1">S/ {egresosData.totalEgresos.toFixed(2)}</h2>
                </div>
              </div>

            </div>
          )}

          {/* TAB 5: BALANCE VENTAS VS EGRESOS */}
          {activeTab === 'balance' && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* KPIs Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Ingresos por Ventas */}
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Ingresos Recaudados (Ventas)</p>
                    <h2 className="text-3xl font-black text-emerald-400 mt-2 font-mono">S/ {balanceResultado.revenue.toFixed(2)}</h2>
                    <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-emerald-400" /> Cobros validados liquidados
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <DollarSign className="w-8 h-8" />
                  </div>
                </div>

                {/* Egresos */}
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Egresos y Gastos Totales</p>
                    <h2 className="text-3xl font-black text-red-400 mt-2 font-mono">S/ {balanceResultado.expenses.toFixed(2)}</h2>
                    <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3 text-red-400" /> Compras + Reparaciones + Fijos
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
                    <CreditCard className="w-8 h-8" />
                  </div>
                </div>

                {/* Balance Neto */}
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Utilidad y Balance Neto</p>
                    <h2 className={`text-3xl font-black mt-2 font-mono ${
                      balanceResultado.profit >= 0 ? 'text-cyan-400' : 'text-rose-400'
                    }`}>
                      S/ {balanceResultado.profit.toFixed(2)}
                    </h2>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Saldo Neto de Caja de la Fábrica
                    </p>
                  </div>
                  <div className={`p-4 rounded-2xl ${
                    balanceResultado.profit >= 0 ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    <BarChart3 className="w-8 h-8" />
                  </div>
                </div>

              </div>

              {/* Balance Chart */}
              <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl">
                <h2 className="text-sm font-bold text-white tracking-tight mb-6">📊 Comparativa Financiera: Ventas vs Egresos</h2>
                <div className="w-full h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px' }}
                        labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                      />
                      <Legend verticalAlign="top" height={36} />
                      <Bar dataKey="Ingresos" fill="#10b981" radius={[10, 10, 0, 0]} barSize={90} />
                      <Bar dataKey="Egresos" fill="#ef4444" radius={[10, 10, 0, 0]} barSize={90} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}
        </>
      )}

      {/* ── MODAL: AÑADIR HILO ──────────────────────────────────────────────── */}
      {showAddHiloModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">🧶 Registrar Nueva Fibra / Hilo</h2>
              <button onClick={() => setShowAddHiloModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleAddHilo} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">🧵 Fibra / Material</label>
                <input 
                  type="text" 
                  value={hiloForm.material} 
                  onChange={e => setHiloForm(prev => ({ ...prev, material: e.target.value }))}
                  placeholder="Ej: Algodón, Lana, Lycra, Poliéster" 
                  className="input-dark w-full text-sm py-2.5 font-bold"
                  required 
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🎨 Color</label>
                <input 
                  type="text" 
                  value={hiloForm.color} 
                  onChange={e => setHiloForm(prev => ({ ...prev, color: e.target.value }))}
                  placeholder="Ej: Blanco, Negro, Azul Marino" 
                  className="input-dark w-full text-sm py-2.5 font-bold"
                  required 
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">⚖️ Stock Inicial (Kg)</label>
                <input 
                  type="number" 
                  step="0.1"
                  value={hiloForm.stock_kg} 
                  onChange={e => setHiloForm(prev => ({ ...prev, stock_kg: e.target.value }))}
                  placeholder="Ej: 50.0" 
                  className="input-dark w-full text-sm py-2.5 font-bold"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowAddHiloModal(false)} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold text-white">
                  {saving ? 'Agregando...' : 'Agregar Hilo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: AÑADIR REPUESTO ─────────────────────────────────────────── */}
      {showAddRepuestoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">🔧 Añadir Nuevo Repuesto</h2>
              <button onClick={() => setShowAddRepuestoModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleAddRepuesto} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">🔧 Nombre del Repuesto</label>
                <input 
                  type="text" 
                  value={repuestoForm.nombre} 
                  onChange={e => setRepuestoForm(prev => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej: Sensor de aguja M8, Correa del motor" 
                  className="input-dark w-full text-sm py-2.5 font-bold"
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">🔢 Stock Inicial</label>
                  <input 
                    type="number" 
                    value={repuestoForm.stock_actual} 
                    onChange={e => setRepuestoForm(prev => ({ ...prev, stock_actual: e.target.value }))}
                    placeholder="Ej: 10" 
                    className="input-dark w-full text-sm py-2.5 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">💵 Costo Unitario (S/)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={repuestoForm.costo_unitario} 
                    onChange={e => setRepuestoForm(prev => ({ ...prev, costo_unitario: e.target.value }))}
                    placeholder="Ej: 45.00" 
                    className="input-dark w-full text-sm py-2.5 font-bold"
                    required 
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowAddRepuestoModal(false)} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center py-2.5 bg-cyan-600 border-none font-bold text-white">
                  {saving ? 'Registrando...' : 'Registrar Repuesto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: AÑADIR EGRESO ADICIONAL ──────────────────────────────────── */}
      {showAddEgresoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">💸 Registrar Egreso General</h2>
              <button onClick={() => setShowAddEgresoModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleAddEgreso} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">📝 Concepto / Detalle</label>
                <input 
                  type="text" 
                  value={egresoForm.concepto} 
                  onChange={e => setEgresoForm(prev => ({ ...prev, concepto: e.target.value }))}
                  placeholder="Ej: Pago de alquiler del local, Recibo de luz" 
                  className="input-dark w-full text-sm py-2.5 font-bold"
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">💵 Monto (S/)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={egresoForm.monto} 
                    onChange={e => setEgresoForm(prev => ({ ...prev, monto: e.target.value }))}
                    placeholder="Ej: 350.00" 
                    className="input-dark w-full text-sm py-2.5 font-bold"
                    required 
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">🏷️ Categoría</label>
                  <select 
                    value={egresoForm.categoria}
                    onChange={e => setEgresoForm(prev => ({ ...prev, categoria: e.target.value }))}
                    className="input-dark w-full text-sm py-2.5 font-bold"
                  >
                    <option value="planilla">Planilla Personal</option>
                    <option value="servicios">Servicios Básicos</option>
                    <option value="alquiler">Alquileres</option>
                    <option value="otros">Otros Gastos</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowAddEgresoModal(false)} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center py-2.5 bg-red-600 border-none font-bold text-white">
                  {saving ? 'Registrando...' : 'Registrar Gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: REGISTRAR COMPRA DE MATERIA PRIMA ─────────────────────────── */}
      {showCompraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">📦 Adquisición de Materia Prima</h2>
              <button onClick={() => setShowCompraModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleRegistrarCompra} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">🏢 Proveedor</label>
                <select 
                  value={compraForm.proveedor_id} 
                  onChange={e => setCompraForm(prev => ({ ...prev, proveedor_id: e.target.value }))}
                  className="input-dark w-full"
                  required
                >
                  <option value="">Selecciona el proveedor...</option>
                  {proveedores.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre} (RUC: {p.ruc})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🧵 Hilo / Algodón</label>
                <select 
                  value={compraForm.materia_prima_id} 
                  onChange={e => setCompraForm(prev => ({ ...prev, materia_prima_id: e.target.value }))}
                  className="input-dark w-full"
                  required
                >
                  <option value="">Selecciona tipo de insumo...</option>
                  {stockHilos.map(h => (
                    <option key={h.id} value={h.id}>{h.material} {h.color}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">⚖️ Cantidad (Kg)</label>
                  <input 
                    type="number" 
                    step="0.001" 
                    value={compraForm.cantidad_kg} 
                    onChange={e => setCompraForm(prev => ({ ...prev, cantidad_kg: e.target.value }))}
                    placeholder="Ej. 150.0" 
                    className="input-dark w-full"
                    required 
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">💵 Costo Total (S/)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={compraForm.costo_total} 
                    onChange={e => setCompraForm(prev => ({ ...prev, costo_total: e.target.value }))}
                    placeholder="Ej. 1200.0" 
                    className="input-dark w-full"
                    required 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">💳 Condición Pago</label>
                  <select 
                    value={compraForm.condicion_pago}
                    onChange={e => setCompraForm(prev => ({ ...prev, condicion_pago: e.target.value as any }))}
                    className="input-dark w-full"
                  >
                    <option value="contado">Al Contado</option>
                    <option value="pago_diferido">Pago Diferido (Crédito)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">💵 Método de Pago</label>
                  <select 
                    value={compraForm.metodo_pago}
                    onChange={e => setCompraForm(prev => ({ ...prev, metodo_pago: e.target.value }))}
                    className="input-dark w-full"
                  >
                    <option value="Transferencia">Transferencia</option>
                    <option value="Efectivo">Efectivo</option>
                    <option value="Yape/Plin">Yape/Plin</option>
                  </select>
                </div>
              </div>

              {compraForm.condicion_pago === 'pago_diferido' && (
                <div>
                  <label className="block text-slate-300 font-bold mb-1">🗓️ Número de Cuotas / Meses</label>
                  <input 
                    type="number" 
                    min="1"
                    max="12"
                    value={compraForm.cuotas_num} 
                    onChange={e => setCompraForm(prev => ({ ...prev, cuotas_num: e.target.value }))}
                    className="input-dark w-full font-mono font-bold"
                  />
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowCompraModal(false)} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold text-white">
                  {saving ? 'Registrando...' : 'Registrar Compra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: QC INSPECCIÓN ────────────────────────────────────────────── */}
      {showQcModal && selectedCompra && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">🔬 Control de Calidad e Inspección</h2>
              <button onClick={() => { setShowQcModal(false); setSelectedCompra(null) }} className="p-2 rounded-xl hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] mb-4 space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Proveedor:</span> <span className="font-bold text-white">{selectedCompra.proveedores?.nombre}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Hilo:</span> <span className="font-bold text-white">{selectedCompra.materia_prima?.material} {selectedCompra.materia_prima?.color}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Cantidad:</span> <span className="font-bold text-emerald-400 font-mono">{selectedCompra.cantidad_kg} Kg</span></div>
            </div>

            <form onSubmit={handleProcesarQC} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-2">Resultado del Control</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button" 
                    onClick={() => setQcForm(prev => ({ ...prev, aprobar: true }))}
                    className={`py-3.5 rounded-2xl font-bold flex flex-col items-center justify-center gap-2 border transition-all ${
                      qcForm.aprobar ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'glass border-white/[0.06] text-slate-400'
                    }`}
                  >
                    <Check className="w-5 h-5" /> Aprobar Ingreso
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setQcForm(prev => ({ ...prev, aprobar: false }))}
                    className={`py-3.5 rounded-2xl font-bold flex flex-col items-center justify-center gap-2 border transition-all ${
                      !qcForm.aprobar ? 'bg-red-500/10 border-red-500 text-red-400' : 'glass border-white/[0.06] text-slate-400'
                    }`}
                  >
                    <X className="w-5 h-5" /> Rechazar y Devolver
                  </button>
                </div>
              </div>

              {!qcForm.aprobar && (
                <div>
                  <label className="block text-slate-300 font-bold mb-1">⚠️ Justificación Técnica de Devolución</label>
                  <textarea 
                    value={qcForm.motivo_devolucion}
                    onChange={e => setQcForm(prev => ({ ...prev, motivo_devolucion: e.target.value }))}
                    className="input-dark w-full h-24 text-xs"
                    placeholder="Ej. Tensión irregular en el enrollado, peligro de rotura de aguja en tejedora."
                    required
                  />
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { setShowQcModal(false); setSelectedCompra(null) }} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className={`btn-primary flex-1 justify-center py-2.5 border-none font-bold ${
                  qcForm.aprobar ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                }`}>
                  {saving ? 'Procesando...' : qcForm.aprobar ? 'Confirmar Aprobación' : 'Registrar Devolución'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: LIQUIDAR CUOTA DE COMPRA ─────────────────────────────────── */}
      {showPayCuotaModal && selectedCuota && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">💵 Asentar Pago de Cuota</h2>
              <button onClick={() => { setShowPayCuotaModal(false); setSelectedCuota(null) }} className="p-2 rounded-xl hover:bg-white/10 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] mb-4 space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Proveedor:</span> <span className="font-bold text-white">{(selectedCuota.compra as any)?.proveedores?.nombre}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Monto Cuota:</span> <span className="font-bold text-amber-400 font-mono">S/ {selectedCuota.monto.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Vencimiento:</span> <span className="font-bold text-red-300 font-mono">{selectedCuota.fecha_vencimiento}</span></div>
            </div>

            <form onSubmit={handlePagarCuota} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">💵 Método de Pago utilizado</label>
                <select 
                  value={payCuotaForm.metodo_pago}
                  onChange={e => setPayCuotaForm(prev => ({ ...prev, metodo_pago: e.target.value }))}
                  className="input-dark w-full text-sm py-2.5 font-bold"
                >
                  <option value="Transferencia">Transferencia Bancaria</option>
                  <option value="Efectivo">Efectivo de Caja</option>
                  <option value="Yape/Plin">Yape/Plin</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🔗 Comprobante / Referencia URL (opcional)</label>
                <input 
                  type="text" 
                  value={payCuotaForm.comprobante_url}
                  onChange={e => setPayCuotaForm(prev => ({ ...prev, comprobante_url: e.target.value }))}
                  placeholder="https://link-a-comprobante.com/pago.pdf" 
                  className="input-dark w-full text-sm py-2.5 font-mono"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { setShowPayCuotaModal(false); setSelectedCuota(null) }} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center py-2.5 bg-amber-600 hover:bg-amber-500 border-none font-bold text-white">
                  {saving ? 'Registrando Pago...' : 'Registrar Pago de Cuota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
