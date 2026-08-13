// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ROLES_LABELS } from '@/lib/utils'
import {
  Users, UserPlus, Search, Filter, ShieldCheck, UserCheck,
  CheckCircle2, X, Edit2, UserX, Loader2, Sparkles, Mail, Lock, Shield
} from 'lucide-react'
import { toast } from 'sonner'

interface Usuario {
  id: string
  nombre: string
  email: string
  rol: string
  activo: boolean
  estado?: string // 'disponible', 'ocupada', 'en_turno'
  created_at?: string
}

const ROLES_LISTA = [
  { id: 'admin', label: 'Administrador General', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  { id: 'supervisor', label: 'Supervisor de Producción', color: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  { id: 'tejedor', label: 'Tejedor', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  { id: 'remalladora', label: 'Remalladora', color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  { id: 'planchador', label: 'Planchador', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
  { id: 'preparador', label: 'Preparador', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  { id: 'almacenero', label: 'Almacenero y Despacho', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  { id: 'vendedora', label: 'Asesora de Ventas', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  { id: 'tecnico', label: 'Técnico de Mantenimiento', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
]

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRolFilter, setSelectedRolFilter] = useState('todos')
  const [activeTab, setActiveTab] = useState<'usuarios' | 'permisos'>('usuarios')

  // Modales
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<Usuario | null>(null)

  // Formulario
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    rol: 'tejedor',
    password: '',
    activo: true
  })

  const supabase = createClient()

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
  }, [])

  useEffect(() => { cargarUsuarios() }, [cargarUsuarios])

  // ── FILTRADO ─────────────────────────────────────────────────────────────
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

  // ── ABRIR MODAL CREAR / EDITAR ───────────────────────────────────────────
  const abrirCrearModal = () => {
    setEditUser(null)
    setForm({ nombre: '', email: '', rol: 'tejedor', password: '', activo: true })
    setShowModal(true)
  }

  const abrirEditarModal = (u: Usuario) => {
    setEditUser(u)
    setForm({
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      password: '',
      activo: u.activo
    })
    setShowModal(true)
  }

  // ── GUARDAR USUARIO (CREAR O ACTUALIZAR) ──────────────────────────────────
  const guardarUsuario = async () => {
    if (!form.nombre.trim() || !form.email.trim() || !form.rol) {
      toast.error('Completa el nombre, email y rol del usuario')
      return
    }

    if (editUser) {
      const { error } = await supabase.from('usuarios').update({
        nombre: form.nombre.trim(),
        email: form.email.trim(),
        rol: form.rol,
        activo: form.activo
      }).eq('id', editUser.id)

      if (error) {
        toast.error('Error al actualizar el usuario')
        return
      }
      toast.success('✅ Usuario actualizado exitosamente')
    } else {
      const { error } = await supabase.from('usuarios').insert({
        nombre: form.nombre.trim(),
        email: form.email.trim(),
        rol: form.rol,
        activo: form.activo,
        estado: 'disponible',
        fecha: new Date().toISOString().split('T')[0]
      })

      if (error) {
        toast.error('Error al crear el usuario')
        return
      }
      toast.success('🎉 Usuario creado exitosamente')
    }

    setShowModal(false)
    cargarUsuarios()
  }

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

  const getRolStyle = (rol: string) => {
    const item = ROLES_LISTA.find(r => r.id === rol)
    return item ? item.color : 'bg-slate-500/20 text-slate-300 border-slate-500/30'
  }

  return (
    <div className="space-y-6 animate-fadeInUp pb-12">
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Gestión de Usuarios y Accesos (RBAC)</h1>
            <p className="text-slate-400 text-xs font-medium">Administración de usuarios, roles del sistema y matriz de permisos por área</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
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

      {activeTab === 'usuarios' ? (
        <>
          {/* ── BÚSQUEDA Y FILTROS POR ROL ──────────────────────────────────────── */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Buscador */}
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

            {/* Filtro por Rol */}
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
                <table className="table-dark">
                  <thead>
                    <tr>
                      <th>Trabajador / Nombre</th>
                      <th>Email</th>
                      <th>Rol Asignado</th>
                      <th>Estado Operativo</th>
                      <th>Activo</th>
                      <th className="text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosFiltrados.map(u => (
                      <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="font-bold text-white flex items-center gap-3 py-4">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-indigo-500/20">
                            {u.nombre.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm">{u.nombre}</p>
                          </div>
                        </td>
                        <td className="text-slate-400 text-xs font-mono">{u.email}</td>
                        <td>
                          <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full border ${getRolStyle(u.rol)}`}>
                            {ROLES_LABELS[u.rol] || u.rol}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${
                            u.estado === 'ocupada' || u.estado === 'en_turno'
                              ? 'badge-warning'
                              : 'badge-success'
                          }`}>
                            {u.estado === 'ocupada' || u.estado === 'en_turno' ? '🔴 En Turno' : '🟢 Disponible'}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => toggleActivo(u)}
                            className={`badge cursor-pointer hover:opacity-80 transition-opacity ${u.activo ? 'badge-info' : 'badge-neutral'}`}
                          >
                            {u.activo ? '✓ Activo' : '✕ Inactivo'}
                          </button>
                        </td>
                        <td className="text-right">
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
      ) : (
        /* ── VISTA DE MATRIZ DE PERMISOS POR ROL ───────────────────────────────── */
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
              { id: 'admin', nombre: 'Administrador General', modulos: ['Dashboard', 'Personal / Accesos', 'Catálogo', 'Máquinas', 'Tejido', 'Remallado', 'Planchado', 'Preparado', 'Almacén', 'Ventas', 'Despacho', 'Mantenimiento', 'Reportes'], color: 'border-violet-500/40 text-violet-300' },
              { id: 'vendedora', nombre: 'Asesora de Ventas', modulos: ['Ventas y Cobranzas', 'Catálogo de Medias', 'Despacho a Agencias', 'Reportes de Cartera'], color: 'border-pink-500/40 text-pink-300' },
              { id: 'almacenero', nombre: 'Almacenero y Despacho', modulos: ['Almacén y Salones', 'Recepción Pistola QR', 'Despacho a Agencias', 'Preparado'], color: 'border-cyan-500/40 text-cyan-300' },
              { id: 'tejedor', nombre: 'Tejedor Operario', modulos: ['Módulo de Tejido', 'Monitor de Máquinas', 'Mantenimiento / Averías'], color: 'border-purple-500/40 text-purple-300' },
              { id: 'planchador', nombre: 'Planchador', modulos: ['Módulo de Planchado', 'Matriz Semanal de Hormado'], color: 'border-red-500/40 text-red-300' },
              { id: 'preparador', nombre: 'Preparador / Embolsador', modulos: ['Preparado por SKU', 'Creación de Sacos QR', 'Almacén de Salones'], color: 'border-emerald-500/40 text-emerald-300' },
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
                  <label className="block font-semibold text-slate-400 mb-1 uppercase tracking-wider">Contraseña (Opcional en Demo)</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="input-dark text-xs w-full"
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
