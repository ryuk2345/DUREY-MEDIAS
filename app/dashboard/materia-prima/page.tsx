'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { 
  Database, Plus, Check, X, RefreshCw, Truck, FileText, AlertTriangle, 
  TrendingUp, TrendingDown, CreditCard, DollarSign, BarChart3, Wrench, Info, Scale, ShoppingCart
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
    proveedor_id: string
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
  const [usingFallback, setUsingFallback] = useState(false)
  
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
  const [showAddProveedorModal, setShowAddProveedorModal] = useState(false)
  const [showAdjustRepuestoModal, setShowAdjustRepuestoModal] = useState(false)
  const [selectedRepuesto, setSelectedRepuesto] = useState<Repuesto | null>(null)

  // Forms
  const [hiloForm, setHiloForm] = useState({ material: '', color: '', stock_kg: '' })
  const [repuestoForm, setRepuestoForm] = useState({ nombre: '', stock_actual: '', costo_unitario: '' })
  const [egresoForm, setEgresoForm] = useState({ concepto: '', monto: '', categoria: 'planilla' })
  const [payCuotaForm, setPayCuotaForm] = useState({ metodo_pago: 'Transferencia', comprobante_url: '' })
  const [proveedorForm, setProveedorForm] = useState({ nombre: '', ruc: '', contacto: '', telefono: '' })
  const [adjustRepuestoForm, setAdjustRepuestoForm] = useState({ tipo: 'ingreso', cantidad: '', motivo: '' })
  
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

  // ── MOCK DATA INICIAL (FALLBACK LOCALSTORAGE) ──────────────────────────────
  const initLocalStorageData = () => {
    if (typeof window === 'undefined') return
    
    if (!localStorage.getItem('durey_materia_prima')) {
      localStorage.setItem('durey_materia_prima', JSON.stringify([
        { id: 'h1', material: 'Algodón', color: 'Blanco', stock_kg: 150.000, created_at: new Date().toISOString() },
        { id: 'h2', material: 'Algodón', color: 'Negro', stock_kg: 120.000, created_at: new Date().toISOString() },
        { id: 'h3', material: 'Algodón', color: 'Rojo', stock_kg: 2.000, created_at: new Date().toISOString() },
        { id: 'h4', material: 'Lana', color: 'Roja', stock_kg: 0.000, created_at: new Date().toISOString() },
        { id: 'h5', material: 'Lycra', color: 'Blanco', stock_kg: 50.000, created_at: new Date().toISOString() }
      ]))
    }
    
    if (!localStorage.getItem('durey_proveedores')) {
      localStorage.setItem('durey_proveedores', JSON.stringify([
        { id: 'p1', nombre: 'Hilados del Sur', ruc: '20123456789', contacto: 'Roberto Cárdenas', telefono: '987654321' },
        { id: 'p2', nombre: 'Textiles Andinos', ruc: '20987654321', contacto: 'Ana Torres', telefono: '912345678' }
      ]))
    }
    
    if (!localStorage.getItem('durey_repuestos')) {
      localStorage.setItem('durey_repuestos', JSON.stringify([
        { id: 'r1', nombre: 'Sensor de aguja M8', stock_actual: 15, costo_unitario: 45.00, created_at: new Date().toISOString() },
        { id: 'r2', nombre: 'Plancha de hormado T1', stock_actual: 3, costo_unitario: 250.00, created_at: new Date().toISOString() },
        { id: 'r3', nombre: 'Correa dentada de motor', stock_actual: 8, costo_unitario: 35.00, created_at: new Date().toISOString() },
        { id: 'r4', nombre: 'Agujas tejedora calibre 12', stock_actual: 200, costo_unitario: 1.50, created_at: new Date().toISOString() }
      ]))
    }

    if (!localStorage.getItem('durey_egresos_adicionales')) {
      localStorage.setItem('durey_egresos_adicionales', JSON.stringify([
        { id: 'e1', concepto: 'Pago de alquiler local agosto', monto: 2500.00, fecha: new Date(Date.now() - 864000000).toISOString().split('T')[0], categoria: 'alquiler', created_at: new Date().toISOString() },
        { id: 'e2', concepto: 'Recibo de luz del taller', monto: 450.00, fecha: new Date(Date.now() - 432000000).toISOString().split('T')[0], categoria: 'servicios', created_at: new Date().toISOString() },
        { id: 'e3', concepto: 'Pago de planilla semanal tejedores', monto: 1800.00, fecha: new Date(Date.now() - 172800000).toISOString().split('T')[0], categoria: 'planilla', created_at: new Date().toISOString() },
        { id: 'e4', concepto: 'Bolsas plásticas de empaque Durey', monto: 350.00, fecha: new Date().toISOString().split('T')[0], categoria: 'empaque', created_at: new Date().toISOString() }
      ]))
    }

    if (!localStorage.getItem('durey_compras')) {
      localStorage.setItem('durey_compras', JSON.stringify([]))
    }

    if (!localStorage.getItem('durey_cuotas_compras')) {
      localStorage.setItem('durey_cuotas_compras', JSON.stringify([]))
    }

    if (!localStorage.getItem('durey_movimientos')) {
      localStorage.setItem('durey_movimientos', JSON.stringify([]))
    }
  }

  // ── CARGAR DATOS (CON RESILIENCIA A LOCALSTORAGE) ─────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    initLocalStorageData()
    try {
      // 1. Intentar cargar desde Supabase
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

      // Si hay error de esquema (tablas no creadas), forzar fallback
      if (hilosRes.error || provRes.error || repRes.error) {
        throw new Error('Tablas no encontradas en base de datos. Usando almacenamiento local alternativo.')
      }

      setStockHilos(hilosRes.data ?? [])
      setProveedores(provRes.data ?? [])
      setCompras((comprasRes.data ?? []) as unknown as Compra[])
      setMovimientos((movRes.data ?? []) as unknown as Movimiento[])
      setRepuestos(repRes.data ?? [])
      setCuotasCompras((cuotasRes.data ?? []) as unknown as CuotaCompra[])
      setEgresosAdicionales(egresosRes.data ?? [])
      setUsingFallback(false)
      
      const totalRecaudadoVentas = (ventasRes.data ?? []).reduce((s, c) => s + c.monto, 0)
      const totalReparaciones = (repairsRes.data ?? []).reduce((s, r) => s + (Number(r.costo_total) || 0), 0)
      setVentasTotal(totalRecaudadoVentas)
      setRepairsTotal(totalReparaciones)

    } catch (err: any) {
      console.warn('Supabase error, falling back to LocalStorage:', err.message)
      setUsingFallback(true)
      
      // Cargar desde LocalStorage
      const localHilos = JSON.parse(localStorage.getItem('durey_materia_prima') || '[]')
      const localProv = JSON.parse(localStorage.getItem('durey_proveedores') || '[]')
      const localRep = JSON.parse(localStorage.getItem('durey_repuestos') || '[]')
      const localEgresos = JSON.parse(localStorage.getItem('durey_egresos_adicionales') || '[]')
      const localCompras = JSON.parse(localStorage.getItem('durey_compras') || '[]')
      const localCuotas = JSON.parse(localStorage.getItem('durey_cuotas_compras') || '[]')
      const localMovs = JSON.parse(localStorage.getItem('durey_movimientos') || '[]')

      // Mapear relaciones simuladas en compras
      const comprasMapeadas = localCompras.map((c: any) => ({
        ...c,
        proveedores: localProv.find((p: any) => p.id === c.proveedor_id),
        materia_prima: localHilos.find((h: any) => h.id === c.materia_prima_id)
      }))

      // Mapear relaciones simuladas en cuotas
      const cuotasMapeadas = localCuotas.map((q: any) => {
        const cmp = comprasMapeadas.find((c: any) => c.id === q.compra_id)
        return {
          ...q,
          compra: cmp
        }
      })

      // Mapear relaciones simuladas en movimientos
      const movsMapeados = localMovs.map((m: any) => ({
        ...m,
        materia_prima: localHilos.find((h: any) => h.id === m.materia_prima_id)
      }))

      setStockHilos(localHilos)
      setProveedores(localProv)
      setRepuestos(localRep)
      setEgresosAdicionales(localEgresos)
      setCompras(comprasMapeadas)
      setCuotasCompras(cuotasMapeadas)
      setMovimientos(movsMapeados)
      
      // Valores de ventas y reparaciones simulados
      setVentasTotal(18500)
      setRepairsTotal(1250)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // Helper para guardar localmente
  const saveToLocal = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data))
  }

  // ── AÑADIR NUEVO HILO / ALGODÓN ──────────────────────────────────────────
  const handleAddHilo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hiloForm.material || !hiloForm.color) {
      toast.error('Material y color son obligatorios')
      return
    }

    setSaving(true)
    const newHilo = {
      id: Math.random().toString(),
      material: hiloForm.material.trim(),
      color: hiloForm.color.trim(),
      stock_kg: parseFloat(hiloForm.stock_kg || '0'),
      created_at: new Date().toISOString()
    }

    try {
      if (!usingFallback) {
        const { error } = await supabase.from('materia_prima').insert({
          material: newHilo.material,
          color: newHilo.color,
          stock_kg: newHilo.stock_kg
        })
        if (error) throw error
      } else {
        const list = [...stockHilos, newHilo]
        saveToLocal('durey_materia_prima', list)
      }

      toast.success('🧶 Nuevo tipo de fibra/hilo agregado al almacén')
      setShowAddHiloModal(false)
      setHiloForm({ material: '', color: '', stock_kg: '' })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al registrar hilo: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── REGISTRAR PROVEEDOR ──────────────────────────────────────────────────
  const handleAddProveedor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!proveedorForm.nombre) {
      toast.error('El nombre del proveedor es obligatorio')
      return
    }

    setSaving(true)
    const newProv = {
      id: Math.random().toString(),
      nombre: proveedorForm.nombre.trim(),
      ruc: proveedorForm.ruc.trim(),
      contacto: proveedorForm.contacto.trim(),
      telefono: proveedorForm.telefono.trim()
    }

    try {
      if (!usingFallback) {
        const { error } = await supabase.from('proveedores').insert(newProv)
        if (error) throw error
      } else {
        const list = [...proveedores, newProv]
        saveToLocal('durey_proveedores', list)
      }

      toast.success('🏢 Proveedor registrado exitosamente')
      setShowAddProveedorModal(false)
      setProveedorForm({ nombre: '', ruc: '', contacto: '', telefono: '' })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al registrar proveedor: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── REGISTRAR NUEVO REPUESTO ──────────────────────────────────────────────
  const handleAddRepuesto = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repuestoForm.nombre || !repuestoForm.costo_unitario) {
      toast.error('Nombre y costo unitario son obligatorios')
      return
    }

    setSaving(true)
    const newRep = {
      id: Math.random().toString(),
      nombre: repuestoForm.nombre.trim(),
      stock_actual: parseInt(repuestoForm.stock_actual || '0'),
      costo_unitario: parseFloat(repuestoForm.costo_unitario),
      created_at: new Date().toISOString()
    }

    try {
      if (!usingFallback) {
        const { error } = await supabase.from('repuestos').insert({
          nombre: newRep.nombre,
          stock_actual: newRep.stock_actual,
          costo_unitario: newRep.costo_unitario
        })
        if (error) throw error
      } else {
        const list = [...repuestos, newRep]
        saveToLocal('durey_repuestos', list)
      }

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

  // ── AJUSTAR STOCK DE REPUESTOS ───────────────────────────────────────────
  const abrirModalAjusteRepuesto = (rep: Repuesto) => {
    setSelectedRepuesto(rep)
    setAdjustRepuestoForm({ tipo: 'ingreso', cantidad: '', motivo: '' })
    setShowAdjustRepuestoModal(true)
  }

  const handleAdjustRepuesto = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRepuesto || !adjustRepuestoForm.cantidad) return

    setSaving(true)
    const cant = parseInt(adjustRepuestoForm.cantidad)
    const delta = adjustRepuestoForm.tipo === 'ingreso' ? cant : -cant
    const newStock = Math.max(0, selectedRepuesto.stock_actual + delta)

    try {
      if (!usingFallback) {
        const { error } = await supabase
          .from('repuestos')
          .update({ stock_actual: newStock })
          .eq('id', selectedRepuesto.id)

        if (error) throw error

        // Registrar costo de repuestos como egreso si es salida
        if (adjustRepuestoForm.tipo === 'salida') {
          await supabase.from('egresos_adicionales').insert({
            concepto: `Consumo repuesto: ${selectedRepuesto.nombre} (${cant} uds.) — ${adjustRepuestoForm.motivo || 'Mantenimiento'}`,
            monto: cant * selectedRepuesto.costo_unitario,
            categoria: 'repuestos',
            fecha: new Date().toISOString().split('T')[0]
          })
        }
      } else {
        const list = repuestos.map(r => r.id === selectedRepuesto.id ? { ...r, stock_actual: newStock } : r)
        saveToLocal('durey_repuestos', list)

        if (adjustRepuestoForm.tipo === 'salida') {
          const egresos = JSON.parse(localStorage.getItem('durey_egresos_adicionales') || '[]')
          egresos.push({
            id: Math.random().toString(),
            concepto: `Consumo repuesto: ${selectedRepuesto.nombre} (${cant} uds.) — ${adjustRepuestoForm.motivo || 'Mantenimiento'}`,
            monto: cant * selectedRepuesto.costo_unitario,
            categoria: 'repuestos',
            fecha: new Date().toISOString().split('T')[0],
            created_at: new Date().toISOString()
          })
          saveToLocal('durey_egresos_adicionales', egresos)
        }
      }

      toast.success('🔧 Stock de repuesto ajustado correctamente')
      setShowAdjustRepuestoModal(false)
      setSelectedRepuesto(null)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al ajustar repuesto: ${err.message}`)
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
    const newEgreso = {
      id: Math.random().toString(),
      concepto: egresoForm.concepto.trim(),
      monto: parseFloat(egresoForm.monto),
      categoria: egresoForm.categoria,
      fecha: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    }

    try {
      if (!usingFallback) {
        const { error } = await supabase.from('egresos_adicionales').insert({
          concepto: newEgreso.concepto,
          monto: newEgreso.monto,
          categoria: newEgreso.categoria,
          fecha: newEgreso.fecha
        })
        if (error) throw error
      } else {
        const list = [...egresosAdicionales, newEgreso]
        saveToLocal('durey_egresos_adicionales', list)
      }

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

  // ── REGISTRAR COMPRA DE MATERIA PRIMA ─────────────────────────────────────
  const handleRegistrarCompra = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!compraForm.proveedor_id || !compraForm.materia_prima_id || !compraForm.cantidad_kg || !compraForm.costo_total) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    setSaving(true)
    const newComp = {
      id: Math.random().toString(),
      proveedor_id: compraForm.proveedor_id,
      materia_prima_id: compraForm.materia_prima_id,
      cantidad_kg: parseFloat(compraForm.cantidad_kg),
      costo_total: parseFloat(compraForm.costo_total),
      condicion_pago: compraForm.condicion_pago,
      metodo_pago: compraForm.metodo_pago,
      estado: 'pendiente' as 'pendiente',
      motivo_devolucion: null,
      fecha: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    }

    try {
      if (!usingFallback) {
        const { data: compra, error } = await supabase.from('compras_materia_prima').insert({
          proveedor_id: newComp.proveedor_id,
          materia_prima_id: newComp.materia_prima_id,
          cantidad_kg: newComp.cantidad_kg,
          costo_total: newComp.costo_total,
          condicion_pago: newComp.condicion_pago,
          metodo_pago: newComp.metodo_pago,
          estado: 'pendiente'
        }).select().single()

        if (error) throw error

        // Pago diferido cuotas
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
      } else {
        const list = JSON.parse(localStorage.getItem('durey_compras') || '[]')
        list.push(newComp)
        saveToLocal('durey_compras', list)

        if (compraForm.condicion_pago === 'pago_diferido') {
          const total = parseFloat(compraForm.costo_total)
          const cuotasNum = parseInt(compraForm.cuotas_num) || 3
          const montoCuota = total / cuotasNum
          const listCuotas = JSON.parse(localStorage.getItem('durey_cuotas_compras') || '[]')
          
          const hoy = new Date()
          for (let i = 1; i <= cuotasNum; i++) {
            const due = new Date(hoy.getFullYear(), hoy.getMonth() + i, hoy.getDate())
            listCuotas.push({
              id: Math.random().toString(),
              compra_id: newComp.id,
              monto: parseFloat(montoCuota.toFixed(2)),
              fecha_vencimiento: due.toISOString().split('T')[0],
              estado: 'pendiente',
              fecha_pago: null,
              metodo_pago: null,
              comprobante_url: null
            })
          }
          saveToLocal('durey_cuotas_compras', listCuotas)
        }
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

  const abrirModalQC = (compra: Compra) => {
    setSelectedCompra(compra)
    setQcForm({ aprobar: true, motivo_devolucion: '' })
    setShowQcModal(true)
  }

  const abrirModalPagarCuota = (cuota: CuotaCompra) => {
    setSelectedCuota(cuota)
    setPayCuotaForm({ metodo_pago: 'Transferencia', comprobante_url: '' })
    setShowPayCuotaModal(true)
  }

  // ── CONTROL DE CALIDAD (APROBAR/RECHAZAR) ──────────────────────────────────
  const handleProcesarQC = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCompra) return

    if (!qcForm.aprobar && !qcForm.motivo_devolucion.trim()) {
      toast.error('Debes ingresar la justificación técnica de la devolución')
      return
    }

    setSaving(true)
    const nuevoEstado = qcForm.aprobar ? 'recibida' : 'devuelta'
    const motivo = qcForm.aprobar ? null : qcForm.motivo_devolucion

    try {
      if (!usingFallback) {
        const { error: updErr } = await supabase
          .from('compras_materia_prima')
          .update({ estado: nuevoEstado, motivo_devolucion: motivo })
          .eq('id', selectedCompra.id)

        if (updErr) throw updErr

        if (qcForm.aprobar) {
          const hilo = stockHilos.find(h => h.id === selectedCompra.materia_prima_id)
          const nuevoStock = Number(hilo?.stock_kg || 0) + Number(selectedCompra.cantidad_kg)

          await supabase.from('materia_prima').update({ stock_kg: nuevoStock }).eq('id', selectedCompra.materia_prima_id)
          await supabase.from('movimientos_materia_prima').insert({
            materia_prima_id: selectedCompra.materia_prima_id,
            tipo: 'ingreso_compra',
            cantidad_kg: selectedCompra.cantidad_kg,
            referencia_id: selectedCompra.id
          })
        } else {
          await supabase.from('movimientos_materia_prima').insert({
            materia_prima_id: selectedCompra.materia_prima_id,
            tipo: 'devolucion',
            cantidad_kg: selectedCompra.cantidad_kg,
            referencia_id: selectedCompra.id
          })
        }
      } else {
        // Fallback local
        const list = JSON.parse(localStorage.getItem('durey_compras') || '[]')
        const updated = list.map((c: any) => c.id === selectedCompra.id ? { ...c, estado: nuevoEstado, motivo_devolucion: motivo } : c)
        saveToLocal('durey_compras', updated)

        if (qcForm.aprobar) {
          const hilos = stockHilos.map(h => {
            if (h.id === selectedCompra.materia_prima_id) {
              return { ...h, stock_kg: Number(h.stock_kg || 0) + Number(selectedCompra.cantidad_kg) }
            }
            return h
          })
          saveToLocal('durey_materia_prima', hilos)

          const movs = JSON.parse(localStorage.getItem('durey_movimientos') || '[]')
          movs.push({
            id: Math.random().toString(),
            materia_prima_id: selectedCompra.materia_prima_id,
            tipo: 'ingreso_compra',
            cantidad_kg: selectedCompra.cantidad_kg,
            referencia_id: selectedCompra.id,
            created_at: new Date().toISOString()
          })
          saveToLocal('durey_movimientos', movs)
        } else {
          const movs = JSON.parse(localStorage.getItem('durey_movimientos') || '[]')
          movs.push({
            id: Math.random().toString(),
            materia_prima_id: selectedCompra.materia_prima_id,
            tipo: 'devolucion',
            cantidad_kg: selectedCompra.cantidad_kg,
            referencia_id: selectedCompra.id,
            created_at: new Date().toISOString()
          })
          saveToLocal('durey_movimientos', movs)
        }
      }

      toast.success(qcForm.aprobar ? '✅ Entrega aprobada e ingresada al inventario.' : '❌ Entrega devuelta al proveedor.')
      setShowQcModal(false)
      setSelectedCompra(null)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al procesar QC: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── PAGAR CUOTA DE COMPRA ────────────────────────────────────────────────
  const handlePagarCuota = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCuota) return

    setSaving(true)
    const fecha = new Date().toISOString().split('T')[0]
    try {
      if (!usingFallback) {
        const { error } = await supabase
          .from('cuotas_compras')
          .update({
            estado: 'pagado',
            fecha_pago: fecha,
            metodo_pago: payCuotaForm.metodo_pago,
            comprobante_url: payCuotaForm.comprobante_url || null
          })
          .eq('id', selectedCuota.id)

        if (error) throw error
      } else {
        const list = JSON.parse(localStorage.getItem('durey_cuotas_compras') || '[]')
        const updated = list.map((q: any) => q.id === selectedCuota.id ? {
          ...q,
          estado: 'pagado',
          fecha_pago: fecha,
          metodo_pago: payCuotaForm.metodo_pago,
          comprobante_url: payCuotaForm.comprobante_url || null
        } : q)
        saveToLocal('durey_cuotas_compras', updated)
      }

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

  // ── CALCULAR SUGERENCIAS DE COMPRAS Y SALDOS PENDIENTES ──────────────────
  const stockSugerencias = useMemo(() => {
    return stockHilos.filter(h => h.stock_kg < 20.0)
  }, [stockHilos])

  const proveedoresSaldos = useMemo(() => {
    const saldos: Record<string, { ruc: string; nombre: string; total: number; pagado: number; saldo: number }> = {}
    
    proveedores.forEach(p => {
      saldos[p.id] = { ruc: p.ruc, nombre: p.nombre, total: 0, pagado: 0, saldo: 0 }
    })

    // Sumar por cuotas asociadas a compras
    cuotasCompras.forEach(q => {
      const comp = q.compra
      if (comp) {
        const pId = comp.proveedor_id
        if (saldos[pId]) {
          saldos[pId].total += Number(q.monto)
          if (q.estado === 'pagado') {
            saldos[pId].pagado += Number(q.monto)
          } else {
            saldos[pId].saldo += Number(q.monto)
          }
        }
      }
    })

    return Object.values(saldos).filter(s => s.total > 0)
  }, [proveedores, cuotasCompras])

  const balanceCompleto = useMemo(() => {
    // Egresos por compras recibidas
    const comprasCostos = compras
      .filter(c => c.estado === 'recibida')
      .reduce((s, c) => s + c.costo_total, 0)
      
    // Egresos adicionales
    const egresosAdic = egresosAdicionales
      .reduce((s, e) => s + e.monto, 0)

    const totalEgresos = comprasCostos + repairsTotal + egresosAdic
    const margin = ventasTotal > 0 ? ((ventasTotal - totalEgresos) / ventasTotal) * 100 : 0

    return {
      revenue: ventasTotal,
      expenses: totalEgresos,
      profit: ventasTotal - totalEgresos,
      margin: Math.max(-100, Math.min(100, margin))
    }
  }, [compras, egresosAdicionales, repairsTotal, ventasTotal])

  const egresosData = useMemo(() => {
    // Egresos por compras recibidas
    const comprasCostos = compras
      .filter(c => c.estado === 'recibida')
      .reduce((s, c) => s + c.costo_total, 0)
      
    // Egresos adicionales
    const egresosAdic = egresosAdicionales
      .reduce((s, e) => s + e.monto, 0)

    const totalEgresos = comprasCostos + repairsTotal + egresosAdic

    return {
      compras: comprasCostos,
      repairs: repairsTotal,
      totalEgresos
    }
  }, [compras, egresosAdicionales, repairsTotal])

  const chartData = useMemo(() => {
    return [
      {
        name: 'Ventas vs Egresos',
        Ingresos: balanceCompleto.revenue,
        Egresos: balanceCompleto.expenses
      }
    ]
  }, [balanceCompleto])

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* Fallback Banner */}
      {usingFallback && (
        <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-bold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 animate-bounce flex-shrink-0" />
          <span>Ejecutando en Modo de Almacenamiento Local (LocalStorage). Por favor, ejecuta las migraciones SQL `003` y `004` en tu Supabase SQL Editor para guardar en la nube.</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Gestión de Materia Prima y Caja</h1>
            <p className="text-slate-400 text-xs font-medium">Control de stock de hilados, proveedores a crédito, cronogramas de pagos, egresos y balance de márgenes de fábrica</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {activeTab === 'hilos' && (
            <>
              <button 
                type="button"
                onClick={() => setShowAddProveedorModal(true)} 
                className="btn-secondary text-xs py-2.5 px-4 rounded-2xl border-white/[0.08] text-slate-300 font-bold"
              >
                + Registrar Proveedor
              </button>
              <button 
                type="button"
                onClick={() => setShowAddHiloModal(true)} 
                className="btn-secondary text-xs py-2.5 px-4 rounded-2xl border-white/[0.08] text-slate-300 font-bold"
              >
                + Añadir Hilo / Algodón
              </button>
              <button 
                type="button"
                onClick={() => setShowCompraModal(true)} 
                className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 border-none flex items-center gap-1.5 font-bold shadow-lg shadow-emerald-600/20"
              >
                <Plus className="w-4 h-4" /> Registrar Compra
              </button>
            </>
          )}

          {activeTab === 'repuestos' && (
            <button 
              type="button"
              onClick={() => setShowAddRepuestoModal(true)} 
              className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-cyan-600 hover:bg-cyan-500 border-none flex items-center gap-1.5 font-bold shadow-lg"
            >
              + Nuevo Repuesto
            </button>
          )}

          {activeTab === 'egresos' && (
            <button 
              type="button"
              onClick={() => setShowAddEgresoModal(true)} 
              className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-red-600 hover:bg-red-500 border-none flex items-center gap-1.5 font-bold shadow-lg"
            >
              + Registrar Egreso
            </button>
          )}

          <button 
            type="button"
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
          type="button"
          onClick={() => setActiveTab('hilos')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'hilos' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          🧶 Materia Prima
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('repuestos')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'repuestos' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          🔧 Stock Repuestos
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('proveedores')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'proveedores' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          📅 Cuentas por Pagar (Proveedores)
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('egresos')} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'egresos' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          💸 Egresos
        </button>
        <button 
          type="button"
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
                    🧵 Almacén de Hilos, Fibras y Algodón
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
                          const isCritical = hilo.stock_kg < 20.0
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
                                    <AlertTriangle className="w-3 h-3" /> Pedir Más (&lt;20kg)
                                  </span>
                                ) : (
                                  <span className="badge bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] py-1 px-2.5 font-bold">
                                    Suficiente
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
                    <Truck className="w-4 h-4 text-emerald-400" /> Registro de Entregas e Inspección
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
                            <td className="p-4 text-center capitalize">{compra.condicion_pago === 'pago_diferido' ? 'A Crédito' : 'Contado'}</td>
                            <td className="p-4 text-center">
                              <span className={`badge text-[9px] font-bold py-1 px-2.5 ${
                                compra.estado === 'recibida' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                                compra.estado === 'devuelta' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                                'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              }`}>
                                {compra.estado === 'recibida' ? 'Entregada' :
                                 compra.estado === 'devuelta' ? 'Devuelta' : 'Pendiente QC'}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              {compra.estado === 'pendiente' ? (
                                <button 
                                  type="button"
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

              {/* Sugerencias de Pedido de Insumos */}
              <div className="space-y-6">
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    💡 Sugerencias de Pedido (Mandados a pedir más)
                  </h2>

                  <div className="space-y-3.5">
                    {stockSugerencias.map((h) => (
                      <div key={h.id} className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex flex-col justify-between gap-3">
                        <div className="flex gap-3 items-start">
                          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <h3 className="text-xs font-bold text-white">{h.material} {h.color}</h3>
                            <p className="text-[10px] text-slate-400 mt-1">El stock actual es de solo <strong>{Number(h.stock_kg).toFixed(3)} Kg</strong> (Crítico &lt;20kg).</p>
                          </div>
                        </div>
                        <button 
                          type="button"
                          onClick={() => {
                            setCompraForm(prev => ({ ...prev, materia_prima_id: h.id }))
                            setShowCompraModal(true)
                          }}
                          className="w-full py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-[10px] tracking-wide"
                        >
                          Generar Pedido de Reabastecimiento
                        </button>
                      </div>
                    ))}
                    {stockSugerencias.length === 0 && (
                      <div className="p-6 text-center text-slate-400 text-xs">
                        ✨ Todos los hilos tienen stock suficiente.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: STOCK DE REPUESTOS */}
          {activeTab === 'repuestos' && (
            <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4 animate-fadeIn">
              <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                🔧 Repuestos Mecánicos (Agujas, Hormas, Sensores, etc.)
              </h2>

              <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-4">Descripción del Repuesto</th>
                      <th className="p-4 text-center">Stock Físico (Unidades)</th>
                      <th className="p-4 text-right">Costo Unitario</th>
                      <th className="p-4 text-right">Valor Inventariado</th>
                      <th className="p-4 text-center">Estado</th>
                      <th className="p-4 text-center">Ajustar</th>
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
                                Reordenar Stock
                              </span>
                            ) : (
                              <span className="badge bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] py-1 px-2.5 font-bold">
                                Óptimo
                              </span>
                            )}
                          </td>
                          <td className="p-4 text-center">
                            <button 
                              type="button"
                              onClick={() => abrirModalAjusteRepuesto(rep)}
                              className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-bold"
                            >
                              Ingreso / Salida
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: CUENTAS POR PAGAR (PAGO DIFERIDO Y SALDOS) */}
          {activeTab === 'proveedores' && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* Saldos por Proveedor */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {proveedoresSaldos.map((s) => (
                  <div key={s.ruc} className="glass p-5 rounded-3xl border border-white/[0.08] flex justify-between items-center shadow-md">
                    <div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Deuda / Saldo Pendiente</p>
                      <h3 className="text-base font-black text-white mt-1">{s.nombre}</h3>
                      <p className="text-[10px] text-slate-400 mt-0.5">RUC: {s.ruc}</p>
                      <p className="text-xs font-bold text-red-400 mt-2 font-mono">S/ {s.saldo.toFixed(2)} pendiente</p>
                    </div>
                    <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-center font-mono font-black text-sm">
                      S/ {s.total.toFixed(0)}
                      <span className="block text-[8px] font-bold text-slate-500 mt-0.5">TOTAL CRÉDITO</span>
                    </div>
                  </div>
                ))}
                {proveedoresSaldos.length === 0 && (
                  <div className="p-6 text-center text-slate-500 text-xs col-span-full">
                    ✨ No tienes deudas o saldos pendientes de pago diferido con ningún proveedor de materia prima.
                  </div>
                )}
              </div>

              {/* Cronograma de Cuotas */}
              <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
                <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  📅 Fechas y Calendario de Cuotas por Vencer (Cronograma de Créditos)
                </h2>

                <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-4">F. Vencimiento</th>
                        <th className="p-4">Proveedor</th>
                        <th className="p-4">Materia Prima / Fibra</th>
                        <th className="p-4 text-right">Monto de Cuota</th>
                        <th className="p-4 text-center">Estado</th>
                        <th className="p-4 text-center">Liquidación</th>
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
                                type="button"
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

            </div>
          )}

          {/* TAB 4: EGRESOS GENERALES */}
          {activeTab === 'egresos' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
              
              {/* Listado de Gastos */}
              <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4 lg:col-span-2">
                <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  💸 Gastos y Egresos Mapeados (Bolsas, Repuestos, Servicios, etc.)
                </h2>

                <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-4">Fecha</th>
                        <th className="p-4">Detalle / Concepto</th>
                        <th className="p-4">Categoría</th>
                        <th className="p-4 text-right">Monto Gastado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04] text-slate-300">
                      {/* Egresos adicionales */}
                      {egresosAdicionales.map((e) => (
                        <tr key={e.id} className="hover:bg-white/[0.01] transition-colors">
                          <td className="p-4 font-mono text-slate-400">{e.fecha}</td>
                          <td className="p-4 font-bold text-white">{e.concepto}</td>
                          <td className="p-4 capitalize">
                            <span className={`badge py-1 px-2.5 font-bold text-[9px] ${
                              e.categoria === 'planilla' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' :
                              e.categoria === 'servicios' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
                              e.categoria === 'empaque' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                              e.categoria === 'repuestos' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                              'bg-slate-800 text-slate-300 border-white/5'
                            }`}>
                              {e.categoria}
                            </span>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-red-300">S/ {Number(e.monto).toFixed(2)}</td>
                        </tr>
                      ))}
                      
                      {/* Compras de materias primas liquidadas */}
                      {compras.filter(c => c.estado === 'recibida').map((c) => (
                        <tr key={c.id} className="hover:bg-white/[0.01] transition-colors">
                          <td className="p-4 font-mono text-slate-400">{c.fecha}</td>
                          <td className="p-4 font-bold text-white">Materia Prima: {c.materia_prima?.material} {c.materia_prima?.color}</td>
                          <td className="p-4">
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
                  <h2 className="text-sm font-bold text-white tracking-tight">Clasificación de Gastos en Planta</h2>
                  
                  <div className="space-y-4 text-xs">
                    <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/[0.05] flex justify-between items-center">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Materia Prima (Fibras / Hilos)</p>
                        <h3 className="text-lg font-black text-white mt-1">S/ {egresosData.compras.toFixed(2)}</h3>
                      </div>
                      <Database className="w-7 h-7 text-emerald-400 opacity-60" />
                    </div>

                    <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/[0.05] flex justify-between items-center">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Repuestos y Mantenimiento</p>
                        <h3 className="text-lg font-black text-white mt-1">
                          S/ {(egresosData.repairs + egresosAdicionales.filter(e => e.categoria === 'repuestos').reduce((s, e) => s + e.monto, 0)).toFixed(2)}
                        </h3>
                      </div>
                      <Wrench className="w-7 h-7 text-cyan-400 opacity-60" />
                    </div>

                    <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/[0.05] flex justify-between items-center">
                      <div>
                        <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Empaque (Bolsas/Etiquetas)</p>
                        <h3 className="text-lg font-black text-white mt-1">
                          S/ {egresosAdicionales.filter(e => e.categoria === 'empaque').reduce((s, e) => s + e.monto, 0).toFixed(2)}
                        </h3>
                      </div>
                      <FileText className="w-7 h-7 text-emerald-400 opacity-60" />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/[0.08] mt-6">
                  <p className="text-[10px] text-slate-500 font-bold uppercase">Gasto Total Acumulado</p>
                  <h2 className="text-2xl font-black text-red-400 font-mono mt-1">S/ {egresosData.totalEgresos.toFixed(2)}</h2>
                </div>
              </div>

            </div>
          )}

          {/* TAB 5: BALANCE E INGRESOS VS GASTOS (MÁRGENES) */}
          {activeTab === 'balance' && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* KPIs Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                
                {/* Ingresos por Ventas */}
                <div className="glass rounded-3xl border border-white/[0.08] p-5 shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Ingresos Recaudados</p>
                    <h2 className="text-2xl font-black text-emerald-400 mt-2 font-mono">S/ {balanceCompleto.revenue.toFixed(2)}</h2>
                    <p className="text-[10px] text-slate-500 mt-1">Cobros de ventas validadas</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <DollarSign className="w-7 h-7" />
                  </div>
                </div>

                {/* Egresos */}
                <div className="glass rounded-3xl border border-white/[0.08] p-5 shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Gastos / Egresos</p>
                    <h2 className="text-2xl font-black text-red-400 mt-2 font-mono">S/ {balanceCompleto.expenses.toFixed(2)}</h2>
                    <p className="text-[10px] text-slate-500 mt-1">Compras + Fijos + Repuestos</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
                    <CreditCard className="w-7 h-7" />
                  </div>
                </div>

                {/* Utilidad */}
                <div className="glass rounded-3xl border border-white/[0.08] p-5 shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Utilidad Neta</p>
                    <h2 className={`text-2xl font-black mt-2 font-mono ${
                      balanceCompleto.profit >= 0 ? 'text-cyan-400' : 'text-rose-400'
                    }`}>
                      S/ {balanceCompleto.profit.toFixed(2)}
                    </h2>
                    <p className="text-[10px] text-slate-500 mt-1">Ingresos menos egresos</p>
                  </div>
                  <div className={`p-3 rounded-2xl ${
                    balanceCompleto.profit >= 0 ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    <TrendingUp className="w-7 h-7" />
                  </div>
                </div>

                {/* Margen de Utilidad */}
                <div className="glass rounded-3xl border border-white/[0.08] p-5 shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Margen de Utilidad</p>
                    <h2 className={`text-2xl font-black mt-2 font-mono ${
                      balanceCompleto.margin >= 0 ? 'text-cyan-400' : 'text-rose-400'
                    }`}>
                      {balanceCompleto.margin.toFixed(1)} %
                    </h2>
                    <p className="text-[10px] text-slate-500 mt-1">Porcentaje de rentabilidad</p>
                  </div>
                  <div className={`p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400`}>
                    <BarChart3 className="w-7 h-7" />
                  </div>
                </div>

              </div>

              {/* Margen Gauge Progress */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Margen de Rentabilidad de Fábrica</h3>
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Eficiencia Financiera:</span>
                      <span className="font-bold text-white">{balanceCompleto.margin.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-white/5 overflow-hidden border border-white/10">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${
                          balanceCompleto.margin >= 40 ? 'bg-emerald-500' : 
                          balanceCompleto.margin >= 20 ? 'bg-cyan-500' : 
                          balanceCompleto.margin >= 0 ? 'bg-amber-500' : 'bg-red-500'
                        }`} 
                        style={{ width: `${Math.max(0, balanceCompleto.margin)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">Un margen superior al 30% representa niveles de rentabilidad altamente óptimos en la manufactura de medias.</p>
                  </div>
                </div>

                {/* Chart comparison */}
                <div className="lg:col-span-2 glass rounded-3xl border border-white/[0.08] p-6 shadow-xl">
                  <h2 className="text-sm font-bold text-white tracking-tight mb-4">📊 Rentabilidad: Ingresos vs Egresos Totales</h2>
                  <div className="w-full h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <Tooltip 
                          contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px' }}
                          labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                        />
                        <Legend verticalAlign="top" height={36} />
                        <Bar dataKey="Ingresos" fill="#10b981" radius={[10, 10, 0, 0]} barSize={80} />
                        <Bar dataKey="Egresos" fill="#ef4444" radius={[10, 10, 0, 0]} barSize={80} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
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
              <button 
                type="button"
                onClick={() => setShowAddHiloModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
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
                <button 
                  type="button"
                  onClick={() => setShowAddHiloModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold text-white"
                >
                  {saving ? 'Agregando...' : 'Agregar Hilo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: REGISTRAR PROVEEDOR ──────────────────────────────────────── */}
      {showAddProveedorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">🏢 Registrar Proveedor</h2>
              <button 
                type="button"
                onClick={() => setShowAddProveedorModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddProveedor} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">🏢 Razón Social / Nombre</label>
                <input 
                  type="text" 
                  value={proveedorForm.nombre} 
                  onChange={e => setProveedorForm(prev => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej: Hilados del Norte S.A." 
                  className="input-dark w-full text-sm py-2.5 font-bold"
                  required 
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🆔 RUC</label>
                <input 
                  type="text" 
                  value={proveedorForm.ruc} 
                  onChange={e => setProveedorForm(prev => ({ ...prev, ruc: e.target.value }))}
                  placeholder="Ej: 20498765431" 
                  className="input-dark w-full text-sm py-2.5 font-mono font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">👤 Contacto</label>
                  <input 
                    type="text" 
                    value={proveedorForm.contacto} 
                    onChange={e => setProveedorForm(prev => ({ ...prev, contacto: e.target.value }))}
                    placeholder="Ej: Ing. Carlos" 
                    className="input-dark w-full text-sm py-2.5"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">📞 Teléfono</label>
                  <input 
                    type="text" 
                    value={proveedorForm.telefono} 
                    onChange={e => setProveedorForm(prev => ({ ...prev, telefono: e.target.value }))}
                    placeholder="Ej: 999888777" 
                    className="input-dark w-full text-sm py-2.5"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button 
                  type="button"
                  onClick={() => setShowAddProveedorModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold text-white"
                >
                  {saving ? 'Registrando...' : 'Registrar Proveedor'}
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
              <button 
                type="button"
                onClick={() => setShowAddRepuestoModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
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
                <button 
                  type="button"
                  onClick={() => setShowAddRepuestoModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-cyan-600 border-none font-bold text-white"
                >
                  {saving ? 'Registrando...' : 'Registrar Repuesto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: AJUSTAR STOCK DE REPUESTO ─────────────────────────────────── */}
      {showAdjustRepuestoModal && selectedRepuesto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">🔧 Ajustar Inventario de Repuesto</h2>
              <button 
                type="button"
                onClick={() => { setShowAdjustRepuestoModal(false); setSelectedRepuesto(null) }} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] mb-4 space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Repuesto:</span> <span className="font-bold text-white">{selectedRepuesto.nombre}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Stock Actual:</span> <span className="font-bold text-white font-mono">{selectedRepuesto.stock_actual} Unid.</span></div>
            </div>

            <form onSubmit={handleAdjustRepuesto} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-2">Tipo de Ajuste</label>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    type="button"
                    onClick={() => setAdjustRepuestoForm(prev => ({ ...prev, tipo: 'ingreso' }))}
                    className={`py-3 rounded-2xl font-bold flex flex-col items-center justify-center gap-1 border transition-all ${
                      adjustRepuestoForm.tipo === 'ingreso' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'glass border-white/[0.06] text-slate-400'
                    }`}
                  >
                    <span>Ingresar Stock</span>
                  </button>
                  <button 
                    type="button"
                    onClick={() => setAdjustRepuestoForm(prev => ({ ...prev, tipo: 'salida' }))}
                    className={`py-3 rounded-2xl font-bold flex flex-col items-center justify-center gap-1 border transition-all ${
                      adjustRepuestoForm.tipo === 'salida' ? 'bg-red-500/10 border-red-500 text-red-400' : 'glass border-white/[0.06] text-slate-400'
                    }`}
                  >
                    <span>Retirar Stock</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Cantidad a Ajustar</label>
                  <input 
                    type="number" 
                    min="1"
                    value={adjustRepuestoForm.cantidad} 
                    onChange={e => setAdjustRepuestoForm(prev => ({ ...prev, cantidad: e.target.value }))}
                    placeholder="Ej: 5" 
                    className="input-dark w-full text-sm py-2.5 font-bold"
                    required
                  />
                </div>
                {adjustRepuestoForm.tipo === 'salida' && (
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">Motivo / Descripción de Mantenimiento</label>
                    <input 
                      type="text" 
                      value={adjustRepuestoForm.motivo} 
                      onChange={e => setAdjustRepuestoForm(prev => ({ ...prev, motivo: e.target.value }))}
                      placeholder="Ej: Reparación aguja máquina A-01" 
                      className="input-dark w-full text-sm py-2.5"
                      required
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button 
                  type="button"
                  onClick={() => { setShowAdjustRepuestoModal(false); setSelectedRepuesto(null) }} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className={`btn-primary flex-1 justify-center py-2.5 border-none font-bold text-white ${
                    adjustRepuestoForm.tipo === 'ingreso' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  {saving ? 'Procesando...' : 'Confirmar Ajuste'}
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
              <h2 className="text-lg font-bold text-white flex items-center gap-2">💸 Registrar Gasto de Fábrica</h2>
              <button 
                type="button"
                onClick={() => setShowAddEgresoModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddEgreso} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">📝 Concepto / Detalle del Gasto</label>
                <input 
                  type="text" 
                  value={egresoForm.concepto} 
                  onChange={e => setEgresoForm(prev => ({ ...prev, concepto: e.target.value }))}
                  placeholder="Ej: Bolsas de empaque, Repuestos M10, Luz, Alquiler" 
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
                  <label className="block text-slate-300 font-bold mb-1">🏷️ Categoría de Gasto</label>
                  <select 
                    value={egresoForm.categoria}
                    onChange={e => setEgresoForm(prev => ({ ...prev, categoria: e.target.value }))}
                    className="input-dark w-full text-sm py-2.5 font-bold"
                  >
                    <option value="empaque">Insumos Empaque (Bolsas/Etiquetas)</option>
                    <option value="repuestos">Repuestos de Maquinaria</option>
                    <option value="planilla">Planillas Personal</option>
                    <option value="servicios">Servicios Básicos (Luz/Agua)</option>
                    <option value="alquiler">Alquiler de Local</option>
                    <option value="otros">Otros Gastos</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button 
                  type="button"
                  onClick={() => setShowAddEgresoModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-red-600 border-none font-bold text-white"
                >
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
              <button 
                type="button"
                onClick={() => setShowCompraModal(false)} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
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
                    <option value="pago_diferido">A Crédito (Pago Diferido)</option>
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
                <button 
                  type="button"
                  onClick={() => setShowCompraModal(false)} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold text-white"
                >
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
              <button 
                type="button"
                onClick={() => { setShowQcModal(false); setSelectedCompra(null) }} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
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
                <button 
                  type="button"
                  onClick={() => { setShowQcModal(false); setSelectedCompra(null) }} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className={`btn-primary flex-1 justify-center py-2.5 border-none font-bold text-white ${
                    qcForm.aprobar ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
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
              <button 
                type="button"
                onClick={() => { setShowPayCuotaModal(false); setSelectedCuota(null) }} 
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
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
                <button 
                  type="button"
                  onClick={() => { setShowPayCuotaModal(false); setSelectedCuota(null) }} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-amber-600 hover:bg-amber-500 border-none font-bold text-white"
                >
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
