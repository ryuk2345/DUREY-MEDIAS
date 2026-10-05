'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { esStockBajoMateriaPrima } from '@/lib/domain/inventario'
import { toast } from 'sonner'
import { 
  Database, Plus, Check, X, RefreshCw, Truck, FileText, AlertTriangle, 
  TrendingUp, TrendingDown, CreditCard, DollarSign, BarChart3, Wrench, Info, Scale, ShoppingCart, Trash2, PackageCheck,
  Building2, Phone, MessageCircle, User, ExternalLink, Edit2
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import CustomSelect from '@/components/ui/CustomSelect'
import { Modal } from '@/components/ui/Modal'

interface MateriaPrima {
  id: string
  material: string
  color: string
  stock_kg: number
  tipo_empaque?: 'bolsa' | 'cono' | 'caja'
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
  estado: 'pendiente' | 'pagada'
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
  const [activeTab, setActiveTab] = useState<'hilos' | 'repuestos' | 'proveedores'>('hilos')
  const [empaqueTab, setEmpaqueTab] = useState<'todos' | 'bolsas' | 'conos' | 'cajas'>('todos')
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
  const [editingHilo, setEditingHilo] = useState<MateriaPrima | null>(null)
  const [showAddRepuestoModal, setShowAddRepuestoModal] = useState(false)
  const [editingRepuesto, setEditingRepuesto] = useState<Repuesto | null>(null)
  const [showAddEgresoModal, setShowAddEgresoModal] = useState(false)
  const [showPayCuotaModal, setShowPayCuotaModal] = useState(false)
  const [selectedCuota, setSelectedCuota] = useState<CuotaCompra | null>(null)
  const [showAddProveedorModal, setShowAddProveedorModal] = useState(false)
  const [showAdjustRepuestoModal, setShowAdjustRepuestoModal] = useState(false)
  const [selectedRepuesto, setSelectedRepuesto] = useState<Repuesto | null>(null)

  // Forms
  const [hiloForm, setHiloForm] = useState<{ material: string; color: string; stock_kg: string; tipo_empaque: 'bolsa' | 'cono' | 'caja' }>({
    material: '',
    color: '',
    stock_kg: '',
    tipo_empaque: 'cono'
  })
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

  // ── CARGAR DATOS (solo desde la base de datos) ────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
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

      const conError = [hilosRes, provRes, comprasRes, movRes, repRes, cuotasRes, egresosRes, ventasRes, repairsRes].find(r => r.error)
      if (conError?.error) throw conError.error

      setStockHilos(hilosRes.data ?? [])
      setProveedores(provRes.data ?? [])
      setCompras((comprasRes.data ?? []) as unknown as Compra[])
      setMovimientos((movRes.data ?? []) as unknown as Movimiento[])
      setRepuestos(repRes.data ?? [])
      setCuotasCompras((cuotasRes.data ?? []) as unknown as CuotaCompra[])
      setEgresosAdicionales(egresosRes.data ?? [])
      
      const totalRecaudadoVentas = (ventasRes.data ?? []).reduce((s, c) => s + c.monto, 0)
      const totalReparaciones = (repairsRes.data ?? []).reduce((s, r) => s + (Number(r.costo_total) || 0), 0)
      setVentasTotal(totalRecaudadoVentas)
      setRepairsTotal(totalReparaciones)

    } catch (err: any) {
      // Un error se muestra como error. Antes el módulo pasaba a datos guardados solo
      // en este navegador y lo que se registraba ahí nunca llegaba a la base.
      toast.error(`No se pudo cargar Materia Prima: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // ── REGISTRAR / EDITAR HILO O MATERIA PRIMA ───────────────────────────────
  const handleAddHilo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hiloForm.material || !hiloForm.color) {
      toast.error('Material y color son obligatorios')
      return
    }

    setSaving(true)

    try {
      if (editingHilo) {
        // Una sola operación: cambia nombre/color/empaque y solo toca el stock si se
        // modificó (conteo físico), dejando un movimiento 'ajuste_inventario'.
        // Antes reescribía el stock con el valor viejo de la pantalla y, sin id válido,
        // editaba por nombre de material (todos los hilos de ese material a la vez).
        const { error } = await supabase.rpc('editar_materia_prima', {
          p_id: editingHilo.id,
          p_material: hiloForm.material.trim(),
          p_color: hiloForm.color.trim(),
          p_tipo_empaque: hiloForm.tipo_empaque || 'cono',
          p_stock_anterior: Number(editingHilo.stock_kg || 0),
          p_stock_nuevo: parseFloat(hiloForm.stock_kg || '0')
        })
        if (error) throw error
      
        const list = stockHilos.map(x => x.id === editingHilo.id ? {
          ...x,
          material: hiloForm.material.trim(),
          color: hiloForm.color.trim(),
          stock_kg: parseFloat(hiloForm.stock_kg || '0'),
          tipo_empaque: hiloForm.tipo_empaque || 'cono'
        } : x)
        setStockHilos(list)

        toast.success('✏️ Insumo actualizado correctamente')
      } else {
        const newHilo = {
          material: hiloForm.material.trim(),
          color: hiloForm.color.trim(),
          stock_kg: parseFloat(hiloForm.stock_kg || '0'),
          tipo_empaque: hiloForm.tipo_empaque || 'cono',
          created_at: new Date().toISOString()
        }

        const { error } = await supabase.from('materia_prima').insert({
          material: newHilo.material,
          color: newHilo.color,
          stock_kg: newHilo.stock_kg,
          tipo_empaque: newHilo.tipo_empaque
        })
        if (error) throw error
      

        const empaqueName = newHilo.tipo_empaque === 'caja' ? '📦 Caja' : newHilo.tipo_empaque === 'bolsa' ? '🛍️ Bolsa' : '🧵 Cono'
        toast.success(`${empaqueName} registrado exitosamente en el almacén`)
      }

      setShowAddHiloModal(false)
      setEditingHilo(null)
      setHiloForm({ material: '', color: '', stock_kg: '', tipo_empaque: 'cono' })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al guardar insumo: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const abrirCrearHiloModal = () => {
    setEditingHilo(null)
    setHiloForm({ material: '', color: '', stock_kg: '', tipo_empaque: 'cono' })
    setShowAddHiloModal(true)
  }

  const abrirEditarHiloModal = (hilo: MateriaPrima) => {
    setEditingHilo(hilo)
    setHiloForm({
      material: hilo.material,
      color: hilo.color,
      stock_kg: String(hilo.stock_kg),
      tipo_empaque: hilo.tipo_empaque || 'cono'
    })
    setShowAddHiloModal(true)
  }

  // Eliminar hilo / materia prima
  const handleEliminarHilo = async (h: MateriaPrima) => {
    const empaqueName = h.tipo_empaque === 'caja' ? 'caja' : h.tipo_empaque === 'bolsa' ? 'bolsa' : 'cono'
    if (!confirm(`¿Estás seguro de eliminar el registro de ${empaqueName} "${h.material} ${h.color}"?`)) return
    try {
      const { error } = await supabase.from('materia_prima').delete().eq('id', h.id)
      if (error) throw error
    
      toast.success('Insumo eliminado correctamente')
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al eliminar insumo: ${err.message}`)
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
      nombre: proveedorForm.nombre.trim(),
      ruc: proveedorForm.ruc.trim(),
      contacto: proveedorForm.contacto.trim(),
      telefono: proveedorForm.telefono.trim()
    }

    try {
      const { error } = await supabase.from('proveedores').insert({
        nombre: newProv.nombre,
        ruc: newProv.ruc || null,
        contacto: newProv.contacto || null,
        telefono: newProv.telefono || null
      })
      if (error) throw error
    

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

  // ── ELIMINAR PROVEEDOR ────────────────────────────────────────────────────
  const handleEliminarProveedor = async (prov: Proveedor) => {
    const tieneCompras = compras.some(c => c.proveedor_id === prov.id)
    if (tieneCompras) {
      if (!confirm(`El proveedor "${prov.nombre}" tiene compras registradas en el historial. ¿Deseas eliminarlo de todos modos?`)) {
        return
      }
    } else {
      if (!confirm(`¿Eliminar definitivamente al proveedor "${prov.nombre}"?`)) {
        return
      }
    }

    try {
      const { error } = await supabase.from('proveedores').delete().eq('id', prov.id)
      if (error) throw error
      toast.success(`Proveedor "${prov.nombre}" eliminado`)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al eliminar proveedor: ${err.message}`)
    }
  }

  // ── ABRIR COMPRA CON PROVEEDOR PRESELECCIONADO ─────────────────────────────
  const abrirCompraConProveedor = (proveedorId: string) => {
    setCompraForm(prev => ({
      ...prev,
      proveedor_id: proveedorId
    }))
    setShowCompraModal(true)
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
      nombre: repuestoForm.nombre.trim(),
      stock_actual: parseInt(repuestoForm.stock_actual || '0'),
      costo_unitario: parseFloat(repuestoForm.costo_unitario),
      created_at: new Date().toISOString()
    }

    try {
      const { error } = await supabase.from('repuestos').insert({
        nombre: newRep.nombre,
        stock_actual: newRep.stock_actual,
        costo_unitario: newRep.costo_unitario
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

    try {
      // Una sola operación: stock relativo al actual + gasto si es salida.
      // Antes una salida mayor al stock lo dejaba en 0 y registraba el gasto completo.
      const { error } = await supabase.rpc('ajustar_stock_repuesto', {
        p_repuesto_id: selectedRepuesto.id,
        p_tipo: adjustRepuestoForm.tipo,
        p_cantidad: cant,
        p_motivo: adjustRepuestoForm.motivo || null
      })
      if (error) throw error
    

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

  // ── ELIMINAR REPUESTO ────────────────────────────────────────────────────
  const handleEliminarRepuesto = async (rep: Repuesto) => {
    if (!confirm(`¿Estás seguro de eliminar el repuesto "${rep.nombre}"? Esta acción no se puede deshacer.`)) return
    try {
      const { error } = await supabase.from('repuestos').delete().eq('id', rep.id)
      if (error) throw error
    
      toast.success('Repuesto eliminado correctamente')
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al eliminar repuesto: ${err.message}`)
    }
  }

  // ── EDITAR REPUESTO ──────────────────────────────────────────────────────
  const abrirEditarRepuesto = (rep: Repuesto) => {
    setEditingRepuesto(rep)
    setRepuestoForm({
      nombre: rep.nombre,
      stock_actual: String(rep.stock_actual),
      costo_unitario: String(rep.costo_unitario)
    })
    setShowAddRepuestoModal(true)
  }

  const handleGuardarEdicionRepuesto = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRepuesto || !repuestoForm.nombre || !repuestoForm.costo_unitario) {
      toast.error('Nombre y costo unitario son obligatorios')
      return
    }
    setSaving(true)
    try {
      const updatedData = {
        nombre: repuestoForm.nombre.trim(),
        costo_unitario: parseFloat(repuestoForm.costo_unitario)
      }
      const { error } = await supabase.from('repuestos').update(updatedData).eq('id', editingRepuesto.id)
      if (error) throw error
    
      toast.success('✏️ Repuesto actualizado correctamente')
      setShowAddRepuestoModal(false)
      setEditingRepuesto(null)
      setRepuestoForm({ nombre: '', stock_actual: '', costo_unitario: '' })
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al editar repuesto: ${err.message}`)
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
      concepto: egresoForm.concepto.trim(),
      monto: parseFloat(egresoForm.monto),
      categoria: egresoForm.categoria,
      fecha: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    }

    try {
      const { error } = await supabase.from('egresos_adicionales').insert({
        concepto: newEgreso.concepto,
        monto: newEgreso.monto,
        categoria: newEgreso.categoria,
        fecha: newEgreso.fecha
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

  // ── REGISTRAR COMPRA DE MATERIA PRIMA ─────────────────────────────────────
  const handleRegistrarCompra = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!compraForm.proveedor_id || !compraForm.materia_prima_id || !compraForm.cantidad_kg || !compraForm.costo_total) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    setSaving(true)
    const newComp = {
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
      // Una sola operación: compra + cronograma de cuotas (que suma exacto el total)
      const { error } = await supabase.rpc('registrar_compra_materia_prima', {
        p_proveedor_id: newComp.proveedor_id,
        p_materia_prima_id: newComp.materia_prima_id,
        p_cantidad_kg: newComp.cantidad_kg,
        p_costo_total: newComp.costo_total,
        p_condicion_pago: newComp.condicion_pago,
        p_metodo_pago: newComp.metodo_pago,
        p_cuotas_num: compraForm.condicion_pago === 'pago_diferido' ? parseInt(compraForm.cuotas_num) : null
      })
      if (error) throw error
    

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
    const motivo = qcForm.aprobar ? null : qcForm.motivo_devolucion

    try {
      // Una sola operación: estado de la compra + stock (sumado al valor actual, no a
      // uno leído antes) + movimiento. Rechaza una compra ya procesada.
      const { error } = await supabase.rpc('procesar_control_calidad_compra', {
        p_compra_id: selectedCompra.id,
        p_aprobar: qcForm.aprobar,
        p_motivo: motivo
      })
      if (error) throw error
    

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
      const { error } = await supabase
        .from('cuotas_compras')
        .update({
          estado: 'pagada',
          fecha_pago: fecha,
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

  // ── CALCULAR SUB-LISTAS POR TIPO DE EMPAQUE Y ALERTAS ESPECÍFICAS ──────────
  const isItemCritical = (h: MateriaPrima) => esStockBajoMateriaPrima(Number(h.stock_kg || 0), h.tipo_empaque)

  const getItemThreshold = (empaque?: 'bolsa' | 'cono' | 'caja') => {
    return empaque === 'cono' ? 10 : 4
  }

  const getItemUnitLabel = (empaque?: 'bolsa' | 'cono' | 'caja') => {
    return empaque === 'caja' ? 'cajas' : empaque === 'bolsa' ? 'bolsas' : 'conos'
  }

  const stockBolsas = useMemo(() => stockHilos.filter(h => (h.tipo_empaque || 'cono') === 'bolsa'), [stockHilos])
  const stockConos = useMemo(() => stockHilos.filter(h => (h.tipo_empaque || 'cono') === 'cono'), [stockHilos])
  const stockCajas = useMemo(() => stockHilos.filter(h => (h.tipo_empaque || 'cono') === 'caja'), [stockHilos])

  const stockSugerencias = useMemo(() => {
    return stockHilos.filter(isItemCritical)
  }, [stockHilos])

  const proveedoresInfo = useMemo(() => {
    return proveedores.map(p => {
      const misCompras = compras.filter(c => c.proveedor_id === p.id)
      const totalComprado = misCompras.reduce((sum, c) => sum + Number(c.costo_total || 0), 0)

      const misCuotas = cuotasCompras.filter(q => q.compra?.proveedor_id === p.id)
      const saldoPendiente = misCuotas
        .filter(q => q.estado === 'pendiente')
        .reduce((sum, q) => sum + Number(q.monto || 0), 0)

      return {
        ...p,
        totalComprado,
        saldoPendiente,
        totalComprasCount: misCompras.length
      }
    })
  }, [proveedores, compras, cuotasCompras])

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
    <>
      <div className="space-y-6 animate-fadeInUp pb-12">
      {/* Fallback Banner */}
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

          {activeTab === 'proveedores' && (
            <div className="flex items-center gap-2">
              <button 
                type="button"
                onClick={() => setShowAddProveedorModal(true)} 
                className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-amber-600 hover:bg-amber-500 border-none flex items-center gap-1.5 font-bold shadow-lg"
              >
                <Building2 className="w-4 h-4" /> + Nuevo Proveedor
              </button>
              <button 
                type="button"
                onClick={() => setShowCompraModal(true)} 
                className="btn-secondary text-xs py-2.5 px-4 rounded-2xl border-white/10 hover:bg-white/5 text-white flex items-center gap-1.5 font-bold"
              >
                <ShoppingCart className="w-4 h-4 text-amber-400" /> Registrar Compra
              </button>
            </div>
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
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs">Cargando datos...</div>
      ) : (
        <>
          {/* TAB 1: MATERIA PRIMA (3 APARTADOS: BOLSAS, CONOS Y CAJAS) */}
          {activeTab === 'hilos' && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* Resumen Superior de los 3 Empaques */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Card Bolsas */}
                <div 
                  onClick={() => setEmpaqueTab(empaqueTab === 'bolsas' ? 'todos' : 'bolsas')}
                  className={`cursor-pointer p-4 rounded-3xl border transition-all glass shadow-lg flex items-center justify-between ${
                    empaqueTab === 'bolsas' ? 'ring-2 ring-emerald-500 bg-emerald-500/[0.06] border-emerald-500/40' : 'border-white/[0.08] hover:border-emerald-500/30'
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      🛍️ Apartado Bolsas
                    </span>
                    <h3 className="text-xl font-black text-white font-mono">
                      {stockBolsas.length} <span className="text-xs font-normal text-slate-400">tipos</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">
                      Total: <strong className="text-emerald-400 font-mono">{stockBolsas.reduce((acc, h) => acc + Number(h.stock_kg || 0), 0).toFixed(0)} bolsas</strong>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-bold py-1 px-2.5 rounded-full border ${
                      stockBolsas.filter(isItemCritical).length > 0 
                        ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse' 
                        : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    }`}>
                      {stockBolsas.filter(isItemCritical).length > 0 ? `${stockBolsas.filter(isItemCritical).length} Crítico (≤4)` : 'Normal'}
                    </span>
                  </div>
                </div>

                {/* Card Conos */}
                <div 
                  onClick={() => setEmpaqueTab(empaqueTab === 'conos' ? 'todos' : 'conos')}
                  className={`cursor-pointer p-4 rounded-3xl border transition-all glass shadow-lg flex items-center justify-between ${
                    empaqueTab === 'conos' ? 'ring-2 ring-indigo-500 bg-indigo-500/[0.06] border-indigo-500/40' : 'border-white/[0.08] hover:border-indigo-500/30'
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      🧵 Apartado Conos
                    </span>
                    <h3 className="text-xl font-black text-white font-mono">
                      {stockConos.length} <span className="text-xs font-normal text-slate-400">tipos</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">
                      Total: <strong className="text-indigo-400 font-mono">{stockConos.reduce((acc, h) => acc + Number(h.stock_kg || 0), 0).toFixed(0)} conos</strong>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-bold py-1 px-2.5 rounded-full border ${
                      stockConos.filter(isItemCritical).length > 0 
                        ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse' 
                        : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                    }`}>
                      {stockConos.filter(isItemCritical).length > 0 ? `${stockConos.filter(isItemCritical).length} Crítico (≤10)` : 'Normal'}
                    </span>
                  </div>
                </div>

                {/* Card Cajas */}
                <div 
                  onClick={() => setEmpaqueTab(empaqueTab === 'cajas' ? 'todos' : 'cajas')}
                  className={`cursor-pointer p-4 rounded-3xl border transition-all glass shadow-lg flex items-center justify-between ${
                    empaqueTab === 'cajas' ? 'ring-2 ring-amber-500 bg-amber-500/[0.06] border-amber-500/40' : 'border-white/[0.08] hover:border-amber-500/30'
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      📦 Apartado Cajas
                    </span>
                    <h3 className="text-xl font-black text-white font-mono">
                      {stockCajas.length} <span className="text-xs font-normal text-slate-400">tipos</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">
                      Total: <strong className="text-amber-400 font-mono">{stockCajas.reduce((acc, h) => acc + Number(h.stock_kg || 0), 0).toFixed(0)} cajas</strong>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-bold py-1 px-2.5 rounded-full border ${
                      stockCajas.filter(isItemCritical).length > 0 
                        ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse' 
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    }`}>
                      {stockCajas.filter(isItemCritical).length > 0 ? `${stockCajas.filter(isItemCritical).length} Crítico (≤4)` : 'Normal'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Filtro secundario de visualización */}
              <div className="flex items-center justify-between">
                <div className="flex gap-2 p-1 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                  {[
                    { id: 'todos', label: `Todos (${stockHilos.length})` },
                    { id: 'bolsas', label: `🛍️ Bolsas (${stockBolsas.length})` },
                    { id: 'conos', label: `🧵 Conos (${stockConos.length})` },
                    { id: 'cajas', label: `📦 Cajas (${stockCajas.length})` }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setEmpaqueTab(tab.id as any)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        empaqueTab === tab.id 
                          ? 'bg-slate-800 text-white shadow-sm border border-white/10' 
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={abrirCrearHiloModal}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-600/10"
                >
                  <Plus className="w-3.5 h-3.5" /> Registrar Insumo
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">

                  {/* ── APARTADO 1: BOLSAS ── */}
                  {(empaqueTab === 'todos' || empaqueTab === 'bolsas') && (
                    <div className="glass rounded-3xl border border-emerald-500/20 p-6 shadow-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                          <span className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">🛍️</span> 
                          Apartado: Inventario de Bolsas
                        </h2>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          Alerta: ≤ 4 bolsas
                        </span>
                      </div>
                      
                      <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                            <tr>
                              <th className="p-4">Fibra / Material</th>
                              <th className="p-4">Color</th>
                              <th className="p-4 text-right">Stock (Bolsas)</th>
                              <th className="p-4 text-center">Estado Alerta</th>
                              <th className="p-4 text-center">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.04]">
                            {stockBolsas.map((hilo) => {
                              const isCritical = isItemCritical(hilo)
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
                                    {Number(hilo.stock_kg).toFixed(0)} <span className="text-[10px] font-normal text-slate-400">bolsas</span>
                                  </td>
                                  <td className="p-4 text-center">
                                    {isCritical ? (
                                      <span className="badge bg-red-500/20 text-red-400 border-red-500/30 text-[10px] py-1 px-2.5 font-bold animate-pulse inline-flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" /> Pedir Más (≤ 4)
                                      </span>
                                    ) : (
                                      <span className="badge bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] py-1 px-2.5 font-bold">
                                        Suficiente
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-4 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => abrirEditarHiloModal(hilo)}
                                        className="p-1.5 rounded-lg hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition-colors"
                                        title="Editar Insumo (Nombre/Datos)"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCompraForm(prev => ({ ...prev, materia_prima_id: hilo.id }))
                                          setShowCompraModal(true)
                                        }}
                                        className="p-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold"
                                        title="Reabastecer"
                                      >
                                        + Pedir
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleEliminarHilo(hilo)}
                                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                                        title="Eliminar"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                            {stockBolsas.length === 0 && (
                              <tr>
                                <td colSpan={5} className="p-6 text-center text-slate-500 text-xs">
                                  No hay materias primas registradas en presentación de bolsas.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── APARTADO 2: CONOS ── */}
                  {(empaqueTab === 'todos' || empaqueTab === 'conos') && (
                    <div className="glass rounded-3xl border border-indigo-500/20 p-6 shadow-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                          <span className="p-1.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">🧵</span> 
                          Apartado: Inventario de Conos
                        </h2>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                          Alerta: ≤ 10 conos
                        </span>
                      </div>
                      
                      <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                            <tr>
                              <th className="p-4">Fibra / Material</th>
                              <th className="p-4">Color</th>
                              <th className="p-4 text-right">Stock (Conos)</th>
                              <th className="p-4 text-center">Estado Alerta</th>
                              <th className="p-4 text-center">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.04]">
                            {stockConos.map((hilo) => {
                              const isCritical = isItemCritical(hilo)
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
                                    {Number(hilo.stock_kg).toFixed(0)} <span className="text-[10px] font-normal text-slate-400">conos</span>
                                  </td>
                                  <td className="p-4 text-center">
                                    {isCritical ? (
                                      <span className="badge bg-red-500/20 text-red-400 border-red-500/30 text-[10px] py-1 px-2.5 font-bold animate-pulse inline-flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" /> Pedir Más (≤ 10)
                                      </span>
                                    ) : (
                                      <span className="badge bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-[10px] py-1 px-2.5 font-bold">
                                        Suficiente
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-4 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => abrirEditarHiloModal(hilo)}
                                        className="p-1.5 rounded-lg hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition-colors"
                                        title="Editar Insumo (Nombre/Datos)"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCompraForm(prev => ({ ...prev, materia_prima_id: hilo.id }))
                                          setShowCompraModal(true)
                                        }}
                                        className="p-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 text-[10px] font-bold"
                                        title="Reabastecer"
                                      >
                                        + Pedir
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleEliminarHilo(hilo)}
                                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                                        title="Eliminar"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                            {stockConos.length === 0 && (
                              <tr>
                                <td colSpan={5} className="p-6 text-center text-slate-500 text-xs">
                                  No hay materias primas registradas en presentación de conos.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── APARTADO 3: CAJAS ── */}
                  {(empaqueTab === 'todos' || empaqueTab === 'cajas') && (
                    <div className="glass rounded-3xl border border-amber-500/20 p-6 shadow-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                          <span className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">📦</span> 
                          Apartado: Inventario de Cajas
                        </h2>
                        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          Alerta: ≤ 4 cajas
                        </span>
                      </div>
                      
                      <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                            <tr>
                              <th className="p-4">Fibra / Material</th>
                              <th className="p-4">Color</th>
                              <th className="p-4 text-right">Stock (Cajas)</th>
                              <th className="p-4 text-center">Estado Alerta</th>
                              <th className="p-4 text-center">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.04]">
                            {stockCajas.map((hilo) => {
                              const isCritical = isItemCritical(hilo)
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
                                    {Number(hilo.stock_kg).toFixed(0)} <span className="text-[10px] font-normal text-slate-400">cajas</span>
                                  </td>
                                  <td className="p-4 text-center">
                                    {isCritical ? (
                                      <span className="badge bg-red-500/20 text-red-400 border-red-500/30 text-[10px] py-1 px-2.5 font-bold animate-pulse inline-flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" /> Pedir Más (≤ 4)
                                      </span>
                                    ) : (
                                      <span className="badge bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] py-1 px-2.5 font-bold">
                                        Suficiente
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-4 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => abrirEditarHiloModal(hilo)}
                                        className="p-1.5 rounded-lg hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition-colors"
                                        title="Editar Insumo (Nombre/Datos)"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCompraForm(prev => ({ ...prev, materia_prima_id: hilo.id }))
                                          setShowCompraModal(true)
                                        }}
                                        className="p-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 text-[10px] font-bold"
                                        title="Reabastecer"
                                      >
                                        + Pedir
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleEliminarHilo(hilo)}
                                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                                        title="Eliminar"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                            {stockCajas.length === 0 && (
                              <tr>
                                <td colSpan={5} className="p-6 text-center text-slate-500 text-xs">
                                  No hay materias primas registradas en presentación de cajas.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Compras e Inspección de Entregas */}
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
                              <td className="p-4 text-right font-bold text-white">{Number(compra.cantidad_kg).toFixed(0)} uds.</td>
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
                      💡 Sugerencias de Reabastecimiento
                    </h2>

                    <div className="space-y-3.5">
                      {stockSugerencias.map((h) => {
                        const empIcon = h.tipo_empaque === 'caja' ? '📦 Caja' : h.tipo_empaque === 'bolsa' ? '🛍️ Bolsa' : '🧵 Cono'
                        const threshold = getItemThreshold(h.tipo_empaque)
                        const unitLabel = getItemUnitLabel(h.tipo_empaque)
                        return (
                          <div key={h.id} className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex flex-col justify-between gap-3">
                            <div className="flex gap-3 items-start">
                              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 text-slate-200 border border-white/10">
                                    {empIcon}
                                  </span>
                                  <h3 className="text-xs font-bold text-white">{h.material} {h.color}</h3>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5">
                                  Stock crítico: <strong className="text-red-400 font-mono">{Number(h.stock_kg).toFixed(0)} {unitLabel}</strong> (Límite ≤ {threshold} {unitLabel}).
                                </p>
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
                              Generar Pedido de {empIcon}
                            </button>
                          </div>
                        )
                      })}
                      {stockSugerencias.length === 0 && (
                        <div className="p-6 text-center text-slate-400 text-xs">
                          ✨ Todos los insumos (bolsas, conos y cajas) tienen stock saludable.
                        </div>
                      )}
                    </div>
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
                            <div className="flex items-center justify-center gap-2">
                              <button 
                                type="button"
                                onClick={() => abrirModalAjusteRepuesto(rep)}
                                className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-bold"
                              >
                                Ingreso / Salida
                              </button>
                              <button
                                type="button"
                                onClick={() => abrirEditarRepuesto(rep)}
                                className="p-1.5 rounded-xl text-slate-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                                title="Editar nombre y costo"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEliminarRepuesto(rep)}
                                className="p-1.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Eliminar repuesto"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: PROVEEDORES, CONTACTOS Y CUENTAS POR PAGAR */}
          {activeTab === 'proveedores' && (
            <div className="space-y-8 animate-fadeIn">
              
              {/* ── 1. DIRECTORIO COMPLETO DE PROVEEDORES ──────────────────────── */}
              <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-base font-black text-white tracking-tight">Directorio de Proveedores de Hilados e Insumos</h2>
                      <p className="text-slate-400 text-xs">Consulta números telefónicos, enlaces a WhatsApp para pedidos inmediatos y saldos por proveedor</p>
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setShowAddProveedorModal(true)} 
                    className="btn-primary text-xs py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 border-none flex items-center gap-1.5 font-bold self-start sm:self-auto"
                  >
                    <Plus className="w-4 h-4" /> Registrar Proveedor
                  </button>
                </div>

                {proveedoresInfo.length === 0 ? (
                  <div className="p-10 text-center space-y-3 bg-slate-900/40 rounded-2xl border border-white/[0.04]">
                    <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto text-xl">
                      🏢
                    </div>
                    <p className="text-slate-300 font-bold text-sm">No tienes proveedores registrados todavía</p>
                    <p className="text-slate-500 text-xs max-w-md mx-auto">
                      Registra a tus proveedores de hilados, algodón, licra o repuestos con su número de teléfono para poder contactarlos y gestionar sus pagos.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAddProveedorModal(true)}
                      className="btn-primary text-xs py-2 px-4 bg-amber-600 hover:bg-amber-500 border-none font-bold rounded-xl inline-flex items-center gap-1.5 mt-2"
                    >
                      <Plus className="w-4 h-4" /> Registrar Primer Proveedor
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {proveedoresInfo.map((p) => {
                      const cleanPhone = (p.telefono || '').replace(/\D/g, '')
                      const tieneSaldo = p.saldoPendiente > 0

                      return (
                        <div 
                          key={p.id} 
                          className="glass p-5 rounded-3xl border border-white/[0.08] hover:border-amber-500/30 transition-all flex flex-col justify-between space-y-4 shadow-lg bg-gradient-to-b from-white/[0.02] to-transparent"
                        >
                          {/* Header Proveedor */}
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-base font-black text-white tracking-tight leading-tight">{p.nombre}</h3>
                              <button
                                type="button"
                                onClick={() => handleEliminarProveedor(p)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Eliminar Proveedor"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {p.ruc && (
                              <p className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                                <span className="font-bold text-slate-500">RUC:</span> {p.ruc}
                              </p>
                            )}
                            {p.contacto && (
                              <p className="text-[11px] text-slate-300 flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="font-medium">{p.contacto}</span>
                              </p>
                            )}
                          </div>

                          {/* Contacto Directo: Teléfono y WhatsApp */}
                          <div className="p-3 bg-slate-900/60 rounded-2xl border border-white/[0.04] space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contacto</span>
                              <span className="text-xs font-mono font-bold text-white">{p.telefono || 'Sin teléfono'}</span>
                            </div>
                            {p.telefono && (
                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <a
                                  href={`tel:${p.telefono}`}
                                  className="btn-secondary py-1.5 px-2 text-[11px] font-bold rounded-xl flex items-center justify-center gap-1 text-slate-200 hover:text-white border-white/10"
                                >
                                  <Phone className="w-3 h-3 text-cyan-400" /> Llamar
                                </a>
                                <a
                                  href={`https://wa.me/${cleanPhone.startsWith('51') ? cleanPhone : '51' + cleanPhone}?text=Hola%20${encodeURIComponent(p.nombre)},%20te%20escribo%20de%20Durey%20Medias%20para%20hacer%20un%20pedido%20de%20materia%20prima.`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="py-1.5 px-2 text-[11px] font-bold rounded-xl flex items-center justify-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-all"
                                >
                                  <MessageCircle className="w-3 h-3 text-emerald-400" /> WhatsApp
                                </a>
                              </div>
                            )}
                          </div>

                          {/* Resumen Financiero y Acción */}
                          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2">
                            <div>
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">Deuda Pendiente</span>
                              <span className={`text-xs font-mono font-black ${tieneSaldo ? 'text-red-400' : 'text-emerald-400'}`}>
                                {tieneSaldo ? `S/ ${p.saldoPendiente.toFixed(2)}` : 'Al día (S/ 0.00)'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => abrirCompraConProveedor(p.id)}
                              className="btn-secondary py-1.5 px-3 text-[11px] font-bold rounded-xl border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 flex items-center gap-1"
                            >
                              <ShoppingCart className="w-3 h-3" /> Pedir Hilado
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── 2. CRONOGRAMA DE CUOTAS POR VENCER (PAGO DIFERIDO) ────────── */}
              <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    📅 Fechas y Calendario de Cuotas por Vencer (Cronograma de Créditos)
                  </h2>
                  <span className="text-xs font-mono text-slate-400">
                    {cuotasCompras.filter(q => q.estado === 'pendiente').length} cuotas pendientes
                  </span>
                </div>

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
                      {cuotasCompras.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-slate-500 text-xs">
                            ✨ No tienes deudas o cuotas pendientes de pago diferido con ningún proveedor.
                          </td>
                        </tr>
                      ) : (
                        cuotasCompras.map((cuota) => (
                          <tr key={cuota.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="p-4 font-mono font-bold text-red-300">{cuota.fecha_vencimiento}</td>
                            <td className="p-4 font-bold text-white">{(cuota.compra as any)?.proveedores?.nombre || 'Desconocido'}</td>
                            <td className="p-4 text-slate-400">
                              {(cuota.compra as any)?.materia_prima?.material} {(cuota.compra as any)?.materia_prima?.color}
                            </td>
                            <td className="p-4 text-right font-mono font-black text-sm text-white">S/ {Number(cuota.monto).toFixed(2)}</td>
                            <td className="p-4 text-center">
                              <span className={`badge text-[9px] font-bold py-1 px-2.5 ${
                                cuota.estado === 'pagada' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
                              }`}>
                                {cuota.estado === 'pagada' ? 'Pagada' : 'Pendiente'}
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
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}
        </>
      )}
    </div>

    {/* ── MODALES DEL SISTEMA (RENDERIZADOS FUERA DEL CONTENEDOR CON TRANSFORM) ── */}
    {/* ── MODAL: AÑADIR / EDITAR HILO ─────────────────────────────────────── */}
      {/* ── MODAL: REGISTRAR / EDITAR HILO / FIBRA ────────────────────────── */}
      <Modal
        open={showAddHiloModal}
        onClose={() => setShowAddHiloModal(false)}
        title={editingHilo ? '✏️ Editar Fibra / Insumo' : '🧶 Registrar Nueva Fibra / Hilo'}
        maxWidth="lg"
      >

            <form onSubmit={handleAddHilo} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
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
                <label className="block text-slate-300 font-bold mb-1.5">📦 Tipo de Empaque / Presentación</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'bolsa', label: '🛍️ Bolsa', sub: 'Alerta ≤ 4' },
                    { id: 'cono', label: '🧵 Cono', sub: 'Alerta ≤ 10' },
                    { id: 'caja', label: '📦 Caja', sub: 'Alerta ≤ 4' }
                  ].map(emp => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => setHiloForm(prev => ({ ...prev, tipo_empaque: emp.id as any }))}
                      className={`p-2.5 rounded-xl font-bold text-center border transition-all ${
                        hiloForm.tipo_empaque === emp.id 
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-500/10' 
                          : 'bg-slate-900/60 border-white/[0.08] text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="block text-xs">{emp.label}</span>
                      <span className="block text-[9px] font-normal text-slate-400 mt-0.5">{emp.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  ⚖️ {editingHilo ? 'Stock Actual' : 'Stock Inicial'} ({hiloForm.tipo_empaque === 'caja' ? 'Cajas' : hiloForm.tipo_empaque === 'bolsa' ? 'Bolsas' : 'Conos / Kg'})
                </label>
                <input 
                  type="number" 
                  step="0.1"
                  value={hiloForm.stock_kg} 
                  onChange={e => setHiloForm(prev => ({ ...prev, stock_kg: e.target.value }))}
                  placeholder={hiloForm.tipo_empaque === 'caja' ? 'Ej: 10 cajas' : hiloForm.tipo_empaque === 'bolsa' ? 'Ej: 8 bolsas' : 'Ej: 50 conos'} 
                  className="input-dark w-full text-sm py-2.5 font-bold font-mono"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/[0.06] mt-4 flex-shrink-0">
                <button 
                  type="button"
                  onClick={() => {
                    setShowAddHiloModal(false)
                    setEditingHilo(null)
                  }} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold text-white shadow-lg shadow-emerald-600/20"
                >
                  {saving ? 'Guardando...' : editingHilo ? 'Guardar Cambios' : 'Agregar Insumo'}
                </button>
              </div>
            </form>
      </Modal>

      {/* ── MODAL: REGISTRAR PROVEEDOR ──────────────────────────────────────── */}
      <Modal
        open={showAddProveedorModal}
        onClose={() => setShowAddProveedorModal(false)}
        title="🏢 Registrar Proveedor"
        maxWidth="md"
      >

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
      </Modal>

      {/* ── MODAL: REGISTRAR / EDITAR REPUESTO ──────────────────────────────── */}
      <Modal
        open={showAddRepuestoModal}
        onClose={() => setShowAddRepuestoModal(false)}
        title={editingRepuesto ? '✏️ Editar Repuesto' : '🔧 Añadir Nuevo Repuesto'}
        maxWidth="md"
      >

            <form onSubmit={editingRepuesto ? handleGuardarEdicionRepuesto : handleAddRepuesto} className="space-y-4 text-xs">
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
                  <label className="block text-slate-300 font-bold mb-1">🔢 Stock Inicial
                    {editingRepuesto && <span className="text-slate-500 font-normal ml-1">(usa Ingreso/Salida para cambiar el stock)</span>}
                  </label>
                  <input 
                    type="number" 
                    value={repuestoForm.stock_actual} 
                    onChange={e => setRepuestoForm(prev => ({ ...prev, stock_actual: e.target.value }))}
                    placeholder="Ej: 10" 
                    className="input-dark w-full text-sm py-2.5 font-bold"
                    disabled={!!editingRepuesto}
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
                  onClick={() => {
                    setShowAddRepuestoModal(false)
                    setEditingRepuesto(null)
                    setRepuestoForm({ nombre: '', stock_actual: '', costo_unitario: '' })
                  }} 
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="btn-primary flex-1 justify-center py-2.5 bg-cyan-600 border-none font-bold text-white"
                >
                  {saving ? 'Guardando...' : editingRepuesto ? 'Guardar Cambios' : 'Registrar Repuesto'}
                </button>
              </div>
            </form>
      </Modal>

      {/* ── MODAL: AJUSTAR INVENTARIO REPUESTO ─────────────────────────────── */}
      <Modal
        open={showAdjustRepuestoModal && Boolean(selectedRepuesto)}
        onClose={() => setShowAdjustRepuestoModal(false)}
        title="🔧 Ajustar Inventario de Repuesto"
        maxWidth="md"
      >
        {selectedRepuesto && (
          <>
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
                      placeholder="Ej: Reparación aguja máquina M01" 
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
          </>
        )}
      </Modal>

      {/* ── MODAL: COMPRA / ADQUISICIÓN ──────────────────────────────────────── */}
      <Modal
        open={showCompraModal}
        onClose={() => setShowCompraModal(false)}
        title="📦 Adquisición de Materia Prima"
        maxWidth="xl"
      >

            <form onSubmit={handleRegistrarCompra} className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-slate-300 font-bold mb-1">🏢 Proveedor</label>
                <CustomSelect 
                  value={compraForm.proveedor_id} 
                  onChange={val => setCompraForm(prev => ({ ...prev, proveedor_id: val }))}
                  options={[
                    { value: '', label: 'Selecciona el proveedor...' },
                    ...proveedores.map(p => ({ value: p.id, label: `${p.nombre} (RUC: ${p.ruc})` }))
                  ]}
                  placeholder="Selecciona el proveedor..."
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🧵 Insumo / Materia Prima</label>
                <CustomSelect 
                  value={compraForm.materia_prima_id} 
                  onChange={val => setCompraForm(prev => ({ ...prev, materia_prima_id: val }))}
                  options={[
                    { value: '', label: 'Selecciona tipo de insumo...' },
                    ...stockHilos.map(h => {
                      const empTag = h.tipo_empaque === 'caja' ? '📦 Caja' : h.tipo_empaque === 'bolsa' ? '🛍️ Bolsa' : '🧵 Cono'
                      return {
                        value: h.id,
                        label: `[${empTag}] ${h.material} - ${h.color} (Stock: ${Number(h.stock_kg).toFixed(0)})`
                      }
                    })
                  ]}
                  placeholder="Selecciona tipo de insumo..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">⚖️ Cantidad</label>
                  <input 
                    type="number" 
                    step="0.001" 
                    value={compraForm.cantidad_kg} 
                    onChange={e => setCompraForm(prev => ({ ...prev, cantidad_kg: e.target.value }))}
                    placeholder="Ej. 150" 
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
                  <CustomSelect 
                    value={compraForm.condicion_pago}
                    onChange={val => setCompraForm(prev => ({ ...prev, condicion_pago: val as any }))}
                    options={[
                      { value: 'contado', label: 'Al Contado' },
                      { value: 'pago_diferido', label: 'A Crédito (Pago Diferido)' }
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">💵 Método de Pago</label>
                  <CustomSelect 
                    value={compraForm.metodo_pago}
                    onChange={val => setCompraForm(prev => ({ ...prev, metodo_pago: val }))}
                    options={[
                      { value: 'Transferencia', label: 'Transferencia' },
                      { value: 'Efectivo', label: 'Efectivo' },
                      { value: 'Yape/Plin', label: 'Yape/Plin' }
                    ]}
                  />
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

              <div className="flex gap-3 pt-4 border-t border-white/[0.06] mt-4 flex-shrink-0">
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
                  className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold text-white shadow-lg shadow-emerald-600/20"
                >
                  {saving ? 'Registrando...' : 'Registrar Compra'}
                </button>
              </div>
            </form>
      </Modal>

      {/* ── MODAL: CONTROL DE CALIDAD ────────────────────────────────────────── */}
      <Modal
        open={showQcModal && Boolean(selectedCompra)}
        onClose={() => setShowQcModal(false)}
        title="🔬 Control de Calidad e Inspección"
        maxWidth="lg"
      >
        {selectedCompra && (
          <>
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
          </>
        )}
      </Modal>

      {/* ── MODAL: LIQUIDAR CUOTA DE COMPRA ─────────────────────────────────── */}
      <Modal
        open={showPayCuotaModal && Boolean(selectedCuota)}
        onClose={() => { setShowPayCuotaModal(false); setSelectedCuota(null) }}
        title="💵 Asentar Pago de Cuota"
        maxWidth="md"
      >
        {selectedCuota && (
          <>
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] mb-4 space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-400">Proveedor:</span> <span className="font-bold text-white">{(selectedCuota.compra as any)?.proveedores?.nombre}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Monto Cuota:</span> <span className="font-bold text-amber-400 font-mono">S/ {selectedCuota.monto.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Vencimiento:</span> <span className="font-bold text-red-300 font-mono">{selectedCuota.fecha_vencimiento}</span></div>
            </div>

            <form onSubmit={handlePagarCuota} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">💵 Método de Pago utilizado</label>
                <CustomSelect 
                  value={payCuotaForm.metodo_pago}
                  onChange={val => setPayCuotaForm(prev => ({ ...prev, metodo_pago: val }))}
                  options={[
                    { value: 'Transferencia', label: 'Transferencia Bancaria' },
                    { value: 'Efectivo', label: 'Efectivo de Caja' },
                    { value: 'Yape/Plin', label: 'Yape/Plin' }
                  ]}
                  triggerClassName="text-sm py-2.5 font-bold"
                />
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
          </>
        )}
      </Modal>
    </>
  )
}
