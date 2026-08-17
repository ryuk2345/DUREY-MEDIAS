'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { 
  Database, Plus, Check, X, RefreshCw, Truck, FileText, AlertTriangle, TrendingUp, TrendingDown 
} from 'lucide-react'

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
  fecha: string
  created_at: string
  proveedores?: { nombre: string }
  materia_prima?: { material: string; color: string }
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Data lists
  const [stockHilos, setStockHilos] = useState<MateriaPrima[]>([])
  const [compras, setCompras] = useState<Compra[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])

  // Modal States
  const [showCompraModal, setShowCompraModal] = useState(false)
  const [showQcModal, setShowQcModal] = useState(false)
  const [selectedCompra, setSelectedCompra] = useState<Compra | null>(null)

  // Forms
  const [compraForm, setCompraForm] = useState({
    proveedor_id: '',
    materia_prima_id: '',
    cantidad_kg: '',
    costo_total: ''
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
      const [hilosRes, provRes, comprasRes, movRes] = await Promise.all([
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
        `).order('created_at', { ascending: false }).limit(30)
      ])

      if (hilosRes.error) throw hilosRes.error
      if (provRes.error) throw provRes.error
      if (comprasRes.error) throw comprasRes.error
      if (movRes.error) throw movRes.error

      setStockHilos(hilosRes.data ?? [])
      setProveedores(provRes.data ?? [])
      setCompras((comprasRes.data ?? []) as unknown as Compra[])
      setMovimientos((movRes.data ?? []) as unknown as Movimiento[])
    } catch (err: any) {
      toast.error(`Error al cargar datos: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // ── REGISTRAR ORDEN DE COMPRA ─────────────────────────────────────────────
  const handleRegistrarCompra = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!compraForm.proveedor_id || !compraForm.materia_prima_id || !compraForm.cantidad_kg || !compraForm.costo_total) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.from('compras_materia_prima').insert({
        proveedor_id: compraForm.proveedor_id,
        materia_prima_id: compraForm.materia_prima_id,
        cantidad_kg: parseFloat(compraForm.cantidad_kg),
        costo_total: parseFloat(compraForm.costo_total),
        estado: 'pendiente'
      })

      if (error) throw error

      toast.success('📦 Orden de compra registrada. Pendiente de control de calidad.')
      setShowCompraModal(false)
      setCompraForm({ proveedor_id: '', materia_prima_id: '', cantidad_kg: '', costo_total: '' })
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

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Gestión de Materia Prima (Hilo)</h1>
            <p className="text-slate-400 text-xs font-medium">Control de abastecimiento, compras, movimientos e inspección de control de calidad para las bobinas de hilo de tejeduría</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => setShowCompraModal(true)} 
            className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 border-none flex items-center gap-1.5 font-bold shadow-lg shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" /> Registrar Compra de Hilo
          </button>
          <button 
            onClick={cargarDatos} 
            className="btn-secondary p-2.5 rounded-2xl border-white/[0.08] hover:bg-white/5 text-slate-300"
            title="Recargar datos"
          >
            <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
          </button>
        </div>
      </div>

      {/* Grid: Stock Actual & Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Inventario de Hilo */}
        <div className="lg:col-span-2 glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
          <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            🧵 Niveles Actuales de Inventario de Hilos
          </h2>

          <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-4">Material / Fibra</th>
                  <th className="p-4">Color</th>
                  <th className="p-4 text-right">Stock Disponible (Kg)</th>
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

        {/* Resumen Alertas */}
        <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-white tracking-tight">⚠️ Alertas de Abastecimiento</h2>
            <div className="space-y-3">
              {stockHilos.filter(h => h.stock_kg < 5.0).map(h => (
                <div key={h.id} className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex gap-3 items-start">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold text-white">Stock Crítico de Insumo</h3>
                    <p className="text-[11px] text-slate-400 mt-1">El stock de <strong className="text-red-300">{h.material} {h.color}</strong> es de solo <strong>{Number(h.stock_kg).toFixed(3)} Kg</strong>. Se requiere abastecer urgentemente para evitar bloqueos en el área de tejido.</p>
                  </div>
                </div>
              ))}
              {stockHilos.filter(h => h.stock_kg < 5.0).length === 0 && (
                <div className="p-6 text-center text-slate-400 text-xs">
                  ✨ Todo el stock de insumos se encuentra en niveles adecuados.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/[0.06] text-[11px] text-slate-400 font-medium">
            💡 <strong>Nota del Sistema:</strong> El área de tejido bloqueará automáticamente el encendido de máquinas si el turno requiere más kilogramos de hilo que los que están registrados disponibles aquí.
          </div>
        </div>
      </div>

      {/* Compras e Historial */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Historial de Compras y Control de Calidad */}
        <div className="lg:col-span-2 glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
          <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-400" /> Registro de Compras e Inspecciones
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
                  <th className="p-4 text-center">Estado</th>
                  <th className="p-4 text-center">Inspección</th>
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
                          className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold shadow-lg shadow-emerald-600/10"
                        >
                          Hacer Inspección
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

        {/* Registro de Movimientos de Insumos */}
        <div className="glass rounded-3xl border border-white/[0.08] p-6 shadow-xl space-y-4">
          <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" /> Kárdex de Insumos (Últimos 30)
          </h2>

          <div className="space-y-3 overflow-y-auto max-h-[350px] pr-1">
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
                      {new Date(mov.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── MODAL: REGISTRAR COMPRA ─────────────────────────────────────────── */}
      {showCompraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">📦 Registrar Compra de Hilo</h2>
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
                <label className="block text-slate-300 font-bold mb-1">🧵 Hilo / Insumo</label>
                <select 
                  value={compraForm.materia_prima_id} 
                  onChange={e => setCompraForm(prev => ({ ...prev, materia_prima_id: e.target.value }))}
                  className="input-dark w-full"
                  required
                >
                  <option value="">Selecciona tipo de hilo...</option>
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

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowCompraModal(false)} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center py-2.5 bg-emerald-600 border-none font-bold">
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
    </div>
  )
}
