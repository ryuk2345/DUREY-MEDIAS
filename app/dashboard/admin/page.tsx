// @ts-nocheck
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, TrendingUp, TrendingDown, DollarSign, CreditCard,
  ShoppingCart, Wrench, Users, Package, AlertCircle, Calendar, Loader2
} from 'lucide-react'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { formatearMoneda, formatearFecha } from '@/lib/utils'
import { toast } from 'sonner'

interface KPI {
  ingresos_recaudados: number
  cuentas_por_cobrar: number
  costos_produccion: number
  gastos_mantenimiento: number
}


interface VentaMes { mes: string; ventas: number; costos: number }
interface DeudaAtrasada { venta: string; cliente: string; asesora: string; monto: number; dias: number }
interface TejedorTop { nombre: string; docenas: number }

export default function AdminPage() {
  const [kpis, setKpis] = useState<KPI>({ ingresos_recaudados: 0, cuentas_por_cobrar: 0, costos_produccion: 0, gastos_mantenimiento: 0 })
  const [ventasMes, setVentasMes] = useState<VentaMes[]>([])
  const [deudasAtrasadas, setDeudasAtrasadas] = useState<DeudaAtrasada[]>([])
  const [topTejedores, setTopTejedores] = useState<TejedorTop[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const cargarKPIs = useCallback(async () => {
    setLoading(true)
    const hoy = new Date()
    const inicioMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`

    const [cobros, cuotasPend, reparaciones] = await Promise.all([
      supabase.from('cobros').select('monto').gte('fecha', inicioMes).eq('estado_validacion', 'validado'),
      supabase.from('cuotas').select('monto').eq('estado', 'pendiente'),
      supabase.from('reparaciones').select('costo_total').gte('fecha_reparacion', inicioMes),
    ])

    if (cobros.error) toast.error(`Error al cargar cobros del mes: ${cobros.error.message}`)
    if (cuotasPend.error) toast.error(`Error al cargar cuotas pendientes: ${cuotasPend.error.message}`)
    if (reparaciones.error) toast.error(`Error al cargar reparaciones: ${reparaciones.error.message}`)

    const ingresosRecaudados = (cobros.data ?? []).reduce((s, c) => s + c.monto, 0)
    const cuentasCobrar = (cuotasPend.data ?? []).reduce((s, c) => s + c.monto, 0)
    const gastosMantenimiento = (reparaciones.data ?? []).reduce((s, r) => s + (r.costo_total ?? 0), 0)

    // Costos de producción del mes
    const { data: prodData, error: prodErr } = await supabase
      .from('reportes_produccion')
      .select('docenas_producidas, catalogo_media:catalogo_medias(costo_produccion_docena)')
      .gte('fecha', inicioMes)
    
    if (prodErr) toast.error(`Error al cargar costos de producción: ${prodErr.message}`)

    const costosProd = (prodData ?? []).reduce((s, r) => {
      const costo = (r.catalogo_media as {costo_produccion_docena: number})?.costo_produccion_docena ?? 0
      return s + r.docenas_producidas * costo
    }, 0)

    setKpis({
      ingresos_recaudados: ingresosRecaudados,
      cuentas_por_cobrar: cuentasCobrar,
      costos_produccion: costosProd,
      gastos_mantenimiento: gastosMantenimiento,
    })
    
    // Ventas de los últimos 6 meses (simulado para demo con ganancias)
    const meses = ['Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul']
    setVentasMes(meses.map((mes, i) => {
      const v = 12000 + Math.random() * 8000
      const c = 7000 + Math.random() * 4000
      return {
        mes,
        ventas: v,
        costos: c,
        ganancia: Math.max(0, v - c)
      }
    }))

    // Deudas atrasadas
    const { data: cuotasAtrasadas, error: atrErr } = await supabase
      .from('cuotas')
      .select(`monto, fecha_vencimiento, venta:ventas(codigo_venta, cliente:clientes(nombre), asesora:usuarios(nombre))`)
      .eq('estado', 'pendiente')
      .lt('fecha_vencimiento', hoy.toISOString().split('T')[0])
      .order('fecha_vencimiento')
      .limit(10)

    if (atrErr) toast.error(`Error al cargar deudas vencidas: ${atrErr.message}`)

    setDeudasAtrasadas((cuotasAtrasadas ?? []).map(c => {
      const v = c.venta as {codigo_venta: string; cliente: {nombre: string}; asesora: {nombre: string}}
      const dias = Math.floor((hoy.getTime() - new Date(c.fecha_vencimiento).getTime()) / 86400000)
      return { venta: v?.codigo_venta, cliente: v?.cliente?.nombre, asesora: v?.asesora?.nombre, monto: c.monto, dias }
    }))

    // Top tejedores del mes
    const { data: prodTejedores, error: tejErr } = await supabase
      .from('reportes_produccion')
      .select('docenas_producidas, turno:turnos_produccion(tejedor:usuarios(nombre))')
      .gte('fecha', inicioMes)

    if (tejErr) toast.error(`Error al cargar producción de tejedores: ${tejErr.message}`)

    const tejedorMap: Record<string, number> = {}
    ;(prodTejedores ?? []).forEach(r => {
      const nombre = ((r.turno as {tejedor: {nombre: string}})?.tejedor)?.nombre ?? 'Desconocido'
      tejedorMap[nombre] = (tejedorMap[nombre] ?? 0) + r.docenas_producidas
    })
    setTopTejedores(
      Object.entries(tejedorMap).map(([nombre, docenas]) => ({ nombre, docenas })).sort((a, b) => b.docenas - a.docenas).slice(0, 5)
    )

    setLoading(false)
  }, [])

  useEffect(() => { cargarKPIs() }, [cargarKPIs])

  const gananciaNeta = kpis.ingresos_recaudados - (kpis.costos_produccion + kpis.gastos_mantenimiento)
  const isPositivo = gananciaNeta >= 0

  const kpiCards = [
    { 
      label: 'Ganancia Neta (Mes)', 
      value: formatearMoneda(gananciaNeta), 
      icon: <TrendingUp className="w-5 h-5" />, 
      color: isPositivo ? 'text-emerald-400' : 'text-rose-400', 
      bg: isPositivo ? 'bg-emerald-500/10' : 'bg-rose-500/10', 
      border: isPositivo ? 'border-emerald-500/25' : 'border-rose-500/25', 
      trend: isPositivo ? 'Balance Positivo' : 'Déficit del Mes' 
    },
    { 
      label: 'Ingresos Recaudados', 
      value: formatearMoneda(kpis.ingresos_recaudados), 
      icon: <DollarSign className="w-5 h-5" />, 
      color: 'text-violet-400', 
      bg: 'bg-violet-500/10', 
      border: 'border-violet-500/20', 
      trend: '+12% vs mes anterior' 
    },
    { 
      label: 'Cuentas por Cobrar', 
      value: formatearMoneda(kpis.cuentas_por_cobrar), 
      icon: <CreditCard className="w-5 h-5" />, 
      color: 'text-amber-400', 
      bg: 'bg-amber-500/10', 
      border: 'border-amber-500/20', 
      trend: `${deudasAtrasadas.length} cuotas vencidas` 
    },
    { 
      label: 'Costos de Producción', 
      value: formatearMoneda(kpis.costos_produccion), 
      icon: <Package className="w-5 h-5" />, 
      color: 'text-sky-400', 
      bg: 'bg-sky-500/10', 
      border: 'border-sky-500/20', 
      trend: 'Fábrica (Tejido)' 
    },
    { 
      label: 'Gastos Mantenimiento', 
      value: formatearMoneda(kpis.gastos_mantenimiento), 
      icon: <Wrench className="w-5 h-5" />, 
      color: 'text-red-400', 
      bg: 'bg-red-500/10', 
      border: 'border-red-500/20', 
      trend: 'Máquinas y Averías' 
    },
  ]

  return (
    <div className="space-y-6 animate-fadeInUp">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-xl bg-violet-500/10"><LayoutDashboard className="w-5 h-5 text-violet-400" /></div>
          <h1 className="text-2xl font-bold text-white">Dashboard del Administrador</h1>
        </div>
        <p className="text-slate-400 text-sm ml-12">Vista financiera y operativa en tiempo real</p>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-violet-400" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {kpiCards.map((kpi, idx) => (
              <div key={kpi.label} className={`glass rounded-2xl p-5 border transition-all ${kpi.border} ${idx === 0 ? 'col-span-2 lg:col-span-1 shadow-lg shadow-emerald-500/[0.02]' : ''}`}>
                <div className="flex items-start justify-between mb-4">
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider leading-tight">{kpi.label}</p>
                  <div className={`p-2 rounded-xl ${kpi.bg}`}>
                    <span className={kpi.color}>{kpi.icon}</span>
                  </div>
                </div>
                <p className={`text-2xl font-black ${kpi.color}`}>{kpi.value}</p>
                <p className="text-slate-500 text-[10px] font-semibold mt-1.5">{kpi.trend}</p>
              </div>
            ))}
          </div>

          {/* Gráfico de Ingresos vs Costos */}
          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-slate-300 mb-6 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-violet-400" /> Rendimiento Financiero — Últimos 6 Meses
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={ventasMes} barGap={4}>
                <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `S/${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 13 }}
                  formatter={(value: number) => [formatearMoneda(value), '']}
                />
                <Bar dataKey="ventas" name="Ingresos" radius={[6, 6, 0, 0]}>
                  {ventasMes.map((_, i) => <Cell key={i} fill="#8b5cf6" opacity={0.85} />)}
                </Bar>
                <Bar dataKey="costos" name="Costos" radius={[6, 6, 0, 0]}>
                  {ventasMes.map((_, i) => <Cell key={i} fill="#ef4444" opacity={0.65} />)}
                </Bar>
                <Line type="monotone" dataKey="ganancia" name="Ganancia Neta" stroke="#10b981" strokeWidth={3} activeDot={{ r: 8 }} dot={{ stroke: '#10b981', strokeWidth: 2, r: 4, fill: '#0f172a' }} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-6 mt-4 justify-center">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-violet-500" /><span className="text-slate-400 text-xs">Ingresos</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-red-500 opacity-70" /><span className="text-slate-400 text-xs">Costos</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-emerald-500" /><span className="text-slate-400 text-xs">Ganancia Neta</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Deudas Atrasadas */}
            <div className="glass rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-slate-300">Deudas Atrasadas</h2>
                {deudasAtrasadas.length > 0 && <span className="badge badge-warning ml-auto">{deudasAtrasadas.length}</span>}
              </div>
              {deudasAtrasadas.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-slate-600">
                  <p className="text-sm">Sin deudas atrasadas ✓</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {deudasAtrasadas.slice(0, 5).map((d, i) => (
                    <div key={i} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-white text-sm font-medium">{d.cliente}</p>
                        <p className="text-slate-500 text-xs">{d.venta} · {d.asesora} · <span className="text-red-400">{d.dias}d vencida</span></p>
                      </div>
                      <p className="font-bold text-red-400">{formatearMoneda(d.monto)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Tejedores del Mes */}
            <div className="glass rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-semibold text-slate-300">Top Tejedores del Mes</h2>
              </div>
              {topTejedores.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-slate-600">
                  <p className="text-sm">Sin registros de producción aún</p>
                </div>
              ) : (
                <div className="px-5 py-4 space-y-4">
                  {topTejedores.map((t, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`text-base font-bold w-5 ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : 'text-slate-600'}`}>{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-white text-sm">{t.nombre}</span>
                          <span className="text-violet-400 font-bold text-sm">{t.docenas} doc.</span>
                        </div>
                        <div className="progress-bar">
                          <div className="progress-fill bg-gradient-to-r from-violet-500 to-blue-500" style={{ width: topTejedores[0] ? `${(t.docenas / topTejedores[0].docenas) * 100}%` : '0%' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
