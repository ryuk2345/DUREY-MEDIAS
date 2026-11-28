'use client'

// Tejido 24/6 (Fase 5A, migración 032): cada tejedora tiene un producto fijo que
// solo cambian administrador y supervisor; cada turno (día o noche) se registran,
// por máquina, las docenas producidas y el operario. El hilo se descuenta por las
// docenas reales. Las reglas viven en lib/domain/tejido.ts y en las funciones SQL.
import BuscadorConSugerencias from '@/components/ui/BuscadorConSugerencias'
import { sugerir, sugerirProductos, MAX_SUGERENCIAS } from '@/lib/domain/catalogo'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatearFecha } from '@/lib/utils'
import { listarUsuarios } from '@/lib/api/usuarios'
import { obtenerUsuarioActual } from '@/lib/auth/usuarioActual'
import { Cpu, Search, Loader2, Save, RefreshCw, Pencil, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { productoVigente, registraProduccion, docenasValidas, puedeSupervisarTejido, type ProductoMaquina } from '@/lib/domain/tejido'
import { hoyLocal } from '@/lib/domain/mantenimiento'
import SelectorMedia from '@/components/ui/SelectorMedia'
import Modal from '@/components/ui/Modal'

interface Marca { id: string; nombre: string }
interface Maquina { id: string; codigo: string; marca_id: string; estado: string; marca?: { nombre: string } | null }
interface Persona { id: string; nombre: string }
interface CatalogoMedia { id: string; codigo: string; modelo: string; publico: string; talla: string; sku?: string; diseno_color?: string; es_crudo?: boolean }
interface Reporte { id: string; maquina_id: string; docenas_producidas: number; operario_id: string | null; created_at: string }
interface TurnoRegistro { id: string; tejedor_id: string; tejedor?: { nombre: string } | null }

const ESTADO_TEXTO: Record<string, string> = {
  activa: 'En marcha', ocupada: 'En marcha', standby: 'Standby', malograda: 'Falla', mantenimiento: 'Mantenimiento', inactiva: 'Inactiva',
}

export default function ProduccionTejidoPage() {
  const supabase = createClient()
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [productos, setProductos] = useState<(ProductoMaquina & { id: string })[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoMedia[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [rol, setRol] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [busqueda, setBusqueda] = useState('')
  const [marcaFiltro, setMarcaFiltro] = useState('todas')

  // Turno que se registra
  const [fecha, setFecha] = useState(hoyLocal())
  const [horario, setHorario] = useState<'dia' | 'noche'>('dia')
  const [encargadoId, setEncargadoId] = useState('')
  const [turno, setTurno] = useState<TurnoRegistro | null>(null)
  const [reportes, setReportes] = useState<Reporte[]>([])
  const [planilla, setPlanilla] = useState<Record<string, { docenas: string; operario: string }>>({})
  const [guardando, setGuardando] = useState(false)

  // Modales
  const [cambio, setCambio] = useState<{ maquina: Maquina; producto: string } | null>(null)
  const [correccion, setCorreccion] = useState<{ reporte: Reporte; codigo: string; docenas: string; operario: string } | null>(null)

  const supervisa = puedeSupervisarTejido(rol)

  // Lecturas: devuelven los datos; el estado se fija fuera (efectos y recargas)
  const leerBase = useCallback(async () => {
    const hoy = hoyLocal()
    const [mar, maq, pm, cat, tejedores, asig, usuario] = await Promise.all([
      supabase.from('marcas_maquinas').select('id, nombre').order('nombre'),
      supabase.from('maquinas').select('id, codigo, marca_id, estado, marca:marcas_maquinas(nombre)').eq('tipo', 'tejedora').order('codigo'),
      supabase.from('productos_maquina').select('id, maquina_id, catalogo_media_id, desde, hasta'),
      supabase.from('catalogo_medias').select('id, sku, codigo, modelo, publico, diseno_color, talla, es_crudo').eq('estado', 'activo').order('codigo'),
      listarUsuarios({ rol: 'tejedor', campos: 'id,nombre' }),
      supabase.from('asignaciones_turno').select('operador:usuarios(id, nombre)').eq('area', 'tejido').eq('fecha', hoy),
      obtenerUsuarioActual(),
    ])
    for (const [nombre, r] of [['marcas', mar], ['máquinas', maq], ['productos de las máquinas', pm], ['catálogo', cat]] as const) {
      if (r.error) toast.error(`Error cargando ${nombre}: ${r.error.message}`)
    }
    // Operarios: tejedores y quienes están en el Calendario de Turnos de tejido hoy
    const mapa = new Map<string, Persona>(tejedores.map(u => [u.id, { id: u.id, nombre: u.nombre }]))
    for (const a of (asig.data ?? []) as unknown as { operador: Persona | null }[]) if (a.operador) mapa.set(a.operador.id, a.operador)
    return {
      marcas: (mar.data ?? []) as Marca[],
      maquinas: (maq.data ?? []) as unknown as Maquina[],
      productos: (pm.data ?? []) as (ProductoMaquina & { id: string })[],
      catalogo: (cat.data ?? []) as CatalogoMedia[],
      personas: [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      rol: usuario?.rol ?? null,
    }
  }, [supabase])

  const leerTurno = useCallback(async () => {
    const t = await supabase.from('turnos_produccion').select('id, tejedor_id, tejedor:usuarios(nombre)')
      .eq('registro_24_6', true).eq('fecha', fecha).eq('horario', horario).maybeSingle()
    // Si falla, no se deja a la vista el turno de otra fecha u horario
    if (t.error) { toast.error(`Error cargando el turno: ${t.error.message}`); return { turno: null, reportes: [] as Reporte[] } }
    const tr = (t.data ?? null) as unknown as TurnoRegistro | null
    if (!tr) return { turno: null, reportes: [] as Reporte[] }
    const r = await supabase.from('reportes_produccion').select('id, maquina_id, docenas_producidas, operario_id, created_at').eq('turno_id', tr.id)
    if (r.error) toast.error(`Error cargando lo registrado: ${r.error.message}`)
    return { turno: tr, reportes: (r.data ?? []) as Reporte[] }
  }, [supabase, fecha, horario])

  const aplicarBase = useCallback((b: Awaited<ReturnType<typeof leerBase>>) => {
    setMarcas(b.marcas); setMaquinas(b.maquinas); setProductos(b.productos); setCatalogo(b.catalogo); setPersonas(b.personas); setRol(b.rol)
    setLoading(false)
  }, [])
  const aplicarTurno = useCallback((t: Awaited<ReturnType<typeof leerTurno>>) => {
    setTurno(t.turno)
    setReportes(t.reportes)
    if (t.turno) setEncargadoId(t.turno.tejedor_id)
  }, [])

  useEffect(() => {
    let vigente = true
    ;(async () => { const b = await leerBase(); if (vigente) aplicarBase(b) })()
    return () => { vigente = false }
  }, [leerBase, aplicarBase])
  useEffect(() => {
    let vigente = true
    ;(async () => { const t = await leerTurno(); if (vigente) aplicarTurno(t) })()
    return () => { vigente = false }
  }, [leerTurno, aplicarTurno])

  const recargarBase = async () => aplicarBase(await leerBase())
  const recargarTurno = async () => aplicarTurno(await leerTurno())

  const codigoProducto = useCallback((id: string | undefined) => catalogo.find(c => c.id === id)?.codigo ?? '—', [catalogo])

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return maquinas
      .filter(m => marcaFiltro === 'todas' || m.marca_id === marcaFiltro)
      .map(m => ({ m, vigente: productoVigente(productos, m.id), reporte: reportes.find(r => r.maquina_id === m.id) ?? null }))
      .filter(({ m, vigente }) => !q || m.codigo.toLowerCase().includes(q) || codigoProducto(vigente?.catalogo_media_id).toLowerCase().includes(q)
        || (m.marca?.nombre ?? '').toLowerCase().includes(q))
  }, [maquinas, productos, reportes, marcaFiltro, busqueda, codigoProducto])

  const conProducto = maquinas.filter(m => productoVigente(productos, m.id)).length
  const nombrePersona = (id: string | null) => personas.find(p => p.id === id)?.nombre ?? '—'

  const editar = (maquinaId: string, campo: 'docenas' | 'operario', valor: string) =>
    setPlanilla(prev => ({ ...prev, [maquinaId]: { docenas: '', operario: '', ...prev[maquinaId], [campo]: valor } }))

  const guardarTurno = async () => {
    if (!encargadoId) { toast.error('Elige el encargado del turno'); return }
    const items = filas
      .filter(({ m, vigente, reporte }) => vigente && !reporte && registraProduccion(m.estado) && (planilla[m.id]?.docenas ?? '') !== '')
      .map(({ m }) => ({ m, docenas: planilla[m.id].docenas, operario: planilla[m.id].operario }))
    if (items.length === 0) { toast.error('Anota las docenas de al menos una máquina'); return }
    const mala = items.find(i => !docenasValidas(i.docenas))
    if (mala) { toast.error(`Docenas inválidas en ${mala.m.codigo}`); return }
    const sinOperario = items.find(i => !i.operario)
    if (sinOperario) { toast.error(`Elige el operario de ${sinOperario.m.codigo}`); return }

    setGuardando(true)
    const { error } = await supabase.rpc('registrar_produccion_tejido', {
      p_fecha: fecha, p_horario: horario, p_encargado_id: encargadoId,
      p_items: items.map(i => ({ maquina_id: i.m.id, docenas: Number(i.docenas), operario_id: i.operario })),
    })
    setGuardando(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Turno ${horario === 'dia' ? 'día' : 'noche'} del ${formatearFecha(fecha)}: ${items.length} máquina(s) registradas`)
    setPlanilla({})
    recargarTurno()
  }

  const guardarCambioProducto = async () => {
    if (!cambio?.producto) { toast.error('Elige el producto'); return }
    const { error } = await supabase.rpc('asignar_producto_maquina', { p_maquina_id: cambio.maquina.id, p_catalogo_media_id: cambio.producto })
    if (error) { toast.error(error.message); return }
    toast.success(`Máquina ${cambio.maquina.codigo}: ahora teje ${codigoProducto(cambio.producto)}`)
    setCambio(null)
    recargarBase()
  }

  const guardarCorreccion = async () => {
    if (!correccion) return
    if (!docenasValidas(correccion.docenas)) { toast.error('Docenas inválidas'); return }
    const { error } = await supabase.rpc('corregir_produccion_tejido', {
      p_reporte_id: correccion.reporte.id, p_docenas: Number(correccion.docenas), p_operario_id: correccion.operario,
    })
    if (error) { toast.error(error.message); return }
    toast.success(`Corrección guardada en ${correccion.codigo}`)
    setCorreccion(null)
    recargarTurno()
  }

  const corregibleHoy = (r: Reporte) => hoyLocal(new Date(r.created_at)) === hoyLocal()

  return (
    <div className="space-y-6 animate-fadeInUp">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400"><Cpu className="w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Tejido 24/6</h1>
            <p className="text-slate-400 text-xs font-medium">Cada máquina con su producto fijo; se registra la producción de cada turno</p>
          </div>
        </div>
        <div className="flex gap-3 text-xs font-bold">
          <span className="px-3.5 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">{conProducto} con producto</span>
          <span className="px-3.5 py-2 rounded-2xl bg-slate-500/10 border border-white/10 text-slate-300">{maquinas.length - conProducto} sin producto</span>
        </div>
      </div>

      {/* ── Turno que se registra ─────────────────────────────────────────── */}
      <div className="glass rounded-3xl p-5 border border-blue-500/20 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
        <div>
          <label htmlFor="turno-fecha" className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Fecha</label>
          <input id="turno-fecha" type="date" value={fecha} max={hoyLocal()} onChange={e => { setFecha(e.target.value); setPlanilla({}) }} className="input-dark text-xs w-full" />
        </div>
        <div>
          <span className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Turno</span>
          <div className="flex gap-1 p-1 rounded-2xl bg-slate-900/60 border border-white/[0.06]" role="group" aria-label="Turno">
            {(['dia', 'noche'] as const).map(h => (
              <button key={h} type="button" aria-pressed={horario === h} onClick={() => { setHorario(h); setPlanilla({}) }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl font-bold ${horario === h ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {h === 'dia' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}{h === 'dia' ? 'Día' : 'Noche'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="turno-encargado" className="block font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Encargado del turno</label>
          <select id="turno-encargado" value={encargadoId} disabled={!!turno} onChange={e => setEncargadoId(e.target.value)} className="input-dark text-xs w-full">
            <option value="">Elegir encargado…</option>
            {personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          {turno && <p className="text-[10px] text-slate-500 mt-1">Turno ya iniciado por {turno.tejedor?.nombre ?? nombrePersona(turno.tejedor_id)}</p>}
        </div>
        <div className="flex items-end">
          <button type="button" onClick={guardarTurno} disabled={guardando} className="btn-primary w-full justify-center text-xs py-2.5">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar turno
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative w-full md:w-80">
          <BuscadorConSugerencias placeholder="Buscar máquina, producto o marca..." value={busqueda} onChange={setBusqueda} inputClassName="text-xs rounded-xl"
            sugerencias={[...sugerir(maquinas, busqueda, m => ({ id: m.id, etiqueta: m.codigo, detalle: m.marca?.nombre ?? undefined }), m => [m.codigo, m.marca?.nombre]),
              ...sugerirProductos(catalogo, busqueda)].slice(0, MAX_SUGERENCIAS)} />
        </div>
        <select aria-label="Marca" value={marcaFiltro} onChange={e => setMarcaFiltro(e.target.value)} className="input-dark text-xs md:w-64">
          <option value="todas">Todas las marcas ({marcas.length})</option>
          {marcas.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>

      {/* ── Planilla: una fila por máquina ────────────────────────────────── */}
      <div className="glass rounded-3xl overflow-x-auto border border-white/[0.06]">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-blue-400" /></div>
        ) : filas.length === 0 ? (
          <p className="text-center text-slate-500 py-14 text-sm">No se encontraron máquinas tejedoras</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-slate-400 uppercase text-[10px]">
              <tr><th className="p-3">Máquina</th><th className="p-3">Estado</th><th className="p-3">Producto</th>
                <th className="p-3 w-28">Docenas</th><th className="p-3 w-56">Operario</th><th className="p-3 text-right">Acciones</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-slate-300">
              {filas.map(({ m, vigente, reporte }) => {
                const produce = registraProduccion(m.estado)
                const fila = planilla[m.id] ?? { docenas: '', operario: '' }
                return (
                  <tr key={m.id} data-testid={`fila-tejido-${m.codigo}`}>
                    <td className="p-3"><span className="font-mono font-bold text-white">{m.codigo}</span><span className="block text-[10px] text-slate-500">{m.marca?.nombre ?? ''}</span></td>
                    <td className="p-3"><span className={produce ? 'text-emerald-300' : 'text-amber-300'}>{ESTADO_TEXTO[m.estado] ?? m.estado}</span></td>
                    <td className="p-3 font-mono">{vigente ? codigoProducto(vigente.catalogo_media_id) : <span className="text-slate-500 font-sans">Sin producto</span>}</td>
                    {reporte ? (
                      <>
                        <td className="p-3 font-mono text-white">{reporte.docenas_producidas}</td>
                        <td className="p-3">{nombrePersona(reporte.operario_id)}</td>
                      </>
                    ) : vigente && produce ? (
                      <>
                        <td className="p-3">
                          <input type="number" min="0" step="0.5" inputMode="decimal" aria-label={`Docenas de ${m.codigo}`} value={fila.docenas}
                            onChange={e => editar(m.id, 'docenas', e.target.value)} className="input-dark text-xs w-24 py-1.5" />
                        </td>
                        <td className="p-3">
                          <select aria-label={`Operario de ${m.codigo}`} value={fila.operario} onChange={e => editar(m.id, 'operario', e.target.value)} className="input-dark text-xs w-full py-1.5">
                            <option value="">Elegir operario…</option>
                            {personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                          </select>
                        </td>
                      </>
                    ) : (
                      <td className="p-3 text-slate-500" colSpan={2}>{vigente ? 'No registra producción en este estado' : 'Asigna un producto para registrar'}</td>
                    )}
                    <td className="p-3 text-right whitespace-nowrap">
                      {reporte && supervisa && corregibleHoy(reporte) && (
                        <button type="button" className="btn-secondary text-[11px] py-1 px-2 mr-2"
                          onClick={() => setCorreccion({ reporte, codigo: m.codigo, docenas: String(reporte.docenas_producidas), operario: reporte.operario_id ?? '' })}>
                          <Pencil className="w-3 h-3" /> Corregir
                        </button>
                      )}
                      {supervisa && (
                        <button type="button" className="btn-secondary text-[11px] py-1 px-2" onClick={() => setCambio({ maquina: m, producto: vigente?.catalogo_media_id ?? '' })}>
                          <RefreshCw className="w-3 h-3" /> {vigente ? 'Cambiar producto' : 'Asignar producto'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={!!cambio} onClose={() => setCambio(null)} title={`Producto de la máquina ${cambio?.maquina.codigo ?? ''}`}
        subtitle="Se teje en crudo (el color se da en Tintorería). La máquina sigue con este producto todos los turnos, hasta que se cambie otra vez."
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCambio(null)}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={guardarCambioProducto}>Guardar producto</button></div>}>
        {cambio && (
          <SelectorMedia items={catalogo.filter(c => c.es_crudo)} value={cambio.producto} onChange={v => setCambio({ ...cambio, producto: v })}
            emptyOption={{ value: '', label: 'Elegir producto…' }} toOption={c => ({ value: c.id, label: c.codigo })} placeholder="Elegir producto…" />
        )}
      </Modal>

      <Modal isOpen={!!correccion} onClose={() => setCorreccion(null)} title={`Corregir ${correccion?.codigo ?? ''}`}
        subtitle="Solo el mismo día. El hilo se ajusta por la diferencia."
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCorreccion(null)}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={guardarCorreccion}>Guardar corrección</button></div>}>
        {correccion && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label htmlFor="corr-docenas" className="block text-slate-400 mb-1">Docenas</label>
              <input id="corr-docenas" type="number" min="0" step="0.5" value={correccion.docenas} onChange={e => setCorreccion({ ...correccion, docenas: e.target.value })} className="input-dark w-full" />
            </div>
            <div>
              <label htmlFor="corr-operario" className="block text-slate-400 mb-1">Operario</label>
              <select id="corr-operario" value={correccion.operario} onChange={e => setCorreccion({ ...correccion, operario: e.target.value })} className="input-dark w-full">
                <option value="">Elegir operario…</option>
                {personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
