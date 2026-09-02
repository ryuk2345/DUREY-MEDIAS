// @ts-nocheck
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { generarCodigoMedia, generarSkuMedia, formatearMoneda } from '@/lib/utils'
import { Plus, Search, Edit2, Power, AlertTriangle, X, Loader2, Cog, Package, Barcode, Printer, QrCode, Sparkles, Check } from 'lucide-react'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import CustomSelect from '@/components/ui/CustomSelect'

interface CatalogoMedia {
  id: string
  sku?: string
  codigo: string
  modelo: string
  publico: string
  diseno_color: string
  talla: string
  costo_produccion_docena: number
  precio_venta_sugerido: number
  estado: 'activo' | 'inactivo'
}

const MODELOS = ['Tobillera', 'Media larga', 'Media corta', 'Calcetín ejecutivo', 'Media deportiva']
const PUBLICOS = ['Dama', 'Hombre', 'Niño', 'Niña', 'Unisex']

export default function CatalogoPage() {
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [filtro, setFiltro] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'inactivo'>('todos')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editando, setEditando] = useState<CatalogoMedia | null>(null)
  
  // Modal de impresión de etiqueta de código de barras
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [mediaBarcodeImprimir, setMediaBarcodeImprimir] = useState<CatalogoMedia | null>(null)
  const [qrDataUrlModal, setQrDataUrlModal] = useState('')

  const supabase = createClient()

  // Formulario
  const [form, setForm] = useState({
    sku: '',
    codigo: '',
    modelo: '',
    publico: '',
    diseno_color: '',
    talla: '',
    costo_produccion_docena: '',
    precio_venta_sugerido: ''
  })

  const codigoPreview = form.codigo.trim() || (form.modelo && form.publico && form.diseno_color && form.talla
    ? generarCodigoMedia(form.modelo, form.publico, form.diseno_color, form.talla)
    : '')

  const skuPreview = form.sku || (form.modelo && form.publico && form.diseno_color && form.talla
    ? generarSkuMedia(form.modelo, form.publico, form.diseno_color, form.talla)
    : '')

  const cargarCatalogo = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('catalogo_medias').select('*').order('modelo')
    setCatalogo(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { cargarCatalogo() }, [cargarCatalogo])

  const catalogoFiltrado = catalogo.filter(item => {
    const matchTexto = (item.sku && item.sku.toLowerCase().includes(filtro.toLowerCase())) ||
      item.codigo.toLowerCase().includes(filtro.toLowerCase()) ||
      item.modelo.toLowerCase().includes(filtro.toLowerCase())
    const matchEstado = filtroEstado === 'todos' || item.estado === filtroEstado
    return matchTexto && matchEstado
  })

  const abrirNuevo = () => {
    setEditando(null)
    setForm({ sku: '', codigo: '', modelo: '', publico: '', diseno_color: '', talla: '', costo_produccion_docena: '', precio_venta_sugerido: '' })
    setShowModal(true)
  }

  const abrirEditar = (item: CatalogoMedia) => {
    setEditando(item)
    setForm({
      sku: item.sku || generarSkuMedia(item.modelo, item.publico, item.diseno_color, item.talla),
      codigo: item.codigo,
      modelo: item.modelo,
      publico: item.publico,
      diseno_color: item.diseno_color,
      talla: item.talla,
      costo_produccion_docena: String(item.costo_produccion_docena),
      precio_venta_sugerido: String(item.precio_venta_sugerido ?? 0)
    })
    setShowModal(true)
  }

  const autoGenerarCodigo = () => {
    if (!form.modelo || !form.publico || !form.diseno_color || !form.talla) {
      toast.error('Completa modelo, público, diseño y talla para auto-generar el código')
      return
    }
    const nuevoCod = generarCodigoMedia(form.modelo, form.publico, form.diseno_color, form.talla)
    setForm(prev => ({ ...prev, codigo: nuevoCod }))
    toast.success(`Código generado: ${nuevoCod}`)
  }

  const autoGenerarSku = () => {
    if (!form.modelo || !form.publico || !form.diseno_color || !form.talla) {
      toast.error('Completa modelo, público, diseño y talla para generar el SKU')
      return
    }
    const nuevoSku = generarSkuMedia(form.modelo, form.publico, form.diseno_color, form.talla)
    setForm(prev => ({ ...prev, sku: nuevoSku }))
    toast.success(`SKU generado: ${nuevoSku}`)
  }

  const guardar = async () => {
    if (!form.modelo || !form.publico || !form.diseno_color || !form.talla || !form.costo_produccion_docena) {
      toast.error('Completa todos los campos obligatorios')
      return
    }

    const codigoFinal = form.codigo.trim().toLowerCase().replace(/\s+/g, '_') || generarCodigoMedia(form.modelo, form.publico, form.diseno_color, form.talla)
    const skuFinal = form.sku.trim().toUpperCase() || generarSkuMedia(form.modelo, form.publico, form.diseno_color, form.talla)

    const payload = {
      sku: skuFinal,
      codigo: codigoFinal,
      modelo: form.modelo,
      publico: form.publico,
      diseno_color: form.diseno_color,
      talla: form.talla,
      costo_produccion_docena: parseFloat(form.costo_produccion_docena),
      precio_venta_sugerido: parseFloat(form.precio_venta_sugerido) || 0,
    }

    if (editando) {
      const { error } = await supabase.from('catalogo_medias').update(payload).eq('id', editando.id)
      if (error) { 
        toast.error(`Error al actualizar: ${error.message}`)
        console.error('Error al actualizar catálogo:', error)
        return 
      }
      toast.success('Producto actualizado con su SKU escaneable')
    } else {
      const { error } = await supabase.from('catalogo_medias').insert({ ...payload, estado: 'activo' })
      if (error) { 
        toast.error(`Error al guardar: ${error.message}`)
        console.error('Error al insertar catálogo:', error)
        return 
      }
      toast.success('Nuevo producto registrado con su SKU escaneable')
    }
    setShowModal(false)
    cargarCatalogo()
  }

  const toggleEstado = async (item: CatalogoMedia) => {
    const nuevoEstado = item.estado === 'activo' ? 'inactivo' : 'activo'
    const { error } = await supabase.from('catalogo_medias').update({ estado: nuevoEstado }).eq('id', item.id)
    if (error) { toast.error('Error al cambiar estado'); return }
    toast.success(nuevoEstado === 'activo' ? 'Producto reactivado' : 'Producto dado de baja (baja lógica)')
    cargarCatalogo()
  }

  // Imprimir Etiqueta de Barcode SKU de Media
  const prepararEImprimirBarcode = async (item: CatalogoMedia) => {
    const skuVal = item.sku || generarSkuMedia(item.modelo, item.publico, item.diseno_color, item.talla)
    setMediaBarcodeImprimir(item)

    const qrUrl = await QRCode.toDataURL(JSON.stringify({ sku: skuVal, codigo: item.codigo }), { width: 250, margin: 2 })
    setQrDataUrlModal(qrUrl)
    setShowPrintModal(true)
  }

  const ejecutarImpresionEtiquetaMedia = () => {
    if (!mediaBarcodeImprimir) return

    const skuVal = mediaBarcodeImprimir.sku || generarSkuMedia(mediaBarcodeImprimir.modelo, mediaBarcodeImprimir.publico, mediaBarcodeImprimir.diseno_color, mediaBarcodeImprimir.talla)

    const html = `
      <html>
        <head>
          <title>Etiqueta Barcode SKU — ${skuVal}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 15px; color: #0f172a; text-align: center; }
            .sticker { border: 2px solid #0f172a; border-radius: 12px; padding: 15px; max-width: 320px; margin: 0 auto; background: #fff; }
            .brand { font-size: 16px; font-weight: 900; color: #1e3a8a; margin: 0; }
            .sku { font-family: monospace; font-size: 18px; font-weight: bold; color: #059669; margin: 6px 0; background: #ecfdf5; padding: 4px; border-radius: 6px; }
            .qr { width: 140px; height: 140px; margin: 8px auto; }
            .info { font-size: 11px; color: #475569; margin-top: 4px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="sticker">
            <h1 class="brand">DUREY HOSIERY</h1>
            <div class="sku">${skuVal}</div>
            <img src="${qrDataUrlModal}" class="qr" />
            <div class="info">${mediaBarcodeImprimir.modelo} ${mediaBarcodeImprimir.publico} (${mediaBarcodeImprimir.talla})</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">1 DOCENA = 12 PARES</div>
          </div>
        </body>
      </html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* Header */}
      <div className="flex items-center justify-between glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Cog className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Catálogo de Medias y SKUs Escaneables</h1>
            <p className="text-slate-400 text-xs font-medium">Gestión de códigos de producto, SKUs escaneables por pistola, atributos y costos por docena</p>
          </div>
        </div>
        <button onClick={abrirNuevo} className="btn-primary py-2.5 px-4 bg-cyan-600 hover:bg-cyan-500 border-none font-bold text-xs shadow-lg shadow-cyan-600/20">
          <Plus className="w-4 h-4" /> Nuevo Producto
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Productos', value: catalogo.length, color: 'text-cyan-400' },
          { label: 'Activos (Disponibles)', value: catalogo.filter(c => c.estado === 'activo').length, color: 'text-emerald-400' },
          { label: 'Inactivos (Baja Lógica)', value: catalogo.filter(c => c.estado === 'inactivo').length, color: 'text-slate-500' },
        ].map(s => (
          <div key={s.label} className="glass rounded-3xl p-5 border border-white/[0.08]">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`text-3xl font-black font-mono ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por SKU, código o modelo..."
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            className="input-dark pl-10 text-xs font-semibold"
          />
        </div>
        <CustomSelect
          value={filtroEstado}
          onChange={val => setFiltroEstado(val as any)}
          options={[
            { value: 'todos', label: 'Todos los Estados' },
            { value: 'activo', label: 'Solo Activos' },
            { value: 'inactivo', label: 'Solo Inactivos' }
          ]}
          className="w-44"
          triggerClassName="text-xs font-bold text-slate-300"
        />
      </div>

      {/* Tabla */}
      <div className="glass rounded-3xl overflow-hidden border border-white/[0.08]">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-cyan-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>SKU Escaneable (Pistola)</th>
                  <th>Código de Producto</th>
                  <th>Modelo</th>
                  <th>Público</th>
                  <th>Diseño / Color</th>
                  <th>Talla</th>
                  <th>Costo Docena</th>
                  <th>Venta Docena</th>
                  <th>Ganancia / Margen</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {catalogoFiltrado.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-500">No se encontraron productos en el catálogo</td></tr>
                ) : catalogoFiltrado.map(item => {
                  return (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                      <td>
                        <code className="text-emerald-300 font-mono text-xs bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 font-bold flex items-center gap-1.5 w-fit">
                          <Barcode className="w-3.5 h-3.5 text-emerald-400" /> {item.sku || generarSkuMedia(item.modelo, item.publico, item.diseno_color, item.talla)}
                        </code>
                      </td>
                      <td><code className="text-cyan-300 font-mono text-xs font-semibold">{item.codigo}</code></td>
                      <td className="font-bold text-white text-xs">{item.modelo}</td>
                      <td className="text-slate-300 text-xs">{item.publico}</td>
                      <td className="text-slate-300 text-xs capitalize">{item.diseno_color}</td>
                      <td><span className="badge bg-slate-800 text-slate-200 border-slate-700 font-mono font-bold text-xs">{item.talla}</span></td>
                      <td className="font-bold text-red-400 font-mono text-xs">{formatearMoneda(item.costo_produccion_docena)}</td>
                      <td className="font-bold text-emerald-400 font-mono text-xs">{formatearMoneda(item.precio_venta_sugerido ?? 0)}</td>
                      <td>
                        {(() => {
                          const costo = Number(item.costo_produccion_docena) || 0
                          const venta = Number(item.precio_venta_sugerido) || 0
                          const ganancia = Math.max(0, venta - costo)
                          const margen = venta > 0 ? Math.round((ganancia / venta) * 100) : 0
                          return (
                            <span className={`text-xs font-semibold ${ganancia > 0 ? 'text-pink-400' : 'text-slate-500'}`}>
                              {formatearMoneda(ganancia)} ({margen}%)
                            </span>
                          )
                        })()}
                      </td>
                      <td>
                        <span className={`badge ${item.estado === 'activo' ? 'badge-success' : 'badge-neutral'}`}>
                          {item.estado === 'activo' ? '• Activo' : '• Inactivo'}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => prepararEImprimirBarcode(item)} className="btn-secondary py-1 px-2.5 text-xs text-emerald-300 border-emerald-500/30" title="Imprimir etiqueta con código de barras">
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => abrirEditar(item)} className="btn-secondary py-1 px-2.5 text-xs" title="Editar">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => toggleEstado(item)} className={`p-2 rounded-xl transition-colors ${item.estado === 'activo' ? 'text-slate-500 hover:text-red-400' : 'text-emerald-400'}`} title={item.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}>
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Nuevo / Editar Producto */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-lg p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
              <h2 className="text-lg font-bold text-white">{editando ? 'Editar Producto del Catálogo' : 'Nuevo Producto en Catálogo'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4 text-xs">
              {/* CÓDIGO INTERNO PERSONALIZABLE / VARIABLE */}
              <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-cyan-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold text-cyan-300 uppercase tracking-wider">
                    Código Interno / Personalizado del Producto
                  </label>
                  <button type="button" onClick={autoGenerarCodigo} className="text-[10px] text-cyan-400 font-bold hover:underline flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-Generar Código
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Ej. tobillera_dama_diseno_unica o DEP-HOM-BLA-10"
                  value={form.codigo}
                  onChange={e => setForm({ ...form, codigo: e.target.value })}
                  className="input-dark text-xs font-mono font-bold text-cyan-300 border-cyan-500/40 w-full"
                />
                <p className="text-[10px] text-slate-400">Puedes escribir un código variable personalizado o usar Auto-Generar según el modelo y talla.</p>
              </div>

              {/* SKU Escaneable por Pistola */}
              <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-bold text-emerald-300 uppercase tracking-wider">
                    SKU Escaneable para Pistola de Código de Barras
                  </label>
                  <button type="button" onClick={autoGenerarSku} className="text-[10px] text-cyan-400 font-bold hover:underline flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-Generar SKU
                  </button>
                </div>
                <div className="relative">
                  <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400" />
                  <input
                    type="text"
                    placeholder="Ej. SKU-TOB-DAM-DIS-UNI"
                    value={form.sku}
                    onChange={e => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                    className="input-dark pl-9 text-xs font-mono font-bold text-emerald-300 border-emerald-500/40 w-full"
                  />
                </div>
                <p className="text-[10px] text-slate-400">Este SKU es el código único que leerá la pistola de código de barras en empaque y salones.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Modelo *</label>
                  <CustomSelect
                    value={form.modelo}
                    onChange={val => setForm({ ...form, modelo: val })}
                    options={[
                      { value: '', label: 'Seleccionar...' },
                      ...MODELOS.map(m => ({ value: m, label: m }))
                    ]}
                    placeholder="Seleccionar..."
                    triggerClassName="font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Público *</label>
                  <CustomSelect
                    value={form.publico}
                    onChange={val => setForm({ ...form, publico: val })}
                    options={[
                      { value: '', label: 'Seleccionar...' },
                      ...PUBLICOS.map(p => ({ value: p, label: p }))
                    ]}
                    placeholder="Seleccionar..."
                    triggerClassName="font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Diseño / Color *</label>
                  <input type="text" placeholder="Ej. Con diseño / Negro" value={form.diseno_color} onChange={e => setForm({ ...form, diseno_color: e.target.value })} className="input-dark w-full" />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Talla *</label>
                  <input type="text" placeholder="Ej. 10-13 / Única / 5" value={form.talla} onChange={e => setForm({ ...form, talla: e.target.value })} className="input-dark w-full" />
                </div>
              </div>

               <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Costo de Producción por Docena (S/) *</label>
                  <input type="number" step="0.5" placeholder="10.00" value={form.costo_produccion_docena} onChange={e => setForm({ ...form, costo_produccion_docena: e.target.value })} className="input-dark font-mono font-bold w-full" />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Precio Venta por Docena (S/) *</label>
                  <input type="number" step="0.5" placeholder="15.00" value={form.precio_venta_sugerido} onChange={e => setForm({ ...form, precio_venta_sugerido: e.target.value })} className="input-dark font-mono font-bold w-full text-emerald-400" />
                </div>
              </div>

              {(() => {
                const costo = parseFloat(form.costo_produccion_docena) || 0
                const venta = parseFloat(form.precio_venta_sugerido) || 0
                const ganancia = Math.max(0, venta - costo)
                const margen = venta > 0 ? Math.round((ganancia / venta) * 100) : 0
                if (costo > 0 && venta > 0) {
                  return (
                    <div className="p-3.5 rounded-2xl bg-pink-500/[0.04] border border-pink-500/20 flex justify-between items-center text-xs">
                      <div>
                        <span className="text-slate-400">Ganancia Est. por Docena:</span>
                        <p className="text-base font-black text-pink-400">{formatearMoneda(ganancia)}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400">Margen de Utilidad:</span>
                        <p className="text-base font-black text-cyan-400">{margen}%</p>
                      </div>
                    </div>
                  )
                }
                return null
              })()}

              {codigoPreview && (
                <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/[0.06] text-slate-400 font-mono text-[11px] space-y-1">
                  <div>Código Interno: <strong className="text-cyan-300">{codigoPreview}</strong></div>
                  <div>SKU Resultado: <strong className="text-emerald-400">{skuPreview}</strong></div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">Cancelar</button>
              <button onClick={guardar} className="btn-primary flex-1 justify-center py-2 text-xs bg-cyan-600 border-none font-bold shadow-lg shadow-cyan-600/20">
                <Check className="w-4 h-4" /> Guardar Producto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Impresión de Etiqueta Barcode SKU */}
      {showPrintModal && mediaBarcodeImprimir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-sm p-7 shadow-2xl border border-emerald-500/30 text-center space-y-4 animate-fadeInUp">
            <h2 className="text-lg font-bold text-white">Etiqueta Barcode SKU</h2>
            <p className="text-xs text-slate-400">{mediaBarcodeImprimir.modelo} {mediaBarcodeImprimir.publico} ({mediaBarcodeImprimir.talla})</p>

            <div className="p-4 bg-white rounded-2xl">
              <code className="text-xl font-black text-emerald-600 font-mono block mb-2">
                {mediaBarcodeImprimir.sku || generarSkuMedia(mediaBarcodeImprimir.modelo, mediaBarcodeImprimir.publico, mediaBarcodeImprimir.diseno_color, mediaBarcodeImprimir.talla)}
              </code>
              <img src={qrDataUrlModal} alt="Barcode QR" className="w-44 h-44 mx-auto" />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowPrintModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">Cerrar</button>
              <button onClick={ejecutarImpresionEtiquetaMedia} className="btn-primary flex-1 justify-center py-2 text-xs bg-emerald-600 border-none font-bold shadow-lg shadow-emerald-600/20 flex items-center gap-1">
                <Printer className="w-4 h-4" /> Imprimir Etiqueta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


