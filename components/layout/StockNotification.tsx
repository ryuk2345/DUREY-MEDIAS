'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell, AlertTriangle, X, Package, Database, Info, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

interface LowStockProduct {
  id: string
  codigo: string
  modelo: string
  publico: string
  stock: number
}

interface LowStockMaterial {
  id: string
  material: string
  color: string
  stock_kg: number
}

interface StockNotificationProps {
  userRol: string
}

export default function StockNotification({ userRol }: StockNotificationProps) {
  const supabase = createClient()
  const isAuthorized = userRol === 'supervisor' || userRol === 'admin'

  const [isOpen, setIsOpen] = useState(false)
  const [lowProducts, setLowProducts] = useState<LowStockProduct[]>([])
  const [lowMaterials, setLowMaterials] = useState<LowStockMaterial[]>([])
  const [loading, setLoading] = useState(false)

  const checkStock = useCallback(async () => {
    if (!isAuthorized) return
    setLoading(true)
    try {
      // 1. Materia prima con stock menor o igual a 10 kg
      const { data: rawData } = await supabase
        .from('materia_prima')
        .select('id, material, color, stock_kg')
        .lte('stock_kg', 10.000)

      // 2. Productos terminados (catálogo medias)
      const [catRes, paqRes] = await Promise.all([
        supabase.from('catalogo_medias').select('id, codigo, modelo, publico').eq('estado', 'activo'),
        supabase.from('paquetes').select('catalogo_media_id, docenas').in('estado', ['almacenado', 'pendiente_almacenar'])
      ])

      const stockMap: Record<string, number> = {}
      paqRes.data?.forEach(p => {
        if (p.catalogo_media_id) {
          stockMap[p.catalogo_media_id] = (stockMap[p.catalogo_media_id] ?? 0) + Number(p.docenas ?? 0)
        }
      })

      const lowMedias: LowStockProduct[] = []
      catRes.data?.forEach(m => {
        const stock = stockMap[m.id] ?? 0
        if (stock <= 5) {
          lowMedias.push({
            id: m.id,
            codigo: m.codigo,
            modelo: m.modelo,
            publico: m.publico,
            stock
          })
        }
      })

      setLowProducts(lowMedias)
      setLowMaterials((rawData as LowStockMaterial[]) ?? [])
    } catch (error) {
      console.error('Error checking low stock:', error)
    } finally {
      setLoading(false)
    }
  }, [isAuthorized, supabase])

  useEffect(() => {
    if (isAuthorized) {
      checkStock()
      // Verificar cada 60 segundos
      const interval = setInterval(checkStock, 60000)
      return () => clearInterval(interval)
    }
  }, [isAuthorized, checkStock])

  if (!isAuthorized) return null

  const totalAlerts = lowProducts.length + lowMaterials.length

  return (
    <>
      {/* Botón de la campana */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative p-2.5 rounded-xl bg-slate-900/60 border border-white/[0.06] text-slate-300 hover:text-white hover:bg-white/[0.04] transition-all flex items-center justify-center group"
        title="Alertas de Stock"
      >
        <Bell className={`w-5 h-5 ${totalAlerts > 0 ? 'animate-pulse text-amber-400' : ''}`} />
        {totalAlerts > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-slate-950 animate-bounce">
            {totalAlerts}
          </span>
        )}
      </button>

      {/* Panel / Drawer Lateral */}
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Overlay oscuro */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute inset-y-0 right-0 pl-10 max-w-full flex">
            <div className="w-screen max-w-md">
              <div className="h-full flex flex-col bg-slate-950 border-l border-white/[0.08] shadow-2xl overflow-y-scroll">
                
                {/* Cabecera del Panel */}
                <div className="p-6 border-b border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <AlertTriangle className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white">Alertas de Stock Bajo</h2>
                      <p className="text-xs text-slate-400">Notificaciones críticas para el supervisor</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Contenido */}
                <div className="flex-1 p-6 space-y-6">
                  {loading && (
                    <div className="flex items-center justify-center py-10 gap-2 text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">Actualizando stock...</span>
                    </div>
                  )}

                  {!loading && totalAlerts === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                      <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-400">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                      <h3 className="text-white font-semibold">Stock al día</h3>
                      <p className="text-xs text-slate-500 max-w-[240px]">
                        Todos los productos y materias primas tienen niveles de stock saludables.
                      </p>
                    </div>
                  )}

                  {/* 1. SECCIÓN MATERIAS PRIMAS */}
                  {lowMaterials.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Database className="w-4 h-4 text-emerald-400" /> Materias Primas Críticas ({lowMaterials.length})
                      </h3>
                      <div className="space-y-2">
                        {lowMaterials.map((mat) => (
                          <div
                            key={mat.id}
                            className="p-4 rounded-xl bg-red-500/[0.03] border border-red-500/20 hover:border-red-500/40 transition-colors flex items-center justify-between"
                          >
                            <div>
                              <p className="text-sm font-semibold text-white">{mat.material}</p>
                              <p className="text-xs text-slate-500">Color: {mat.color}</p>
                            </div>
                            <div className="text-right">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                {mat.stock_kg.toFixed(3)} kg
                              </span>
                              <p className="text-[10px] text-red-500/80 mt-1 font-medium">Reabastecer urgente</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 2. SECCIÓN PRODUCTOS TERMINADOS */}
                  {lowProducts.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Package className="w-4 h-4 text-blue-400" /> Medias en Stock Crítico ({lowProducts.length})
                      </h3>
                      <div className="space-y-2">
                        {lowProducts.map((prod) => (
                          <div
                            key={prod.id}
                            className="p-4 rounded-xl bg-amber-500/[0.03] border border-amber-500/20 hover:border-amber-500/40 transition-colors flex items-center justify-between"
                          >
                            <div>
                              <p className="text-sm font-semibold text-white font-mono">{prod.codigo}</p>
                              <p className="text-xs text-slate-500 capitalize">{prod.modelo} · {prod.publico}</p>
                            </div>
                            <div className="text-right">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                prod.stock === 0
                                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                  : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                              }`}>
                                {prod.stock} doc.
                              </span>
                              <p className="text-[10px] text-slate-500 mt-1">
                                {prod.stock === 0 ? 'Sin stock' : 'Programar tejido'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer del Drawer */}
                <div className="p-6 border-t border-white/[0.06] bg-slate-950/80 backdrop-blur space-y-3">
                  <div className="flex items-start gap-2 text-xs text-slate-400 bg-white/[0.02] p-3 rounded-xl border border-white/[0.04]">
                    <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p>
                      Los límites de alerta son automáticos: <strong>&lt;= 10 kg</strong> para insumos y <strong>&lt;= 5 docenas</strong> para medias.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href="/dashboard/produccion"
                      onClick={() => setIsOpen(false)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-all shadow-lg shadow-blue-600/10"
                    >
                      Programar Producción <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
