// @ts-nocheck
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Calendar, CalendarDays, Clock, Users, Lock, X, ArrowRight, AlertCircle, Sparkles } from 'lucide-react'
import { formatearFecha } from '@/lib/utils'

interface Evento {
  id: string
  titulo: string
  descripcion?: string
  fecha: string
  hora?: string
  visibilidad: 'compartido' | 'personal'
  color?: string
  creado_por_nombre?: string
}

interface EventNotificationBannerProps {
  userRol: string
}

export default function EventNotificationBanner({ userRol }: EventNotificationBannerProps) {
  const router = useRouter()
  const supabase = createClient()
  const isAuthorized = userRol === 'admin' || userRol === 'supervisor'

  const [eventosProximos, setEventosProximos] = useState<Evento[]>([])
  const [showModal, setShowModal] = useState(false)
  const [currentDateStr, setCurrentDateStr] = useState('')

  const checkEventos = useCallback(async () => {
    if (!isAuthorized) return

    const hoy = new Date()
    const hoyStr = hoy.toISOString().split('T')[0]
    setCurrentDateStr(hoyStr)

    // Clave de localStorage diaria solicitada por el usuario
    const storageKey = `alerta_calendario_vista_${hoyStr}`
    const yaVistoHoy = localStorage.getItem(storageKey)

    if (yaVistoHoy === 'true') {
      return
    }

    const en3Dias = new Date(hoy.getTime() + 3 * 86400000)
    const en3DiasStr = en3Dias.toISOString().split('T')[0]

    try {
      // 1. Obtener usuario actual para filtrar eventos personales
      const { data: { user } } = await supabase.auth.getUser()
      let currentUserId = user?.id || ''

      if (!currentUserId) {
        const mockSession = document.cookie.split('; ').find(row => row.startsWith('durey_mock_session='))?.split('=')[1]
        if (mockSession) {
          try {
            const parsed = JSON.parse(decodeURIComponent(mockSession))
            currentUserId = parsed.id || ''
          } catch (e) {}
        }
      }

      // 2. Consultar eventos compartidos + personales del usuario
      let query = supabase
        .from('eventos_calendario')
        .select('*')
        .gte('fecha', hoyStr)
        .lte('fecha', en3DiasStr)
        .order('fecha', { ascending: true })
        .order('hora', { ascending: true, nullsFirst: false })

      if (currentUserId) {
        query = query.or(`visibilidad.eq.compartido,creado_por.eq.${currentUserId}`)
      } else {
        query = query.eq('visibilidad', 'compartido')
      }

      const { data, error } = await query

      let listaEventos: Evento[] = []
      if (!error && data && data.length > 0) {
        listaEventos = data
      } else {
        // Fallback a localStorage
        const local = JSON.parse(localStorage.getItem('durey_eventos_calendario') || '[]')
        listaEventos = local.filter((ev: any) => {
          const matchFecha = ev.fecha >= hoyStr && ev.fecha <= en3DiasStr
          const matchVis = ev.visibilidad === 'compartido' || ev.creado_por === currentUserId
          return matchFecha && matchVis
        })
      }

      if (listaEventos.length > 0) {
        setEventosProximos(listaEventos)
        setShowModal(true)
      }
    } catch (e) {
      console.warn('Error al verificar alertas de calendario:', e)
    }
  }, [isAuthorized, supabase])

  useEffect(() => {
    checkEventos()
  }, [checkEventos])

  const handleCerrar = () => {
    if (currentDateStr) {
      localStorage.setItem(`alerta_calendario_vista_${currentDateStr}`, 'true')
    }
    setShowModal(false)
  }

  const handleIrAlCalendario = () => {
    handleCerrar()
    router.push('/dashboard/calendario')
  }

  if (!isAuthorized || !showModal || eventosProximos.length === 0) {
    return null
  }

  const eventosHoy = eventosProximos.filter(e => e.fecha === currentDateStr)
  const eventosFuturos = eventosProximos.filter(e => e.fecha > currentDateStr)

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
      <div className="glass rounded-3xl w-full max-w-lg p-6 shadow-2xl border border-sky-500/30 animate-fadeInUp bg-slate-950/95 relative overflow-hidden">
        {/* Glow de fondo */}
        <div className="absolute -right-16 -top-16 w-44 h-44 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex justify-between items-start pb-3 border-b border-white/[0.08] mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2">
                🗓️ Eventos y Fechas Importantes
              </h2>
              <p className="text-xs text-slate-400">
                {eventosProximos.length === 1 
                  ? 'Tienes 1 evento programado para los próximos días'
                  : `Tienes ${eventosProximos.length} eventos programados para los próximos días`}
              </p>
            </div>
          </div>
          <button
            onClick={handleCerrar}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lista de eventos */}
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {eventosHoy.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                🚨 Programados para Hoy:
              </div>
              {eventosHoy.map(ev => (
                <div
                  key={ev.id}
                  className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{ev.titulo}</span>
                      {ev.visibilidad === 'compartido' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                          <Users className="w-3 h-3" /> Compartido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <Lock className="w-3 h-3" /> Personal
                        </span>
                      )}
                    </div>
                    {ev.descripcion && (
                      <p className="text-xs text-slate-300 line-clamp-2">{ev.descripcion}</p>
                    )}
                    {ev.creado_por_nombre && ev.visibilidad === 'compartido' && (
                      <p className="text-[10px] text-slate-400">Por: {ev.creado_por_nombre}</p>
                    )}
                  </div>
                  {ev.hora && (
                    <div className="text-right flex-shrink-0">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900/80 text-rose-300 font-mono font-bold text-xs border border-rose-500/20">
                        <Clock className="w-3 h-3" /> {ev.hora.substring(0, 5)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {eventosFuturos.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>🗓️ Próximos en 1 a 3 días:</span>
              </div>
              {eventosFuturos.map(ev => (
                <div
                  key={ev.id}
                  className="p-3.5 rounded-2xl bg-slate-900/70 border border-white/[0.08] flex items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{ev.titulo}</span>
                      {ev.visibilidad === 'compartido' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                          <Users className="w-2.5 h-2.5" /> Compartido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <Lock className="w-2.5 h-2.5" /> Personal
                        </span>
                      )}
                    </div>
                    {ev.descripcion && (
                      <p className="text-[11px] text-slate-400 line-clamp-2">{ev.descripcion}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="font-mono text-xs font-semibold text-amber-300 block">
                      {formatearFecha(ev.fecha)}
                    </span>
                    {ev.hora && (
                      <span className="text-[10px] text-slate-400 font-mono block">
                        {ev.hora.substring(0, 5)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Botones de acción */}
        <div className="flex gap-3 mt-6 pt-3 border-t border-white/[0.08]">
          <button
            onClick={handleCerrar}
            className="btn-secondary flex-1 justify-center py-2.5 text-xs rounded-2xl font-semibold text-slate-300"
          >
            Entendido (No volver a mostrar hoy)
          </button>
          <button
            onClick={handleIrAlCalendario}
            className="btn-primary flex-1 justify-center py-2.5 text-xs rounded-2xl bg-sky-600 hover:bg-sky-500 border-none font-bold text-white shadow-lg shadow-sky-600/20 flex items-center gap-2"
          >
            Ver Calendario <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
