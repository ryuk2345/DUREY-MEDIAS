// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { formatearMoneda, formatearFecha } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Scale,
  Building2, Package, Wrench, AlertTriangle, Loader2, RefreshCw,
  Calendar, CheckCircle2, ShieldAlert, ArrowUpRight, ArrowDownRight,
  PieChart as PieIcon, Layers
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, Cell, PieChart, Pie
} from 'recharts'

export default function BalancePage() {
  const router = useRouter()
  const supabase = createClient()

  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [ventasTotal, setVentasTotal] = useState(0)
  const [comprasTotal, setComprasTotal] = useState(0)
  const [repairsTotal, setRepairsTotal] = useState(0)
  const [egresosAdicionales, setEgresosAdicionales] = useState<any[]>([])

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

  // 2. Cargar datos financieros
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      const [ventasRes, comprasRes, repRes, egrRes] = await Promise.all([
        supabase.from('cobros').select('monto').eq('estado_validacion', 'validado'),
        supabase.from('compras_materia_prima').select('costo_total, estado, fecha'),
        supabase.from('reparaciones').select('costo_total'),
        supabase.from('egresos_adicionales').select('*').order('fecha', { ascending: false })
      ])

      const totalVentas = (ventasRes.data ?? []).reduce((s, c) => s + (Number(c.monto) || 0), 0)
      setVentasTotal(totalVentas)

      const totalCompras = (comprasRes.data ?? [])
        .filter(c => c.estado === 'recibida')
        .reduce((s, c) => s + (Number(c.costo_total) || 0), 0)
      setComprasTotal(totalCompras)

      const totalRepairs = (repRes.data ?? [])
        .reduce((s, r) => s + (Number(r.costo_total) || 0), 0)
      setRepairsTotal(totalRepairs)

      const localEgresos = JSON.parse(localStorage.getItem('durey_egresos_adicionales') || '[]')
      const remoteEgresos = egrRes.data ?? []
      setEgresosAdicionales(remoteEgresos.length > 0 ? remoteEgresos : localEgresos)
    } catch (err: any) {
      console.error('Error al cargar balance:', err)
      const localEgresos = JSON.parse(localStorage.getItem('durey_egresos_adicionales') || '[]')
      setEgresosAdicionales(localEgresos)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // 3. Métricas Financieras
  const totalEgresosAdic = useMemo(() => {
    return egresosAdicionales.reduce((s, e) => s + (Number(e.monto) || 0), 0)
  }, [egresosAdicionales])

  const totalEgresos = useMemo(() => {
    return comprasTotal + repairsTotal + totalEgresosAdic
  }, [comprasTotal, repairsTotal, totalEgresosAdic])

  const utilidadNeta = useMemo(() => {
    return ventasTotal - totalEgresos
  }, [ventasTotal, totalEgresos])

  const margenOperativo = useMemo(() => {
    if (ventasTotal <= 0) return totalEgresos > 0 ? -100 : 0
    return ((ventasTotal - totalEgresos) / ventasTotal) * 100
  }, [ventasTotal, totalEgresos])

  // Datos para gráficos
  const chartComparativa = useMemo(() => {
    return [
      {
        categoria: 'Consolidado General',
        Ingresos: ventasTotal,
        Egresos: totalEgresos,
        Utilidad: utilidadNeta
      }
    ]
  }, [ventasTotal, totalEgresos, utilidadNeta])

  const desgloseCategorias = useMemo(() => {
    const catMap: Record<string, number> = {
      'Materia Prima': comprasTotal,
      'Reparaciones': repairsTotal,
      'Planillas': 0,
      'Empaques': 0,
      'Servicios': 0,
      'Alquiler': 0,
      'Otros Gastos': 0
    }

    egresosAdicionales.forEach(e => {
      const m = Number(e.monto) || 0
      if (e.categoria === 'planilla') catMap['Planillas'] += m
      else if (e.categoria === 'empaque') catMap['Empaques'] += m
      else if (e.categoria === 'servicios') catMap['Servicios'] += m
      else if (e.categoria === 'alquiler') catMap['Alquiler'] += m
      else catMap['Otros Gastos'] += m
    })

    return Object.entries(catMap)
      .filter(([_, valor]) => valor > 0)
      .map(([nombre, valor]) => ({ nombre, valor }))
  }, [comprasTotal, repairsTotal, egresosAdicionales])

  const PIE_COLORS = ['#10b981', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#64748b']

  if (userRole && userRole !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <ShieldAlert className="w-16 h-16 text-rose-500 mb-4 animate-bounce" />
        <h2 className="text-xl font-bold text-white mb-2">Acceso Restringido</h2>
        <p className="text-sm text-slate-400 max-w-md">
          Este módulo de Balance Financiero es de uso exclusivo del <strong>Administrador General</strong>.
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
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                Balance Financiero: Ventas vs Egresos
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Exclusivo Admin
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Estado de resultados, rentabilidad neta y consolidación de ingresos validados frente a costos operativos
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={cargarDatos}
          disabled={loading}
          className="btn-secondary text-xs py-2 px-3.5 rounded-2xl"
          title="Recargar balance"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar Balance
        </button>
      </div>

      {/* ── TARJETAS PRINCIPALES KPI ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass rounded-3xl p-5 border border-emerald-500/20 bg-emerald-950/10 relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Ingresos por Ventas</span>
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400"><ArrowUpRight className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {formatearMoneda(ventasTotal)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Cobros validados en caja y bancos</p>
        </div>

        <div className="glass rounded-3xl p-5 border border-rose-500/20 bg-rose-950/10 relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-rose-300 uppercase tracking-wider">Egresos Consolidados</span>
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400"><ArrowDownRight className="w-4 h-4" /></div>
          </div>
          <div className="text-2xl font-black text-rose-400 font-mono">
            {formatearMoneda(totalEgresos)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Materia prima + averías + caja chica</p>
        </div>

        <div className={`glass rounded-3xl p-5 border relative overflow-hidden ${
          utilidadNeta >= 0 ? 'border-indigo-500/20 bg-indigo-950/10' : 'border-red-500/20 bg-red-950/10'
        }`}>
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Utilidad Neta</span>
            <div className={`p-2 rounded-xl ${utilidadNeta >= 0 ? 'bg-indigo-500/20 text-indigo-400' : 'bg-red-500/20 text-red-400'}`}>
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-2xl font-black font-mono ${utilidadNeta >= 0 ? 'text-indigo-400' : 'text-red-400'}`}>
            {formatearMoneda(utilidadNeta)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {utilidadNeta >= 0 ? '✓ Ganancia operativa positiva' : '⚠️ Déficit operativo temporal'}
          </p>
        </div>

        <div className="glass rounded-3xl p-5 border border-white/[0.08] relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Margen de Rentabilidad</span>
            <div className="p-2 rounded-xl bg-white/10 text-white"><Scale className="w-4 h-4" /></div>
          </div>
          <div className={`text-2xl font-black font-mono ${margenOperativo >= 20 ? 'text-emerald-400' : margenOperativo >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
            {margenOperativo.toFixed(1)}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all ${
                margenOperativo >= 20 ? 'bg-emerald-500' : margenOperativo >= 0 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, margenOperativo))}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── GRÁFICOS INTERACTIVOS ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico 1: Comparativa de Barras */}
        <div className="glass rounded-3xl p-6 border border-white/[0.08]">
          <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            Comparativa: Ingresos vs Egresos vs Utilidad
          </h2>
          <p className="text-xs text-slate-400 mb-6">Visualización de volúmenes totales en moneda nacional (PEN)</p>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartComparativa} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="categoria" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} tickFormatter={(val) => `S/ ${val.toLocaleString()}`} />
                <Tooltip
                  formatter={(value: any) => [formatearMoneda(Number(value)), '']}
                  contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '1rem', color: '#fff' }}
                />
                <Legend />
                <Bar dataKey="Ingresos" fill="#10b981" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Egresos" fill="#f43f5e" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Utilidad" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Desglose de Egresos por Categoría */}
        <div className="glass rounded-3xl p-6 border border-white/[0.08]">
          <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
            <PieIcon className="w-4 h-4 text-cyan-400" />
            Desglose de Salidas por Categoría
          </h2>
          <p className="text-xs text-slate-400 mb-6">Distribución porcentual de los costos en la empresa</p>

          {desgloseCategorias.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-slate-500 text-xs">
              No hay egresos registrados para mostrar desglose
            </div>
          ) : (
            <div className="h-64 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={desgloseCategorias}
                    dataKey="valor"
                    nameKey="nombre"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ nombre, percent }) => `${nombre} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {desgloseCategorias.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any) => [formatearMoneda(Number(value)), 'Costo']}
                    contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '1rem', color: '#fff' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── TABLA RESUMEN Y AUDITORÍA ──────────────────────────────────────────── */}
      <div className="glass rounded-3xl p-6 border border-white/[0.08] space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          Resumen Consolidado de Cuentas
        </h2>

        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>Rubro Financiero</th>
                <th>Concepto / Origen</th>
                <th className="text-right">Monto Total</th>
                <th className="text-right">Impacto en Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-bold text-emerald-400 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4" /> Ingresos por Ventas
                </td>
                <td className="text-slate-300 text-xs">Cobros validados en ventas de medias</td>
                <td className="text-right font-mono font-bold text-emerald-400">
                  {formatearMoneda(ventasTotal)}
                </td>
                <td className="text-right font-mono text-emerald-400 font-bold">+100.0%</td>
              </tr>
              <tr>
                <td className="font-bold text-rose-400 flex items-center gap-2">
                  <Package className="w-4 h-4" /> Compras Materia Prima
                </td>
                <td className="text-slate-300 text-xs">Hilos, insumos y compras recibidas</td>
                <td className="text-right font-mono font-bold text-rose-400">
                  {formatearMoneda(comprasTotal)}
                </td>
                <td className="text-right font-mono text-rose-400 font-bold">
                  -{ventasTotal > 0 ? ((comprasTotal / ventasTotal) * 100).toFixed(1) : 0}%
                </td>
              </tr>
              <tr>
                <td className="font-bold text-cyan-400 flex items-center gap-2">
                  <Wrench className="w-4 h-4" /> Reparaciones y Averías
                </td>
                <td className="text-slate-300 text-xs">Mantenimiento técnico de maquinaria</td>
                <td className="text-right font-mono font-bold text-cyan-400">
                  {formatearMoneda(repairsTotal)}
                </td>
                <td className="text-right font-mono text-cyan-400 font-bold">
                  -{ventasTotal > 0 ? ((repairsTotal / ventasTotal) * 100).toFixed(1) : 0}%
                </td>
              </tr>
              <tr>
                <td className="font-bold text-amber-400 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" /> Gastos Operativos de Caja
                </td>
                <td className="text-slate-300 text-xs">Planillas, alquiler, servicios y empaques</td>
                <td className="text-right font-mono font-bold text-amber-400">
                  {formatearMoneda(totalEgresosAdic)}
                </td>
                <td className="text-right font-mono text-amber-400 font-bold">
                  -{ventasTotal > 0 ? ((totalEgresosAdic / ventasTotal) * 100).toFixed(1) : 0}%
                </td>
              </tr>
              <tr className="border-t-2 border-white/20 bg-white/[0.02]">
                <td className="font-black text-white text-sm">
                  TOTAL UTILIDAD OPERATIVA
                </td>
                <td className="text-slate-400 text-xs italic">Ingresos Validados - Egresos Consolidados</td>
                <td className={`text-right font-mono font-black text-base ${utilidadNeta >= 0 ? 'text-indigo-400' : 'text-red-400'}`}>
                  {formatearMoneda(utilidadNeta)}
                </td>
                <td className={`text-right font-mono font-black ${utilidadNeta >= 0 ? 'text-indigo-400' : 'text-red-400'}`}>
                  {margenOperativo.toFixed(1)}% Margen
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
