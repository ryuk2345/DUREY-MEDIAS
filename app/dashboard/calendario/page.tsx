// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import CustomSelect from '@/components/ui/CustomSelect'
import { formatearFecha } from '@/lib/utils'
import {
  Calendar as CalendarIcon, CalendarDays, Clock, Users, Lock, Plus,
  ChevronLeft, ChevronRight, Search, Filter, Trash2, Edit3, X, Check,
  AlertCircle, Sparkles, RefreshCw, ShieldAlert, Eye, User, Globe
} from 'lucide-react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  parseISO
} from 'date-fns'
import { es } from 'date-fns/locale'

interface Evento {
  id: string
  titulo: string
  descripcion?: string
  fecha: string // YYYY-MM-DD
  hora?: string // HH:mm
  visibilidad: 'compartido' | 'personal'
  color?: string
  creado_por?: string
  creado_por_nombre?: string
  created_at?: string
}

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  sky:     { bg: 'bg-sky-500/20',     text: 'text-sky-300',     border: 'border-sky-500/30',     dot: 'bg-sky-400' },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  amber:   { bg: 'bg-amber-500/20',   text: 'text-amber-300',   border: 'border-amber-500/30',   dot: 'bg-amber-400' },
  rose:    { bg: 'bg-rose-500/20',    text: 'text-rose-300',    border: 'border-rose-500/30',    dot: 'bg-rose-400' },
  purple:  { bg: 'bg-purple-500/20',  text: 'text-purple-300',  border: 'border-purple-500/30',  dot: 'bg-purple-400' },
  indigo:  { bg: 'bg-indigo-500/20',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  dot: 'bg-indigo-400' }
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export default function CalendarioPage() {
  const router = useRouter()
  const supabase = createClient()

  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [userRole, setUserRole] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [currentUserName, setCurrentUserName] = useState<string>('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [eventos, setEventos] = useState<Evento[]>([])

  // Filtros
  const [filtroVisibilidad, setFiltroVisibilidad] = useState<string>('todos')
  const [busqueda, setBusqueda] = useState<string>('')

  // Modales
  const [showEventModal, setShowEventModal] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Evento | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)

  // Formulario
  const [form, setForm] = useState({
    titulo: '',
    descripcion: '',
    fecha: new Date().toISOString().split('T')[0],
    hora: '',
    visibilidad: 'compartido' as 'compartido' | 'personal',
    color: 'sky'
  })

  // 1. Validar roles admin o supervisor
  useEffect(() => {
    async function checkRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        let rol = 'admin'
        let uid = user?.id || ''
        let nombre = 'Usuario'

        if (user) {
          const { data: perfil } = await supabase
            .from('usuarios')
            .select('id, nombre, rol')
            .eq('auth_id', user.id)
            .single()

          if (perfil) {
            rol = perfil.rol || 'admin'
            uid = perfil.id || user.id
            nombre = perfil.nombre || 'Usuario'
          }
        } else {
          // Mock cookie session
          const mockSession = document.cookie.split('; ').find(row => row.startsWith('durey_mock_session='))?.split('=')[1]
          if (mockSession) {
            try {
              const parsed = JSON.parse(decodeURIComponent(mockSession))
              rol = parsed.rol || 'admin'
              uid = parsed.id || '1'
              nombre = parsed.nombre || 'Administrador'
            } catch (e) {}
          } else {
            const cookieRole = document.cookie.split('; ').find(row => row.startsWith('durey_user_role='))?.split('=')[1]
            rol = cookieRole || 'admin'
            uid = '1'
            nombre = 'Administrador'
          }
        }

        if (rol !== 'admin' && rol !== 'supervisor') {
          toast.error('Acceso denegado: El Calendario es exclusivo para Admin y Supervisor.')
          router.push('/dashboard')
          return
        }

        setUserRole(rol)
        setCurrentUserId(uid)
        setCurrentUserName(nombre)
      } catch (e) {
        setUserRole('admin')
      }
    }
    checkRole()
  }, [router, supabase])

  // 2. Cargar eventos desde Supabase / LocalStorage
  const cargarEventos = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('eventos_calendario')
        .select('*')
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true, nullsFirst: false })

      if (currentUserId) {
        query = query.or(`visibilidad.eq.compartido,creado_por.eq.${currentUserId}`)
      } else {
        query = query.eq('visibilidad', 'compartido')
      }

      const { data, error } = await query

      if (!error && data && data.length > 0) {
        setEventos(data)
        localStorage.setItem('durey_eventos_calendario', JSON.stringify(data))
      } else {
        const local = JSON.parse(localStorage.getItem('durey_eventos_calendario') || '[]')
        setEventos(local)
      }
    } catch (err: any) {
      console.warn('Fallback a local para calendario:', err)
      const local = JSON.parse(localStorage.getItem('durey_eventos_calendario') || '[]')
      setEventos(local)
    } finally {
      setLoading(false)
    }
  }, [currentUserId, supabase])

  useEffect(() => {
    cargarEventos()
  }, [cargarEventos])

  // 3. Crear / Editar Evento
  const handleGuardarEvento = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.titulo.trim() || !form.fecha) {
      toast.error('El título y la fecha son obligatorios')
      return
    }

    setSaving(true)
    const nuevoEvento: Evento = {
      id: editingEventId || Math.random().toString(),
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || undefined,
      fecha: form.fecha,
      hora: form.hora.trim() || undefined,
      visibilidad: form.visibilidad,
      color: form.color || 'sky',
      creado_por: currentUserId || '1',
      creado_por_nombre: currentUserName || 'Supervisor',
      created_at: new Date().toISOString()
    }

    try {
      if (editingEventId) {
        const { error } = await supabase
          .from('eventos_calendario')
          .update({
            titulo: nuevoEvento.titulo,
            descripcion: nuevoEvento.descripcion,
            fecha: nuevoEvento.fecha,
            hora: nuevoEvento.hora,
            visibilidad: nuevoEvento.visibilidad,
            color: nuevoEvento.color
          })
          .eq('id', editingEventId)

        if (error) console.warn('Supabase update fallback:', error.message)

        const updatedList = eventos.map(ev => ev.id === editingEventId ? nuevoEvento : ev)
        setEventos(updatedList)
        localStorage.setItem('durey_eventos_calendario', JSON.stringify(updatedList))
        toast.success('🗓️ Evento actualizado correctamente')
      } else {
        const { error } = await supabase
          .from('eventos_calendario')
          .insert({
            titulo: nuevoEvento.titulo,
            descripcion: nuevoEvento.descripcion,
            fecha: nuevoEvento.fecha,
            hora: nuevoEvento.hora,
            visibilidad: nuevoEvento.visibilidad,
            color: nuevoEvento.color,
            creado_por: nuevoEvento.creado_por,
            creado_por_nombre: nuevoEvento.creado_por_nombre
          })

        if (error) console.warn('Supabase insert fallback:', error.message)

        const updatedList = [...eventos, nuevoEvento]
        setEventos(updatedList)
        localStorage.setItem('durey_eventos_calendario', JSON.stringify(updatedList))
        toast.success('🗓️ Evento programado exitosamente')
      }

      setShowEventModal(false)
      setSelectedEvent(null)
      setEditingEventId(null)
      setForm({
        titulo: '',
        descripcion: '',
        fecha: new Date().toISOString().split('T')[0],
        hora: '',
        visibilidad: 'compartido',
        color: 'sky'
      })
    } catch (err: any) {
      toast.error('Error al guardar evento: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // 4. Eliminar Evento
  const handleEliminarEvento = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este evento?')) return

    try {
      await supabase.from('eventos_calendario').delete().eq('id', id)
      const filtered = eventos.filter(e => e.id !== id)
      setEventos(filtered)
      localStorage.setItem('durey_eventos_calendario', JSON.stringify(filtered))
      toast.success('Evento eliminado')
      setSelectedEvent(null)
    } catch (err: any) {
      toast.error('Error al eliminar evento: ' + err.message)
    }
  }

  // 5. Abrir modal para nuevo evento en un día específico
  const handleDayClick = (dayDate: Date) => {
    const dateStr = format(dayDate, 'yyyy-MM-dd')
    setEditingEventId(null)
    setForm({
      titulo: '',
      descripcion: '',
      fecha: dateStr,
      hora: '',
      visibilidad: 'compartido',
      color: 'sky'
    })
    setShowEventModal(true)
  }

  const handleEditClick = (evento: Evento) => {
    setEditingEventId(evento.id)
    setForm({
      titulo: evento.titulo,
      descripcion: evento.descripcion || '',
      fecha: evento.fecha,
      hora: evento.hora ? evento.hora.substring(0, 5) : '',
      visibilidad: evento.visibilidad,
      color: evento.color || 'sky'
    })
    setSelectedEvent(null)
    setShowEventModal(true)
  }

  // Cuadrícula mensual (Google Calendar Style)
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(monthStart)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  // Filtrado de eventos
  const eventosFiltrados = useMemo(() => {
    return eventos.filter(ev => {
      const matchVis = filtroVisibilidad === 'todos' || ev.visibilidad === filtroVisibilidad
      const matchTxt = !busqueda.trim() || 
        ev.titulo.toLowerCase().includes(busqueda.toLowerCase()) ||
        (ev.descripcion && ev.descripcion.toLowerCase().includes(busqueda.toLowerCase()))
      return matchVis && matchTxt
    })
  }, [eventos, filtroVisibilidad, busqueda])

  // Próximos 7 días para el panel lateral
  const hoyStr = new Date().toISOString().split('T')[0]
  const eventosProximos = useMemo(() => {
    const en7Dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
    return eventosFiltrados
      .filter(ev => ev.fecha >= hoyStr && ev.fecha <= en7Dias)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora || '').localeCompare(b.hora || ''))
  }, [eventosFiltrados, hoyStr])

  if (userRole && userRole !== 'admin' && userRole !== 'supervisor') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <ShieldAlert className="w-16 h-16 text-rose-500 mb-4 animate-bounce" />
        <h2 className="text-xl font-bold text-white mb-2">Acceso Restringido</h2>
        <p className="text-sm text-slate-400 max-w-md">
          El módulo de Calendario de Eventos es de uso exclusivo para <strong>Administradores y Supervisores</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              Calendario de Eventos y Agenda
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                Admin & Supervisor
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Planificación mensual, reuniones de turno, despachos importantes y recordatorios personales
            </p>
          </div>
        </div>

        {/* Acciones principales */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* Navegación de Mes */}
          <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-2xl border border-white/[0.08]">
            <button
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="p-1.5 rounded-xl hover:bg-white/10 text-slate-300 transition-colors"
              title="Mes anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 py-1 rounded-xl text-xs font-bold text-sky-400 hover:bg-sky-500/10 transition-colors"
            >
              Hoy
            </button>
            <button
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="p-1.5 rounded-xl hover:bg-white/10 text-slate-300 transition-colors"
              title="Mes siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <span className="text-base font-black text-white capitalize min-w-[150px] text-center">
            {format(currentDate, 'MMMM yyyy', { locale: es })}
          </span>

          <button
            onClick={cargarEventos}
            disabled={loading}
            className="btn-secondary text-xs py-2 px-3 rounded-2xl"
            title="Recargar eventos"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setEditingEventId(null)
              setForm({
                titulo: '',
                descripcion: '',
                fecha: new Date().toISOString().split('T')[0],
                hora: '',
                visibilidad: 'compartido',
                color: 'sky'
              })
              setShowEventModal(true)
            }}
            className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 border-none font-bold text-white shadow-lg shadow-sky-600/20 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nuevo Evento
          </button>
        </div>
      </div>

      {/* ── BARRA DE BÚSQUEDA Y FILTROS ────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-3 border border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar eventos por título..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="input-dark pl-9 py-1.5 text-xs w-full"
          />
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-semibold">Mostrar:</span>
            <CustomSelect
              value={filtroVisibilidad}
              onChange={val => setFiltroVisibilidad(val)}
              options={[
                { value: 'todos', label: 'Todos los Eventos' },
                { value: 'compartido', label: '🌐 Solo Compartidos' },
                { value: 'personal', label: '🔒 Solo Personales' }
              ]}
              triggerClassName="text-xs py-1.5 px-3 min-w-[180px]"
            />
          </div>

          <div className="hidden md:flex items-center gap-3 text-[11px] font-semibold text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> 🌐 Compartido</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> 🔒 Personal</span>
          </div>
        </div>
      </div>

      {/* ── CUADRÍCULA PRINCIPAL: CALENDARIO MENSUAL + PANEL LATERAL ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendario Google Calendar Style (3 columnas) */}
        <div className="lg:col-span-3 glass rounded-3xl p-5 border border-white/[0.08] shadow-2xl space-y-4">
          {/* Cabecera de días de la semana */}
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-slate-400 pb-2 border-b border-white/[0.06]">
            {DIAS_SEMANA.map((dia, idx) => (
              <div key={dia} className={`py-1 ${idx === 0 || idx === 6 ? 'text-rose-400/80' : ''}`}>
                {dia}
              </div>
            ))}
          </div>

          {/* Grilla de Días del Mes */}
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((day) => {
              const dayStr = format(day, 'yyyy-MM-dd')
              const dayEvents = eventosFiltrados.filter(ev => ev.fecha === dayStr)
              const isCurrentMonth = isSameMonth(day, monthStart)
              const isCurrentDay = isToday(day)

              return (
                <div
                  key={dayStr}
                  onClick={() => handleDayClick(day)}
                  className={`min-h-[105px] sm:min-h-[120px] p-2 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between group ${
                    isCurrentDay
                      ? 'border-sky-500/60 bg-sky-500/[0.08] shadow-lg shadow-sky-500/10'
                      : isCurrentMonth
                      ? 'border-white/[0.05] bg-slate-900/40 hover:bg-slate-900/80 hover:border-white/20'
                      : 'border-transparent bg-transparent opacity-30 hover:opacity-60'
                  }`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span
                      className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                        isCurrentDay
                          ? 'bg-sky-500 text-slate-950 font-black'
                          : 'text-slate-300 group-hover:text-white'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] text-slate-400 font-mono font-bold">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  {/* Lista de Eventos en el día */}
                  <div className="space-y-1 overflow-hidden flex-1">
                    {dayEvents.slice(0, 3).map((ev) => {
                      const colorTheme = COLOR_MAP[ev.color || 'sky'] || COLOR_MAP.sky
                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedEvent(ev)
                          }}
                          className={`px-1.5 py-0.5 rounded-lg text-[10px] font-semibold truncate border flex items-center gap-1 transition-transform hover:scale-[1.02] ${colorTheme.bg} ${colorTheme.text} ${colorTheme.border}`}
                          title={`${ev.hora ? `[${ev.hora.substring(0, 5)}] ` : ''}${ev.titulo} (${ev.visibilidad})`}
                        >
                          {ev.visibilidad === 'compartido' ? (
                            <Users className="w-2.5 h-2.5 flex-shrink-0 opacity-80" />
                          ) : (
                            <Lock className="w-2.5 h-2.5 flex-shrink-0 opacity-80" />
                          )}
                          <span className="truncate">
                            {ev.hora ? `${ev.hora.substring(0, 5)} ` : ''}{ev.titulo}
                          </span>
                        </div>
                      )
                    })}
                    {dayEvents.length > 3 && (
                      <div className="text-[9px] text-slate-400 font-bold text-center">
                        +{dayEvents.length - 3} más
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Panel Lateral: Próximos 7 días + Resumen */}
        <div className="space-y-6">
          <div className="glass rounded-3xl p-5 border border-white/[0.08] shadow-xl space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Próximos 7 Días
            </h2>

            {eventosProximos.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs border border-dashed border-white/10 rounded-2xl">
                No hay eventos programados para los próximos 7 días
              </div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {eventosProximos.map((ev) => {
                  const esDeHoy = ev.fecha === hoyStr
                  const colorTheme = COLOR_MAP[ev.color || 'sky'] || COLOR_MAP.sky
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setSelectedEvent(ev)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer hover:scale-[1.02] ${
                        esDeHoy
                          ? 'border-rose-500/40 bg-rose-500/10'
                          : 'border-white/[0.08] bg-slate-900/60 hover:bg-slate-900/90'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <span className="text-xs font-bold text-white line-clamp-1">{ev.titulo}</span>
                        {ev.visibilidad === 'compartido' ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                            <Users className="w-2.5 h-2.5" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <Lock className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mt-2">
                        <span className={`font-semibold ${esDeHoy ? 'text-rose-400 font-bold' : 'text-slate-300'}`}>
                          {esDeHoy ? '🚨 HOY' : formatearFecha(ev.fecha)}
                        </span>
                        {ev.hora && (
                          <span className="flex items-center gap-1 text-slate-400">
                            <Clock className="w-3 h-3" /> {ev.hora.substring(0, 5)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── MODAL: DETALLE DE EVENTO ───────────────────────────────────────────── */}
      {selectedEvent && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-6 shadow-2xl border border-white/10 animate-fadeInUp bg-slate-950/95 space-y-4">
            <div className="flex justify-between items-start pb-3 border-b border-white/[0.08]">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">{selectedEvent.titulo}</h2>
                  {selectedEvent.visibilidad === 'compartido' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      <Users className="w-3 h-3" /> Compartido
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      <Lock className="w-3 h-3" /> Personal
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-2xl bg-slate-900/80 border border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5 text-sky-400" /> Fecha:
                  </span>
                  <span className="font-bold text-white font-mono">{formatearFecha(selectedEvent.fecha)}</span>
                </div>
                {selectedEvent.hora && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" /> Hora:
                    </span>
                    <span className="font-bold text-white font-mono">{selectedEvent.hora.substring(0, 5)}</span>
                  </div>
                )}
                {selectedEvent.creado_por_nombre && selectedEvent.visibilidad === 'compartido' && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-emerald-400" /> Registrado por:
                    </span>
                    <span className="font-semibold text-slate-300">{selectedEvent.creado_por_nombre}</span>
                  </div>
                )}
              </div>

              {selectedEvent.descripcion ? (
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Descripción / Notas:</label>
                  <p className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] text-slate-200 text-xs whitespace-pre-wrap">
                    {selectedEvent.descripcion}
                  </p>
                </div>
              ) : (
                <p className="text-slate-500 italic text-center py-2">Sin descripción adicional</p>
              )}
            </div>

            {/* Acciones de edición/eliminación */}
            <div className="flex gap-2 pt-3 border-t border-white/[0.08]">
              {(selectedEvent.creado_por === currentUserId || userRole === 'admin') && (
                <>
                  <button
                    onClick={() => handleEditClick(selectedEvent)}
                    className="btn-secondary flex-1 justify-center py-2.5 text-xs rounded-xl flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button
                    onClick={() => handleEliminarEvento(selectedEvent.id)}
                    className="btn-danger flex-1 justify-center py-2.5 text-xs rounded-xl flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Eliminar
                  </button>
                </>
              )}
              <button
                onClick={() => setSelectedEvent(null)}
                className="btn-secondary flex-1 justify-center py-2.5 text-xs rounded-xl"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CREAR / EDITAR EVENTO ───────────────────────────────────────── */}
      {showEventModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-6 shadow-2xl border border-white/10 animate-fadeInUp bg-slate-950/95 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-white/[0.08]">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                🗓️ {editingEventId ? 'Editar Evento' : 'Programar Nuevo Evento'}
              </h2>
              <button
                type="button"
                onClick={() => setShowEventModal(false)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarEvento} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">📝 Título del Evento *</label>
                <input
                  type="text"
                  value={form.titulo}
                  onChange={e => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ej: Reunión de coordinación, Visita técnica, etc."
                  className="input-dark w-full text-sm py-2.5 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">📅 Fecha *</label>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={e => setForm({ ...form, fecha: e.target.value })}
                    className="input-dark w-full text-xs py-2.5"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">⏰ Hora (Opcional)</label>
                  <input
                    type="time"
                    value={form.hora}
                    onChange={e => setForm({ ...form, hora: e.target.value })}
                    className="input-dark w-full text-xs py-2.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">👁️ Visibilidad *</label>
                  <CustomSelect
                    value={form.visibilidad}
                    onChange={val => setForm({ ...form, visibilidad: val as 'compartido' | 'personal' })}
                    options={[
                      { value: 'compartido', label: '🌐 Compartido (Todos)' },
                      { value: 'personal', label: '🔒 Personal (Solo yo)' }
                    ]}
                    triggerClassName="text-xs py-2.5 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">🎨 Color Distintivo</label>
                  <CustomSelect
                    value={form.color}
                    onChange={val => setForm({ ...form, color: val })}
                    options={[
                      { value: 'sky', label: '🔵 Azul / Sky' },
                      { value: 'emerald', label: '🟢 Verde Esmeralda' },
                      { value: 'amber', label: '🟡 Ámbar / Dorado' },
                      { value: 'rose', label: '🔴 Rosa / Alerta' },
                      { value: 'purple', label: '🟣 Morado / Púrpura' },
                      { value: 'indigo', label: '🔷 Índigo / Violeta' }
                    ]}
                    triggerClassName="text-xs py-2.5 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">📋 Descripción / Notas adicionales</label>
                <textarea
                  rows={3}
                  value={form.descripcion}
                  onChange={e => setForm({ ...form, descripcion: e.target.value })}
                  placeholder="Detalles relevantes, objetivos o recordatorios para este evento..."
                  className="input-dark w-full text-xs resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex-1 justify-center py-2.5 bg-sky-600 hover:bg-sky-500 border-none font-bold text-white shadow-lg shadow-sky-600/20"
                >
                  {saving ? 'Guardando...' : editingEventId ? 'Actualizar' : 'Guardar Evento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
