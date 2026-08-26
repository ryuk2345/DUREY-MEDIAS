// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ROLES_LABELS } from '@/lib/utils'
import {
  Users, UserPlus, Search, Filter, ShieldCheck, UserCheck,
  CheckCircle2, X, Edit2, UserX, Loader2, Sparkles, Mail, Lock, Shield,
  Calendar, RotateCcw, Award, Clock
} from 'lucide-react'
import { toast } from 'sonner'

interface Usuario {
  id: string
  nombre: string
  email: string
  rol: string
  activo: boolean
  estado?: string
  created_at?: string
}

interface Asignacion {
  id?: string
  operador_id: string
  area: 'tejido' | 'enlace' | 'volteado' | 'planchado' | 'preparado' | 'almacen'
  fecha: string
  turno: 'dia' | 'noche'
}

const ROLES_LISTA = [
  { id: 'admin', label: 'Administrador General', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  { id: 'supervisor', label: 'Supervisor de Producción', color: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  { id: 'operador', label: 'Operador Multifuncional', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  { id: 'vendedora', label: 'Asesora de Ventas', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  { id: 'tecnico', label: 'Técnico de Mantenimiento', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
]

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRolFilter, setSelectedRolFilter] = useState('todos')
  const [activeTab, setActiveTab] = useState<'usuarios' | 'turnos' | 'permisos'>('usuarios')

  // Estados de Asignación de Turnos
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [fechaTurno, setFechaTurno] = useState(new Date().toISOString().split('T')[0])
  const [loadingTurnos, setLoadingTurnos] = useState(false)

  // Modales
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<Usuario | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)

  // Formulario
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    rol: 'operador',
    password: '',
    activo: true
  })

  const supabase = createClient()
  const isMock = typeof window !== 'undefined' && (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('tu-proyecto') ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
  )

  // ── CARGAR USUARIOS ───────────────────────────────────────────────────────
  const cargarUsuarios = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, activo, estado, created_at')
      .order('nombre')

    if (!error && data) {
      setUsuarios(data as Usuario[])
    }
    setLoading(false)
  }, [supabase])

  // ── CARGAR ASIGNACIONES DE TURNO ──────────────────────────────────────────
  const cargarAsignaciones = useCallback(async () => {
    setLoadingTurnos(true)
    const { data, error } = await supabase
      .from('asignaciones_turno')
      .select('id, operador_id, area, fecha, turno')
      .eq('fecha', fechaTurno)

    if (!error && data) {
      setAsignaciones(data as Asignacion[])
    }
    setLoadingTurnos(false)
  }, [fechaTurno, supabase])

  useEffect(() => {
    cargarUsuarios()
  }, [cargarUsuarios])

  useEffect(() => {
    if (activeTab === 'turnos') {
      cargarAsignaciones()
    }
  }, [activeTab, cargarAsignaciones])

  // ── FILTRADO DE USUARIOS ───────────────────────────────────────────────────
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter(u => {
      if (selectedRolFilter !== 'todos' && u.rol !== selectedRolFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchNombre = u.nombre.toLowerCase().includes(q)
        const matchEmail = u.email.toLowerCase().includes(q)
        const matchRol = (ROLES_LABELS[u.rol] || u.rol).toLowerCase().includes(q)
        if (!matchNombre && !matchEmail && !matchRol) return false
      }
      return true
    })
  }, [usuarios, selectedRolFilter, searchQuery])

  // Operadores activos para asignación de turnos
  const operadoresDisponibles = useMemo(() => {
    return usuarios.filter(u => u.rol === 'operador' && u.activo)
  }, [usuarios])

  // ── ACCIÓN: CREAR / EDITAR USUARIO ────────────────────────────────────────
  const abrirCrearModal = () => {
    setEditUser(null)
    setErrorEnvio(null)
    setForm({ nombre: '', email: '', rol: 'operador', password: '', activo: true })
    setShowModal(true)
  }

  const abrirEditarModal = (u: Usuario) => {
    setEditUser(u)
    setErrorEnvio(null)
    setForm({ nombre: u.nombre, email: u.email, rol: u.rol, password: '', activo: u.activo })
    setShowModal(true)
  }

  const guardarUsuario = async () => {
    if (!form.nombre.trim() || !form.email.trim()) {
      toast.error('Nombre y Correo son obligatorios')
      return
    }

    setErrorEnvio(null)

    if (editUser) {
      // EDITAR
      const { error } = await supabase.from('usuarios')
        .update({
          nombre: form.nombre.trim(),
          email: form.email.trim(),
          rol: form.rol,
          activo: form.activo
        })
        .eq('id', editUser.id)

      if (error) {
        setErrorEnvio(error.message)
        toast.error('Error al actualizar el usuario')
        return
      }
      toast.success('🎉 Cambios guardados exitosamente')
    } else {
      // CREAR
      if (isMock) {
        // En modo local simulation
        const { error } = await supabase.from('usuarios').insert({
          nombre: form.nombre.trim(),
          email: form.email.trim(),
          rol: form.rol,
          activo: form.activo
        })

        if (error) {
          setErrorEnvio(error.message)
          toast.error('Error al crear el usuario (Modo Mock)')
          return
        }
        toast.success('🎉 Usuario creado exitosamente en modo mock')
      } else {
        // En producción
        if (!form.password.trim()) {
          toast.error('Ingresa una contraseña temporal para registrar al usuario')
          return
        }

        try {
          const res = await fetch('/api/usuarios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre: form.nombre.trim(),
              email: form.email.trim(),
              rol: form.rol,
              password: form.password,
              activo: form.activo
            })
          })

          const data = await res.json()
          if (!res.ok || data.error) {
            setErrorEnvio(data.error || 'Error al registrar el usuario en el servidor')
            toast.error(data.error || 'Error al registrar el usuario')
            return
          }

          if (data.warning) {
            toast.info(data.warning)
          } else {
            toast.success('🎉 Usuario registrado correctamente en el sistema.')
          }
        } catch (e: any) {
          setErrorEnvio(e.message || 'Error de conexión con el servidor')
          toast.error('Error de conexión con el servidor de autenticación')
          return
        }
      }
    }

    setShowModal(false)
    cargarUsuarios()
  }

  // Activar/Desactivar
  const toggleActivo = async (u: Usuario) => {
    const nuevoEstado = !u.activo
    const { error } = await supabase.from('usuarios')
      .update({ activo: nuevoEstado })
      .eq('id', u.id)

    if (error) {
      toast.error('Error al cambiar estado del usuario')
      return
    }
    toast.success(`Usuario ${nuevoEstado ? 'activado' : 'desactivado'}`)
    cargarUsuarios()
  }

  // ── GUARDAR ASIGNACIÓN DE TURNO ──────────────────────────────────────────
  const handleGuardarAsignacion = async (operadorId: string, area: string, turno: string) => {
    if (!area) {
      // Eliminar asignación si selecciona vacío (Sin Asignar)
      const asigExistente = asignaciones.find(a => a.operador_id === operadorId)
      if (asigExistente?.id) {
        const { error } = await supabase
          .from('asignaciones_turno')
          .delete()
          .eq('id', asigExistente.id)

        if (error) {
          toast.error(`Error al eliminar asignación: ${error.message}`)
          return
        }
        toast.success('Asignación de turno removida')
      } else {
        toast.info('No había asignación previa')
      }
      cargarAsignaciones()
      return
    }

    const payload = {
      operador_id: operadorId,
      area: area as any,
      fecha: fechaTurno,
      turno: turno as any
    }

    const { error } = await supabase
      .from('asignaciones_turno')
      .upsert(payload, { onConflict: 'operador_id, fecha, turno' })

    if (error) {
      toast.error(`Error al guardar asignación de turno: ${error.message}`)
      return
    }

    toast.success('🎉 Asignación de turno guardada exitosamente')
    cargarAsignaciones()
  }

  const getRolStyle = (rol: string) => {
    const item = ROLES_LISTA.find(r => r.id === rol)
    return item ? item.color : 'bg-slate-500/20 text-slate-300 border-slate-500/30'
  }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12 text-xs">
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase">Gestión de Personal y Accesos</h1>
            <p className="text-slate-400 text-xs font-medium">Administración de usuarios, asignación dinámica de turnos y matriz de permisos por rol</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900/80 p-1 rounded-2xl border border-white/[0.08]">
            <button
              onClick={() => setActiveTab('usuarios')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'usuarios' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              Usuarios Registrados
            </button>
            <button
              onClick={() => setActiveTab('turnos')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'turnos' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              Calendario de Turnos
            </button>
            <button
              onClick={() => setActiveTab('permisos')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'permisos' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              Matriz de Permisos
            </button>
          </div>

          <button onClick={abrirCrearModal} className="btn-primary py-2.5 px-4 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-600/20 border-none flex items-center gap-1.5">
            <UserPlus className="w-4 h-4" /> Nuevo Usuario
          </button>
        </div>
      </div>

      {/* ── CONTENIDO TABS ───────────────────────────────────────────────────── */}
      {activeTab === 'usuarios' && (
        <>
          {/* ── BÚSQUEDA Y FILTROS POR ROL ──────────────────────────────────────── */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por nombre, email o rol..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="input-dark pl-10 text-xs rounded-xl w-full"
              />
            </div>

            <div className="flex items-center gap-2 bg-slate-900/60 p-1 rounded-2xl border border-white/[0.06] text-xs w-full md:w-auto">
              <Filter className="w-3.5 h-3.5 text-slate-400 ml-3" />
              <span className="text-slate-400 font-semibold pr-1">Rol:</span>
              <select
                value={selectedRolFilter}
                onChange={e => setSelectedRolFilter(e.target.value)}
                className="bg-transparent text-white font-medium focus:outline-none pr-3 cursor-pointer py-1.5"
              >
                <option value="todos" className="bg-slate-900 text-white">Todos los roles ({usuarios.length})</option>
                {ROLES_LISTA.map(r => (
                  <option key={r.id} value={r.id} className="bg-slate-900 text-white">{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── TABLA DE USUARIOS ────────────────────────────────────────────────── */}
          <div className="glass rounded-3xl overflow-hidden border border-white/[0.08]">
            {loading ? (
              <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>
            ) : usuariosFiltrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <Users className="w-12 h-12 mb-3 opacity-20" />
                <p className="font-semibold text-sm">No se encontraron usuarios</p>
                <p className="text-xs text-slate-600 mt-1">Prueba seleccionando otro rol o creando uno nuevo</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-dark w-full text-left">
                  <thead>
                    <tr>
                      <th className="p-4">Trabajador / Nombre</th>
                      <th className="p-4">Email</th>
                      <th className="p-4">Rol Asignado</th>
                      <th className="p-4">Estado Operativo</th>
                      <th className="p-4">Activo</th>
                      <th className="p-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosFiltrados.map(u => (
                      <tr key={u.id} className="hover:bg-white/[0.02] transition-colors border-b border-white/[0.06] last:border-0">
                        <td className="font-bold text-white flex items-center gap-3 p-4">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-indigo-500/20">
                            {u.nombre.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm">{u.nombre}</p>
                          </div>
                        </td>
                        <td className="text-slate-400 text-xs font-mono p-4">{u.email}</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full border ${getRolStyle(u.rol)}`}>
                            {ROLES_LABELS[u.rol] || u.rol}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`badge ${
                            u.estado === 'ocupada'
                              ? 'badge-warning'
                              : 'badge-success'
                          }`}>
                            {u.estado === 'ocupada' ? '🔴 En Turno' : '🟢 Disponible'}
                          </span>
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => toggleActivo(u)}
                            className={`badge cursor-pointer hover:opacity-80 transition-opacity ${u.activo ? 'badge-info' : 'badge-neutral'}`}
                          >
                            {u.activo ? '✓ Activo' : '✕ Inactivo'}
                          </button>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => abrirEditarModal(u)}
                              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                              title="Editar usuario"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => toggleActivo(u)}
                              className={`p-2 rounded-xl transition-colors ${u.activo ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'}`}
                              title={u.activo ? 'Desactivar usuario' : 'Activar usuario'}
                            >
                              {u.activo ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: CALENDARIO DE TURNOS (ASIGNACIÓN DINÁMICA) ────────────────── */}
      {activeTab === 'turnos' && (
        <div className="glass p-6 rounded-3xl border border-white/[0.08] space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-bold text-white uppercase tracking-wider">
                Asignación Diaria de Operarios por Área
              </h2>
            </div>

            {/* Selector de Fecha */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Fecha de Turno:</span>
              <input
                type="date"
                value={fechaTurno}
                onChange={e => setFechaTurno(e.target.value)}
                className="input-dark font-mono font-bold text-xs"
              />
            </div>
          </div>

          {loadingTurnos ? (
            <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>
          ) : operadoresDisponibles.length === 0 ? (
            <p className="text-slate-500 text-center py-10 font-medium">No hay operarios marcados como Activos con el rol de &quot;Operador Multifuncional&quot; en el sistema.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dark w-full text-left">
                <thead>
                  <tr className="text-slate-400 uppercase font-bold text-[10px]">
                    <th className="p-4">Operario</th>
                    <th className="p-4">Área de Trabajo Asignada (Hoy)</th>
                    <th className="p-4">Turno</th>
                    <th className="p-4 text-right">Trazabilidad de Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {operadoresDisponibles.map(op => {
                    const asig = asignaciones.find(a => a.operador_id === op.id)

                    return (
                      <tr key={op.id} className="hover:bg-white/[0.02] border-b border-white/[0.06] last:border-0">
                        <td className="p-4 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                            {op.nombre.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-bold text-white text-sm block">{op.nombre}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{op.email}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <select
                            value={asig?.area || ''}
                            onChange={e => handleGuardarAsignacion(op.id, e.target.value, asig?.turno || 'dia')}
                            className="input-dark text-xs py-1.5 px-3 max-w-[200px] font-bold"
                          >
                            <option value="">✕ Sin Asignar (Libre)</option>
                            <option value="tejido">Tejido (Circulares)</option>
                            <option value="enlace">Enlace (Remallado)</option>
                            <option value="volteado">Volteado (Turning)</option>
                            <option value="planchado">Planchado (Hormado)</option>
                            <option value="preparado">Preparado (Empaque)</option>
                            <option value="almacen">Almacén (Despacho)</option>
                          </select>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-slate-500" />
                            <select
                              value={asig?.turno || 'dia'}
                              onChange={e => handleGuardarAsignacion(op.id, asig?.area || 'tejido', e.target.value)}
                              className="input-dark text-xs py-1 px-3 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                              disabled={!asig?.area}
                            >
                              <option value="dia">Día (Mañana)</option>
                              <option value="noche">Noche (Velada)</option>
                            </select>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          {asig?.area ? (
                            <span className="badge badge-success">✓ Programado</span>
                          ) : (
                            <span className="badge badge-neutral">✕ No Asignado</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: MATRIZ DE PERMISOS ─────────────────────────────────────────── */}
      {activeTab === 'permisos' && (
        <div className="glass p-6 rounded-3xl border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-bold text-white uppercase tracking-wider">
                Matriz de Permisos de Módulos por Rol (RBAC)
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">Control de Acceso Centralizado</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { id: 'admin', nombre: 'Administrador General', modulos: ['Dashboard', 'Personal / Accesos / Turnos', 'Catálogo de Medias', 'Máquinas de Planta', 'Tejido', 'Remallado', 'Volteado', 'Planchado', 'Preparado', 'Almacén', 'Ventas', 'Despacho', 'Mantenimiento', 'Reportes Financieros'], color: 'border-violet-500/40 text-violet-300' },
              { id: 'supervisor', nombre: 'Supervisor de Planta', modulos: ['Calendario de Turnos', 'Asignación de Máquinas', 'Control de Tejido', 'Remallado y Volteo', 'Reporte de Mermas', 'Planchado', 'Almacén', 'Materia Prima'], color: 'border-sky-500/40 text-sky-300' },
              { id: 'operador', nombre: 'Operador Multifuncional', modulos: ['Módulo del Área Asignada hoy (Tejido, Remallado, Volteado, Planchado, Preparado o Almacén)', 'Registro de Mermas/Averías en Turno activo'], color: 'border-indigo-500/40 text-indigo-300' },
              { id: 'vendedora', nombre: 'Asesora de Ventas', modulos: ['Ventas y Cobranzas', 'Catálogo de Medias', 'Despacho a Agencias', 'Reportes de Ventas'], color: 'border-pink-500/40 text-pink-300' },
              { id: 'tecnico', nombre: 'Técnico de Mantenimiento', modulos: ['Mantenimiento de Máquinas', 'Machinery Monitor', 'Catálogo de Repuestos'], color: 'border-amber-500/40 text-amber-300' },
            ].map(r => (
              <div key={r.id} className={`p-5 rounded-2xl bg-slate-900/60 border ${r.color} space-y-3`}>
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                  <h3 className="font-bold text-white text-sm uppercase">{r.nombre}</h3>
                  <span className="badge bg-indigo-500/20 text-indigo-300 text-[10px] font-mono uppercase">{r.id}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Módulos Permitidos:</span>
                  {r.modulos.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-200">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL: NUEVO / EDITAR USUARIO ────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-bold text-white">
                  {editUser ? 'Editar Usuario' : 'Nuevo Usuario'}
                </h2>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-white/10 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Nombre Completo</label>
                <input
                  type="text"
                  placeholder="Ej. Luis Pérez"
                  value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  className="input-dark text-xs w-full font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Correo Electrónico (Email)</label>
                <input
                  type="email"
                  placeholder="ej. luis@durey.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="input-dark text-xs w-full font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Rol de Sistema</label>
                <select
                  value={form.rol}
                  onChange={e => setForm({ ...form, rol: e.target.value })}
                  className="input-dark text-xs w-full font-medium"
                >
                  {ROLES_LISTA.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>

              {!editUser && (
                <div>
                  <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">
                    {isMock ? 'Contraseña (Opcional en Mock)' : 'Contraseña Temporal (Obligatoria)'}
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="input-dark text-xs w-full font-mono"
                    required={!isMock}
                  />
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="activo-check"
                  checked={form.activo}
                  onChange={e => setForm({ ...form, activo: e.target.checked })}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="activo-check" className="text-slate-300 font-medium cursor-pointer">
                  Usuario Activo en el Sistema
                </label>
              </div>
            </div>

            {errorEnvio && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-2xl font-bold flex flex-col gap-1 text-[11px] mt-4 animate-fadeInUp">
                <span>⚠️ ERROR DE BASE DE DATOS:</span>
                <span className="font-mono font-medium whitespace-pre-wrap">{errorEnvio}</span>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1 justify-center py-2 text-xs">
                Cancelar
              </button>
              <button onClick={guardarUsuario} className="btn-primary flex-1 justify-center py-2 text-xs bg-indigo-600 hover:bg-indigo-500 border-none shadow-lg shadow-indigo-600/20">
                <CheckCircle2 className="w-4 h-4" />
                {editUser ? 'Guardar Cambios' : 'Crear Usuario'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
