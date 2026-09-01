// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { formatearMoneda, formatearFecha } from '@/lib/utils'
import CustomSelect from '@/components/ui/CustomSelect'
import {
  DollarSign, Plus, Search, Filter, Trash2, Calendar, FileText,
  TrendingDown, Building2, Package, Wrench, AlertTriangle, Loader2,
  X, Check, ExternalLink, ArrowDownRight, RefreshCw, ShieldAlert
} from 'lucide-react'

interface EgresoAdicional {
  id: string
  concepto: string
  monto: number
  fecha: string
  categoria: string
  comprobante_url?: string
  created_at?: string
}

const CATEGORIAS_CONFIG: Record<string, { label: string; color: string }> = {
  empaque:    { label: 'Insumos Empaque (Bolsas/Etiquetas)', color: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
  repuestos:  { label: 'Repuestos de Maquinaria',           color: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10' },
  planilla:   { label: 'Planillas Personal',                color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
  servicios:  { label: 'Servicios Básicos (Luz/Agua)',      color: 'border-blue-500/30 text-blue-400 bg-blue-500/10' },
  alquiler:   { label: 'Alquiler de Local',                 color: 'border-purple-500/30 text-purple-400 bg-purple-500/10' },
  otros:      { label: 'Otros Gastos',                      color: 'border-slate-500/30 text-slate-400 bg-slate-500/10' },
}

export default function EgresosPage() {
  const router = useRouter()
  const supabase = createClient()

  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [egresos, setEgresos] = useState<EgresoAdicional[]>([])
  const [totalComprasRecibidas, setTotalComprasRecibidas] = useState(0)
  const [totalReparaciones, setTotalReparaciones] = useState(0)

  // Filtros
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todos')
  const [busqueda, setBusqueda] = useState<string>('')
  const [showAddModal, setShowAddModal] = useState(false)

  // Formulario nuevo egreso
  const [form, setForm] = useState({
    concepto: '',
    monto: '',
    fecha: new Date().toISOString().split('T')[0],
    categoria: 'otros',
    comprobante_url: ''
  })

  // 1. Validar rol admin
  useEffect(() => {
    async function checkRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          const cookieRole = document.cookie.split('; ').find(row => row.startsWith('durey_user_role='))?.split('=')[1]
          if (cookieRole && cookieRole !== 'admin') {
            router.push('/dashboard')
            return
          }
          setUserRole(cookieRole || 'admin')
          return
        }
        const { data: perfil } = await supabase
          .from('usuarios')
          .select('rol')
          .eq('auth_id', user.id)
          .single()

        const rol = perfil?.rol || 'admin'
        if (rol !== 'admin') {
          toast.error('Acceso denegado: Este módulo es exclusivo de Administrador General.')
          router.push('/dashboard')
          return
        }
        setUserRole(rol)
      } catch (e) {
        setUserRole('admin')
      }
    }
    checkRole()
  }, [router, supabase])

  // 2. Cargar datos
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      const [egrRes, comprasRes, repRes] = await Promise.all([
        supabase.from('egresos_adicionales').select('*').order('fecha', { ascending: false }),
        supabase.from('compras_materia_prima').select('costo_total, estado'),
        supabase.from('reparaciones').select('costo_total')
      ])

      const localEgresos = JSON.parse(localStorage.getItem('durey_egresos_adicionales') || '[]')
      const remoteEgresos = egrRes.data ?? []
      const mergedEgresos = remoteEgresos.length > 0 ? remoteEgresos : localEgresos
      setEgresos(mergedEgresos)

      const comprasCosto = (comprasRes.data ?? [])
        .filter(c => c.estado === 'recibida')
        .reduce((s, c) => s + (Number(c.costo_total) || 0), 0)
      setTotalComprasRecibidas(comprasCosto)

      const repCosto = (repRes.data ?? [])
        .reduce((s, r) => s + (Number(r.costo_total) || 0), 0)
      setTotalReparaciones(repCosto)
    } catch (err: any) {
      console.error('Error al cargar egresos:', err)
      const localEgresos = JSON.parse(localStorage.getItem('durey_egresos_adicionales') || '[]')
      setEgresos(localEgresos)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // 3. Registrar egreso
  const handleGuardarEgreso = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.concepto.trim() || !form.monto || parseFloat(form.monto) <= 0) {
      toast.error('Por favor ingresa un concepto y monto válido')
      return
    }

    setSaving(true)
    const nuevoEgreso = {
      id: Math.random().toString(),
      concepto: form.concepto.trim(),
      monto: parseFloat(form.monto),
      fecha: form.fecha,
      categoria: form.categoria,
      comprobante_url: form.comprobante_url.trim() || null,
      created_at: new Date().toISOString()
    }

    try {
      const { error } = await supabase.from('egresos_adicionales').insert({
        concepto: nuevoEgreso.concepto,
        monto: nuevoEgreso.monto,
        fecha: nuevoEgreso.fecha,
        categoria: nuevoEgreso.categoria,
        comprobante_url: nuevoEgreso.comprobante_url
      })

      if (error) {
        console.warn('Fallback a local para egresos_adicionales:', error.message)
      }

      const updated = [nuevoEgreso, ...egresos]
      setEgresos(updated)
      localStorage.setItem('durey_egresos_adicionales', JSON.stringify(updated))

      toast.success('💸 Gasto operativo registrado exitosamente')
      setShowAddModal(false)
      setForm({
        concepto: '',
        monto: '',
        fecha: new Date().toISOString().split('T')[0],
        categoria: 'otros',
        comprobante_url: ''
      })
    } catch (err: any) {
      toast.error('Error al registrar egreso: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // 4. Eliminar egreso
  const handleEliminarEgreso = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este registro de egreso?')) return

    try {
      await supabase.from('egresos_adicionales').delete().eq('id', id)
      const filtered = egresos.filter(e => e.id !== id)
      setEgresos(filtered)
      localStorage.setItem('durey_egresos_adicionales', JSON.stringify(filtered))
      toast.success('Egreso eliminado')
    } catch (err: any) {
      toast.error('Error al eliminar: ' + err.message)
    }
  }

  // Métricas
  const totalEgresosAdicionales = useMemo(() => {
    return egresos.reduce((acc, curr) => acc + (Number(curr.monto) || 0), 0)
  }, [egresos])

  const totalEgresosConsolidados = useMemo(() => {
    return totalEgresosAdicionales + totalComprasRecibidas + totalReparaciones
  }, [totalEgresosAdicionales, totalComprasRecibidas, totalReparaciones])

  // Filtrado de lista
  const egresosFiltrados = useMemo(() => {
    return egresos.filter(e => {
      const matchCat = filtroCategoria === 'todos' || e.categoria === filtroCategoria
      const matchTxt = !busqueda.trim() || 
        e.concepto.toLowerCase().includes(busqueda.toLowerCase()) ||
        e.fecha.includes(busqueda)
      return matchCat && matchTxt
    })
  }, [egresos, filtroCategoria, busqueda])

  if (userRole && userRole !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <ShieldAlert className="w-16 h-16 text-rose-500 mb-4 animate-bounce" />
        <h2 className="text-xl font-bold text-white mb-2">Acceso Restringido</h2>
        <p className="text-sm text-slate-400 max-w-md">
          Este módulo de Egresos Operativos es de uso exclusivo del <strong>Administrador General</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                Gestión de Egresos y Gastos
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  Exclusivo Admin
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Control y registro centralizado de salidas de caja, insumos, planillas, servicios y mantenimiento
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={cargarDatos}
            disabled={loading}
            className="btn-secondary text-xs py-2 px-3 rounded-2xl"
            title="Recargar datos"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex-1 sm:flex-initial text-xs py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 border-none font-bold text-white shadow-lg shadow-rose-600/20"
          >
            <Plus className="w-4 h-4" />
            Registrar Egreso
          </button>
        </div>
      </div>

      {/* ── TARJETAS KPI DE EGRESOS ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass rounded-3xl p-5 border border-rose-500/20 bg-rose-950/10 relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-rose-300 uppercase tracking-wider">Egresos Consolidados</span>
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400"><DollarSign className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-black text-rose-400 font-mono">
            {formatearMoneda(totalEgresosConsolidados)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Total global de salidas de dinero</p>
        </div>

        <div className="glass rounded-3xl p-5 border border-white/[0.08] relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Gastos Operativos</span>
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400"><FileText className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {formatearMoneda(totalEgresosAdicionales)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{egresos.length} gastos registrados en caja</p>
        </div>

        <div className="glass rounded-3xl p-5 border border-white/[0.08] relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Materia Prima Recibida</span>
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400"><Package className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {formatearMoneda(totalComprasRecibidas)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Hilos y compras cerradas</p>
        </div>

        <div className="glass rounded-3xl p-5 border border-white/[0.08] relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Mantenimiento y Averías</span>
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400"><Wrench className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {formatearMoneda(totalReparaciones)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Repuestos y servicios técnicos</p>
        </div>
      </div>

      {/* ── TABLA Y FILTROS ─────────────────────────────────────────────────────── */}
      <div className="glass rounded-3xl p-6 border border-white/[0.08] space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por concepto o fecha..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="input-dark pl-10 text-xs w-full"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-slate-400" />
            <CustomSelect
              value={filtroCategoria}
              onChange={val => setFiltroCategoria(val)}
              options={[
                { value: 'todos', label: 'Todas las Categorías' },
                { value: 'empaque', label: 'Insumos Empaque' },
                { value: 'repuestos', label: 'Repuestos Maquinaria' },
                { value: 'planilla', label: 'Planillas' },
                { value: 'servicios', label: 'Servicios Básicos' },
                { value: 'alquiler', label: 'Alquiler de Local' },
                { value: 'otros', label: 'Otros Gastos' }
              ]}
              triggerClassName="text-xs py-1.5 px-3 min-w-[200px]"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-rose-400" />
          </div>
        ) : egresosFiltrados.length === 0 ? (
          <div className="p-12 text-center text-slate-500 border border-dashed border-white/10 rounded-2xl">
            <DollarSign className="w-10 h-10 mx-auto mb-2 text-slate-600 opacity-50" />
            <p className="text-sm font-semibold text-slate-400">No se encontraron registros de egresos</p>
            <p className="text-xs text-slate-600 mt-1">Usa el botón superior para registrar nuevos gastos</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto / Descripción</th>
                  <th>Categoría</th>
                  <th className="text-right">Monto</th>
                  <th>Comprobante</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {egresosFiltrados.map(eg => {
                  const catInfo = CATEGORIAS_CONFIG[eg.categoria] || CATEGORIAS_CONFIG.otros
                  return (
                    <tr key={eg.id}>
                      <td className="font-mono text-xs text-slate-400 whitespace-nowrap">
                        {formatearFecha(eg.fecha)}
                      </td>
                      <td className="font-bold text-white text-xs">
                        {eg.concepto}
                      </td>
                      <td>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${catInfo.color}`}>
                          {catInfo.label}
                        </span>
                      </td>
                      <td className="text-right font-mono font-bold text-sm text-rose-400">
                        {formatearMoneda(Number(eg.monto))}
                      </td>
                      <td>
                        {eg.comprobante_url ? (
                          <a
                            href={eg.comprobante_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Ver doc
                          </a>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => handleEliminarEgreso(eg.id)}
                          className="p-1.5 rounded-xl hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                          title="Eliminar egreso"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* ── MODAL: REGISTRAR NUEVO EGRESO ──────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center pb-4 border-b border-white/[0.08] mb-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                💸 Registrar Gasto Operativo
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarEgreso} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">📝 Concepto / Detalle del Gasto *</label>
                <input
                  type="text"
                  value={form.concepto}
                  onChange={e => setForm({ ...form, concepto: e.target.value })}
                  placeholder="Ej: Pago de planilla semanal, Bolsas de polietileno, etc."
                  className="input-dark w-full text-sm py-2.5 font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">💵 Monto (S/) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.monto}
                    onChange={e => setForm({ ...form, monto: e.target.value })}
                    placeholder="Ej: 350.00"
                    className="input-dark w-full text-sm py-2.5 font-mono font-bold text-rose-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">📅 Fecha *</label>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={e => setForm({ ...form, fecha: e.target.value })}
                    className="input-dark w-full text-sm py-2.5"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🏷️ Categoría de Gasto *</label>
                <CustomSelect
                  value={form.categoria}
                  onChange={val => setForm({ ...form, categoria: val })}
                  options={[
                    { value: 'empaque', label: 'Insumos Empaque (Bolsas/Etiquetas)' },
                    { value: 'repuestos', label: 'Repuestos de Maquinaria' },
                    { value: 'planilla', label: 'Planillas Personal' },
                    { value: 'servicios', label: 'Servicios Básicos (Luz/Agua)' },
                    { value: 'alquiler', label: 'Alquiler de Local' },
                    { value: 'otros', label: 'Otros Gastos' }
                  ]}
                  triggerClassName="text-sm py-2.5 font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">🔗 Enlace a Comprobante / Recibo (opcional)</label>
                <input
                  type="url"
                  value={form.comprobante_url}
                  onChange={e => setForm({ ...form, comprobante_url: e.target.value })}
                  placeholder="https://ejemplo.com/factura.pdf"
                  className="input-dark w-full text-xs"
                />
              </div>

              <div className="flex gap-3 mt-6 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex-1 justify-center py-2.5 bg-rose-600 hover:bg-rose-500 border-none font-bold text-white shadow-lg shadow-rose-600/20"
                >
                  {saving ? 'Guardando...' : 'Registrar Gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
