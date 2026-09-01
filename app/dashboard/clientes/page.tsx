// @ts-nocheck
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Users, UserPlus, Search, Filter, Phone, MessageCircle, MapPin,
  ShoppingCart, CreditCard, DollarSign, Calendar, Clock, CheckCircle2,
  AlertTriangle, X, Edit2, Trash2, Eye, ExternalLink, ArrowRight,
  FileText, Building2, User, ChevronRight, RefreshCw, Layers
} from 'lucide-react'

interface Cliente {
  id: string
  tipo_documento: 'dni' | 'ruc' | string
  numero_documento: string
  nombre: string
  telefono?: string
  direccion?: string
  created_at?: string
}

interface VentaCliente {
  id: string
  codigo_venta: string
  total_soles: number
  monto_adelanto?: number
  tipo_pago: 'directo' | 'cuotas'
  estado: string
  fecha: string
  created_at: string
  asesora?: { id: string; nombre: string }
  cuotas?: { id: string; numero_cuota: number; monto: number; fecha_vencimiento: string; estado: string }[]
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [ventas, setVentas] = useState<VentaCliente[]>([])
  const [cuotas, setCuotas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Filtros y Búsqueda
  const [searchQuery, setSearchQuery] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'dni' | 'ruc' | 'deuda' | 'al_dia'>('todos')

  // Modales
  const [showAddEditModal, setShowAddEditModal] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  const [clienteForm, setClienteForm] = useState({
    id: '',
    tipo_documento: 'dni',
    numero_documento: '',
    nombre: '',
    telefono: '',
    direccion: ''
  })

  // Modal Historial de Compras
  const [selectedClienteHistorial, setSelectedClienteHistorial] = useState<Cliente | null>(null)

  const supabase = createClient()
  const isMock = typeof window !== 'undefined' && (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('tu-proyecto') ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
  )

  const loadFromLocal = (key: string, fallback: any[]) => {
    try {
      const d = localStorage.getItem(key)
      return d ? JSON.parse(d) : fallback
    } catch {
      return fallback
    }
  }

  const saveToLocal = (key: string, data: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch (e) {
      console.error(e)
    }
  }

  // ── CARGAR DATOS ──────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true)
    try {
      const [cliRes, venRes, cuoRes] = await Promise.all([
        supabase.from('clientes').select('*').order('nombre'),
        supabase.from('ventas').select(`
          id, codigo_venta, cliente_id, total_soles, monto_adelanto, tipo_pago, estado, fecha, created_at,
          asesora:usuarios(id, nombre)
        `).order('created_at', { ascending: false }),
        supabase.from('cuotas').select('id, venta_id, numero_cuota, monto, fecha_vencimiento, estado')
      ])

      if (cliRes.error) toast.error(`Error cargando clientes: ${cliRes.error.message}`)

      let listaClientes = cliRes.data ?? []
      let listaVentas = venRes.data ?? []
      let listaCuotas = cuoRes.data ?? []

      if (isMock) {
        listaClientes = loadFromLocal('durey_clientes', listaClientes)
        listaVentas = loadFromLocal('durey_ventas', listaVentas)
        listaCuotas = loadFromLocal('durey_cuotas', listaCuotas)
      }

      setClientes(listaClientes)
      setVentas(listaVentas)
      setCuotas(listaCuotas)
    } catch (err: any) {
      toast.error(`Error al conectar con el servidor: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [supabase, isMock])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // ── MAPEO ENRIQUECIDO DE CLIENTES CON VENTAS Y DEUDAS ─────────────────────
  const clientesEnriquecidos = useMemo(() => {
    return clientes.map(c => {
      // Ventas de este cliente
      const misVentas = ventas.filter(v => v.cliente_id === c.id)
      const totalComprado = misVentas.reduce((sum, v) => sum + Number(v.total_soles || 0), 0)
      const totalVentasCount = misVentas.length

      // Cuotas pendientes de este cliente
      const misVentasIds = misVentas.map(v => v.id)
      const misCuotas = cuotas.filter(q => misVentasIds.includes(q.venta_id))
      const saldoPendiente = misCuotas
        .filter(q => q.estado === 'pendiente')
        .reduce((sum, q) => sum + Number(q.monto || 0), 0)
      const cuotasPendientesCount = misCuotas.filter(q => q.estado === 'pendiente').length

      return {
        ...c,
        totalComprado,
        totalVentasCount,
        saldoPendiente,
        cuotasPendientesCount,
        tieneDeuda: saldoPendiente > 0,
        misVentas
      }
    })
  }, [clientes, ventas, cuotas])

  // ── FILTRADO Y BÚSQUEDA ───────────────────────────────────────────────────
  const clientesFiltrados = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return clientesEnriquecidos.filter(c => {
      // Búsqueda por texto
      if (q) {
        const matchNombre = c.nombre?.toLowerCase().includes(q)
        const matchDoc = c.numero_documento?.toLowerCase().includes(q)
        const matchTel = c.telefono?.toLowerCase().includes(q)
        const matchDir = c.direccion?.toLowerCase().includes(q)
        if (!matchNombre && !matchDoc && !matchTel && !matchDir) return false
      }

      // Filtro por tipo
      if (filtroTipo === 'dni' && (c.tipo_documento?.toLowerCase() !== 'dni' && c.numero_documento?.length !== 8)) return false
      if (filtroTipo === 'ruc' && (c.tipo_documento?.toLowerCase() !== 'ruc' && c.numero_documento?.length !== 11)) return false
      if (filtroTipo === 'deuda' && !c.tieneDeuda) return false
      if (filtroTipo === 'al_dia' && c.tieneDeuda) return false

      return true
    })
  }, [clientesEnriquecidos, searchQuery, filtroTipo])

  // ── MÉTRICAS GLOBALES ─────────────────────────────────────────────────────
  const metricas = useMemo(() => {
    const totalClientes = clientes.length
    const clientesConDeuda = clientesEnriquecidos.filter(c => c.tieneDeuda).length
    const clientesAlDia = totalClientes - clientesConDeuda
    const totalDeudaAcumulada = clientesEnriquecidos.reduce((sum, c) => sum + c.saldoPendiente, 0)
    const totalVentasAcumuladas = clientesEnriquecidos.reduce((sum, c) => sum + c.totalComprado, 0)

    return {
      totalClientes,
      clientesConDeuda,
      clientesAlDia,
      totalDeudaAcumulada,
      totalVentasAcumuladas
    }
  }, [clientes, clientesEnriquecidos])

  // ── ACCIONES: CREAR / EDITAR CLIENTE ──────────────────────────────────────
  const abrirCrearModal = () => {
    setEditingCliente(null)
    setClienteForm({
      id: '',
      tipo_documento: 'dni',
      numero_documento: '',
      nombre: '',
      telefono: '',
      direccion: ''
    })
    setShowAddEditModal(true)
  }

  const abrirEditarModal = (c: Cliente) => {
    setEditingCliente(c)
    setClienteForm({
      id: c.id,
      tipo_documento: c.tipo_documento || (c.numero_documento?.length === 11 ? 'ruc' : 'dni'),
      numero_documento: c.numero_documento || '',
      nombre: c.nombre || '',
      telefono: c.telefono || '',
      direccion: c.direccion || ''
    })
    setShowAddEditModal(true)
  }

  const handleGuardarCliente = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clienteForm.nombre.trim()) {
      toast.error('El nombre o razón social es obligatorio')
      return
    }
    if (!clienteForm.numero_documento.trim()) {
      toast.error('El número de DNI o RUC es obligatorio')
      return
    }

    setSaving(true)
    const doc = clienteForm.numero_documento.trim()
    const tipo = clienteForm.tipo_documento || (doc.length === 11 ? 'ruc' : 'dni')

    try {
      if (editingCliente) {
        // Actualización
        if (!isMock) {
          const { error } = await supabase.from('clientes').update({
            tipo_documento: tipo,
            numero_documento: doc,
            nombre: clienteForm.nombre.trim(),
            telefono: clienteForm.telefono.trim(),
            direccion: clienteForm.direccion.trim()
          }).eq('id', editingCliente.id)

          if (error) throw error
        }
        const list = clientes.map(x => x.id === editingCliente.id ? {
          ...x,
          tipo_documento: tipo,
          numero_documento: doc,
          nombre: clienteForm.nombre.trim(),
          telefono: clienteForm.telefono.trim(),
          direccion: clienteForm.direccion.trim()
        } : x)
        setClientes(list)
        saveToLocal('durey_clientes', list)
        toast.success(`Cliente "${clienteForm.nombre}" actualizado`)
      } else {
        // Nuevo Cliente
        const newCli = {
          id: Math.random().toString(),
          tipo_documento: tipo,
          numero_documento: doc,
          nombre: clienteForm.nombre.trim(),
          telefono: clienteForm.telefono.trim(),
          direccion: clienteForm.direccion.trim(),
          created_at: new Date().toISOString()
        }

        if (!isMock) {
          const { data, error } = await supabase.from('clientes').insert({
            tipo_documento: newCli.tipo_documento,
            numero_documento: newCli.numero_documento,
            nombre: newCli.nombre,
            telefono: newCli.telefono || null,
            direccion: newCli.direccion || null
          }).select().single()

          if (error) throw error
          if (data) newCli.id = data.id
        }

        const list = [newCli, ...clientes]
        setClientes(list)
        saveToLocal('durey_clientes', list)
        toast.success(`Cliente "${newCli.nombre}" registrado exitosamente`)
      }

      setShowAddEditModal(false)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al guardar cliente: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── ELIMINAR CLIENTE ──────────────────────────────────────────────────────
  const handleEliminarCliente = async (c: Cliente) => {
    const tieneVentas = ventas.some(v => v.cliente_id === c.id)
    if (tieneVentas) {
      if (!confirm(`El cliente "${c.nombre}" tiene ventas registradas en el historial. ¿Deseas eliminarlo de todos modos?`)) {
        return
      }
    } else {
      if (!confirm(`¿Eliminar definitivamente al cliente "${c.nombre}"?`)) {
        return
      }
    }

    try {
      if (!isMock) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id)
        if (isUuid) {
          const { error } = await supabase.from('clientes').delete().eq('id', c.id)
          if (error) throw error
        } else {
          await supabase.from('clientes').delete().eq('numero_documento', c.numero_documento)
        }
      }
      const list = clientes.filter(x => x.id !== c.id)
      setClientes(list)
      saveToLocal('durey_clientes', list)
      toast.success(`Cliente "${c.nombre}" eliminado`)
      cargarDatos()
    } catch (err: any) {
      toast.error(`Error al eliminar cliente: ${err.message}`)
    }
  }

  // ── ABRIR HISTORIAL DE COMPRAS ────────────────────────────────────────────
  const abrirHistorialCliente = (c: Cliente) => {
    setSelectedClienteHistorial(c)
  }

  const ventasDelClienteSeleccionado = useMemo(() => {
    if (!selectedClienteHistorial) return []
    return ventas
      .filter(v => v.cliente_id === selectedClienteHistorial.id)
      .map(v => {
        const misCuotas = cuotas.filter(q => q.venta_id === v.id)
        return {
          ...v,
          cuotas: misCuotas
        }
      })
  }, [selectedClienteHistorial, ventas, cuotas])

  return (
    <div className="space-y-6 animate-fadeIn pb-16">
      
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="glass rounded-3xl p-6 border border-white/[0.08] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Directorio y Cartera de Clientes</h1>
            <p className="text-slate-400 text-xs mt-0.5">
              Agenda centralizada de compradores, contacto telefónico, enlaces a WhatsApp, historial de compras y cuentas por cobrar.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={abrirCrearModal}
            className="btn-primary text-xs py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 border-none flex items-center gap-1.5 font-bold shadow-lg shadow-rose-600/20 flex-1 sm:flex-none justify-center"
          >
            <UserPlus className="w-4 h-4" /> + Registrar Cliente
          </button>
          <Link
            href="/dashboard/ventas"
            className="btn-secondary text-xs py-2.5 px-4 rounded-2xl border-white/10 hover:bg-white/5 text-white flex items-center gap-1.5 font-bold whitespace-nowrap"
          >
            <ShoppingCart className="w-4 h-4 text-pink-400" /> Ir a Ventas
          </Link>
          <button
            type="button"
            onClick={cargarDatos}
            className="btn-secondary p-2.5 rounded-2xl border-white/[0.08] hover:bg-white/5 text-slate-300"
            title="Recargar datos"
          >
            <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
          </button>
        </div>
      </div>

      {/* ── METRICS SUMMARY CARDS ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass p-5 rounded-3xl border border-white/[0.08] space-y-1 shadow-md">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Clientes Registrados</span>
          <p className="text-2xl font-black text-white font-mono">{metricas.totalClientes}</p>
          <span className="text-[10px] text-slate-500">Base total de compradores</span>
        </div>

        <div className="glass p-5 rounded-3xl border border-rose-500/20 bg-rose-500/[0.02] space-y-1 shadow-md">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block">Con Crédito / Deuda Activa</span>
          <p className="text-2xl font-black text-rose-400 font-mono">{metricas.clientesConDeuda}</p>
          <span className="text-[10px] text-rose-400 font-bold">
            S/ {metricas.totalDeudaAcumulada.toFixed(2)} por cobrar
          </span>
        </div>

        <div className="glass p-5 rounded-3xl border border-emerald-500/20 space-y-1 shadow-md">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">Clientes al Día</span>
          <p className="text-2xl font-black text-emerald-400 font-mono">{metricas.clientesAlDia}</p>
          <span className="text-[10px] text-slate-500">Sin saldo pendiente</span>
        </div>

        <div className="glass p-5 rounded-3xl border border-white/[0.08] space-y-1 shadow-md">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ventas Facturadas</span>
          <p className="text-2xl font-black text-white font-mono">S/ {metricas.totalVentasAcumuladas.toFixed(2)}</p>
          <span className="text-[10px] text-slate-500">Total histórico acumulado</span>
        </div>
      </div>

      {/* ── SEARCH & FILTER CONTROLS ───────────────────────────────────────── */}
      <div className="glass p-4 rounded-3xl border border-white/[0.08] flex flex-col md:flex-row items-center justify-between gap-4 shadow-md">
        {/* Search Input */}
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nombre, DNI, RUC, teléfono o dirección..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="input-dark w-full pl-10 text-xs py-2 rounded-2xl"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {[
            { id: 'todos', label: 'Todos' },
            { id: 'dni', label: 'DNI (Naturales)' },
            { id: 'ruc', label: 'RUC (Empresas)' },
            { id: 'deuda', label: 'Con Deuda Pendiente' },
            { id: 'al_dia', label: 'Al Día' }
          ].map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltroTipo(f.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                filtroTipo === f.id
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                  : 'text-slate-400 hover:text-white bg-white/[0.02] border border-white/[0.04]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── CLIENTS DIRECTORY GRID ─────────────────────────────────────────── */}
      {loading ? (
        <div className="p-16 text-center text-slate-400 text-xs">Cargando directorio de clientes...</div>
      ) : clientesFiltrados.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center space-y-3 border border-white/[0.08]">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto text-xl">
            👥
          </div>
          <p className="text-slate-300 font-bold text-sm">No se encontraron clientes registrados</p>
          <p className="text-slate-500 text-xs max-w-md mx-auto">
            {searchQuery || filtroTipo !== 'todos'
              ? 'No hay resultados que coincidan con los filtros de búsqueda aplicados.'
              : 'Empieza registrando a tus clientes con su DNI o RUC y teléfono para gestionar sus pedidos y cobranzas.'}
          </p>
          {!searchQuery && filtroTipo === 'todos' && (
            <button
              type="button"
              onClick={abrirCrearModal}
              className="btn-primary text-xs py-2 px-4 bg-rose-600 hover:bg-rose-500 border-none font-bold rounded-xl inline-flex items-center gap-1.5 mt-2"
            >
              <UserPlus className="w-4 h-4" /> Registrar Primer Cliente
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {clientesFiltrados.map(c => {
            const cleanPhone = (c.telefono || '').replace(/\D/g, '')
            const isRuc = (c.tipo_documento?.toLowerCase() === 'ruc' || c.numero_documento?.length === 11)

            return (
              <div
                key={c.id}
                className="glass p-5 rounded-3xl border border-white/[0.08] hover:border-rose-500/30 transition-all flex flex-col justify-between space-y-4 shadow-lg bg-gradient-to-b from-white/[0.02] to-transparent"
              >
                {/* Header Cliente */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className={`badge text-[9px] font-bold py-0.5 px-2 mb-1.5 ${
                        isRuc ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      }`}>
                        {isRuc ? '🏢 RUC (Empresa)' : '👤 DNI (Persona Natural)'}
                      </span>
                      <h3 className="text-base font-black text-white tracking-tight leading-tight">{c.nombre}</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => abrirEditarModal(c)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                        title="Editar datos del cliente"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEliminarCliente(c)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Eliminar cliente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs">
                    <p className="font-mono text-slate-300 flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Documento:</span>
                      <span className="font-bold text-white">{c.numero_documento || 'Sin documento'}</span>
                    </p>
                    {c.direccion && (
                      <p className="text-slate-400 text-[11px] flex items-center gap-1.5 line-clamp-1">
                        <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>{c.direccion}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Contacto Directo: Llamada y WhatsApp */}
                <div className="p-3 bg-slate-900/60 rounded-2xl border border-white/[0.04] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Teléfono / WhatsApp</span>
                    <span className="text-xs font-mono font-bold text-white">{c.telefono || 'Sin teléfono'}</span>
                  </div>
                  {c.telefono ? (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <a
                        href={`tel:${c.telefono}`}
                        className="btn-secondary py-1.5 px-2 text-[11px] font-bold rounded-xl flex items-center justify-center gap-1 text-slate-200 hover:text-white border-white/10"
                      >
                        <Phone className="w-3 h-3 text-cyan-400" /> Llamar
                      </a>
                      <a
                        href={`https://wa.me/${cleanPhone.startsWith('51') ? cleanPhone : '51' + cleanPhone}?text=Hola%20${encodeURIComponent(c.nombre)},%20te%20escribo%20de%20Durey%20Medias.`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="py-1.5 px-2 text-[11px] font-bold rounded-xl flex items-center justify-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-all"
                      >
                        <MessageCircle className="w-3 h-3 text-emerald-400" /> WhatsApp
                      </a>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic">No se registró número de contacto</p>
                  )}
                </div>

                {/* Resumen Financiero y Acciones */}
                <div className="pt-3 border-t border-white/[0.06] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">Total Comprado</span>
                      <span className="text-xs font-mono font-bold text-white">S/ {c.totalComprado.toFixed(2)}</span>
                      <span className="text-[10px] text-slate-500 block">({c.totalVentasCount} compras)</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">Estado de Cuenta</span>
                      <span className={`text-xs font-mono font-black ${c.tieneDeuda ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {c.tieneDeuda ? `S/ ${c.saldoPendiente.toFixed(2)} pendiente` : '✓ Al Día (S/ 0.00)'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => abrirHistorialCliente(c)}
                      className="btn-secondary py-1.5 px-2.5 text-[11px] font-bold rounded-xl flex-1 flex items-center justify-center gap-1 border-white/10 text-slate-200 hover:text-white"
                    >
                      <Eye className="w-3 h-3 text-rose-400" /> Historial ({c.totalVentasCount})
                    </button>
                    <Link
                      href="/dashboard/ventas"
                      className="btn-secondary py-1.5 px-2.5 text-[11px] font-bold rounded-xl border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center gap-1"
                    >
                      <ShoppingCart className="w-3 h-3" /> Venta
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── MODAL 1: REGISTRAR / EDITAR CLIENTE ───────────────────────────────── */}
      {showAddEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-md p-7 shadow-2xl border border-white/10 animate-fadeInUp">
            <div className="flex justify-between items-center pb-4 border-b border-white/[0.08] mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {editingCliente ? '✏️ Editar Datos de Cliente' : '👤 Registrar Nuevo Cliente'}
              </h2>
              <button
                type="button"
                onClick={() => setShowAddEditModal(false)}
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGuardarCliente} className="space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Tipo Doc.</label>
                  <select
                    value={clienteForm.tipo_documento}
                    onChange={e => setClienteForm({ ...clienteForm, tipo_documento: e.target.value })}
                    className="input-dark w-full py-2 font-bold"
                  >
                    <option value="dni">DNI</option>
                    <option value="ruc">RUC</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-slate-300 font-bold mb-1">Número de DNI / RUC *</label>
                  <input
                    type="text"
                    maxLength={11}
                    value={clienteForm.numero_documento}
                    onChange={e => setClienteForm({ ...clienteForm, numero_documento: e.target.value })}
                    placeholder={clienteForm.tipo_documento === 'ruc' ? 'Ej: 20601234567' : 'Ej: 45678912'}
                    className="input-dark w-full py-2 font-mono font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Nombre Completo / Razón Social *</label>
                <input
                  type="text"
                  value={clienteForm.nombre}
                  onChange={e => setClienteForm({ ...clienteForm, nombre: e.target.value })}
                  placeholder="Ej: Juan Pérez / Comercial Gamarra S.A.C."
                  className="input-dark w-full py-2 font-bold text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">📞 Teléfono / WhatsApp</label>
                <input
                  type="text"
                  value={clienteForm.telefono}
                  onChange={e => setClienteForm({ ...clienteForm, telefono: e.target.value })}
                  placeholder="Ej: 999 888 777"
                  className="input-dark w-full py-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">📍 Dirección de Envío / Agencia</label>
                <input
                  type="text"
                  value={clienteForm.direccion}
                  onChange={e => setClienteForm({ ...clienteForm, direccion: e.target.value })}
                  placeholder="Ej: Jr. Gamarra 840 Stand 102 / Agencia Marvisur"
                  className="input-dark w-full py-2"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/[0.06] mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddEditModal(false)}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex-1 justify-center py-2.5 bg-rose-600 hover:bg-rose-500 border-none font-bold text-white shadow-lg shadow-rose-600/20"
                >
                  {saving ? 'Guardando...' : editingCliente ? 'Guardar Cambios' : 'Registrar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 2: HISTORIAL DE COMPRAS Y DEUDAS DEL CLIENTE ───────────────── */}
      {selectedClienteHistorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass rounded-3xl w-full max-w-3xl p-7 shadow-2xl border border-white/10 animate-fadeInUp max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-white/[0.08] mb-4 flex-shrink-0">
              <div>
                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block">Historial de Compras y Deudas</span>
                <h2 className="text-lg font-black text-white">{selectedClienteHistorial.nombre}</h2>
                <p className="text-xs text-slate-400 font-mono">
                  {selectedClienteHistorial.tipo_documento?.toUpperCase()}: {selectedClienteHistorial.numero_documento}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedClienteHistorial(null)}
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 space-y-4">
              {ventasDelClienteSeleccionado.length === 0 ? (
                <div className="p-10 text-center text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-white/[0.04]">
                  🛍️ Este cliente no tiene ventas registradas en el sistema todavía.
                </div>
              ) : (
                ventasDelClienteSeleccionado.map(v => (
                  <div key={v.id} className="p-4 rounded-2xl bg-slate-900/60 border border-white/[0.06] space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono font-bold text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded-lg border border-rose-500/20">
                          {v.codigo_venta}
                        </code>
                        <span className={`badge text-[9px] font-bold ${
                          v.tipo_pago === 'directo' ? 'badge-success' : 'badge-warning'
                        }`}>
                          {v.tipo_pago === 'directo' ? '✓ Pago Directo' : '⏳ A Crédito / Cuotas'}
                        </span>
                        <span className="badge badge-info text-[9px] capitalize">{v.estado}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 mr-2">{v.fecha}</span>
                        <span className="text-sm font-black text-white font-mono">S/ {Number(v.total_soles).toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Desglose de Cuotas si es a crédito */}
                    {v.tipo_pago === 'cuotas' && v.cuotas && v.cuotas.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Cronograma de Cuotas:</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {v.cuotas.map(q => (
                            <div key={q.id} className="p-2 rounded-xl bg-black/40 border border-white/[0.04] text-[11px] flex items-center justify-between">
                              <div>
                                <span className="font-bold text-slate-300 block">Cuota {q.numero_cuota}</span>
                                <span className="text-[10px] font-mono text-slate-500">Vence: {q.fecha_vencimiento}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-bold text-white block">S/ {Number(q.monto).toFixed(2)}</span>
                                <span className={`badge text-[8px] py-0.5 px-1.5 ${
                                  q.estado === 'pagada' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'
                                }`}>
                                  {q.estado === 'pagada' ? 'Pagada' : 'Pendiente'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-white/[0.06] mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedClienteHistorial(null)}
                className="btn-secondary py-2 px-5 text-xs rounded-xl"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
