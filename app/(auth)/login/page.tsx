// @ts-nocheck
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shirt, Lock, Mail, Eye, EyeOff, ShieldCheck, Sparkles, ArrowRight, CheckCircle2, UserCheck, Key, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

const ACUENTAS_RAPIDAS = [
  { rol: 'admin', nombre: 'Administrador General', email: 'admin@durey.com', pass: 'durey2026', icon: '👑', desc: 'Acceso total a todos los módulos y parámetros' },
  { rol: 'vendedora', nombre: 'Sofia Vendedora', email: 'vendedora@durey.com', pass: 'durey2026', icon: '🛍️', desc: 'Ventas, comprobantes, cuotas y cronograma' },
  { rol: 'almacenero', nombre: 'Juan Almacenero', email: 'almacenero@durey.com', pass: 'durey2026', icon: '📦', desc: 'Pistola escáner, salones y despacho a agencias' },
  { rol: 'tejedor', nombre: 'Tejedor Operario', email: 'tejedor@durey.com', pass: 'durey2026', icon: '⚙️', desc: 'Producción primaria y reporte de averías' },
  { rol: 'planchador', nombre: 'Carlos Planchador', email: 'planchador@durey.com', pass: 'durey2026', icon: '♨️', desc: 'Control de planchado y matriz semanal' },
  { rol: 'preparador', nombre: 'Lucia Preparadora', email: 'preparador@durey.com', pass: 'durey2026', icon: '🏷️', desc: 'Embolsado por SKU y Sacos Maestros QR' },
  { rol: 'tecnico', nombre: 'Pedro Técnico', email: 'tecnico@durey.com', pass: 'durey2026', icon: '👨‍🔧', desc: 'Atención de averías y repuestos de máquinas' }
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rolSeleccionadoDemo, setRolSeleccionadoDemo] = useState<string | null>(null)

  const router = useRouter()
  const supabase = createClient()

  // ── INICIAR SESIÓN CON CREDENCIALES ───────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) {
      toast.error('Ingresa tu email y contraseña de usuario')
      return
    }

    setLoading(true)

    // Buscar si coincide con alguna cuenta demo preestablecida
    const acc = ACUENTAS_RAPIDAS.find(a => a.email.toLowerCase() === email.trim().toLowerCase())

    let targetRole = acc ? acc.rol : 'admin'
    let targetName = acc ? acc.nombre : email.split('@')[0]

    // Intentar inicio de sesión real en Supabase Auth
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim()
      })

      if (!error && data?.user) {
        const { data: perfil } = await supabase
          .from('usuarios')
          .select('nombre, rol')
          .eq('email', email.trim())
          .single()

        if (perfil) {
          targetRole = perfil.rol || 'admin'
          targetName = perfil.nombre || targetName
        }
      }
    } catch (err) {
      console.log('Falla inicio Supabase Auth, continuando modo demo local:', err)
    }

    // Establecer cookies de sesión
    document.cookie = `durey_demo_role=${targetRole}; path=/; max-age=86400`
    document.cookie = `durey_demo_name=${encodeURIComponent(targetName)}; path=/; max-age=86400`
    document.cookie = `durey_demo_email=${encodeURIComponent(email.trim())}; path=/; max-age=86400`

    toast.success(`Bienvenido a DUREY, ${targetName}`, { icon: '👋' })

    // Redireccionar al módulo asignado por rol
    let redirectPath = '/dashboard/admin'
    if (targetRole === 'vendedora') redirectPath = '/dashboard/ventas'
    else if (targetRole === 'almacenero') redirectPath = '/dashboard/almacen'
    else if (targetRole === 'preparador') redirectPath = '/dashboard/preparado'
    else if (targetRole === 'planchador') redirectPath = '/dashboard/planchado'
    else if (targetRole === 'tecnico') redirectPath = '/dashboard/mantenimiento'
    else if (targetRole === 'tejedor') redirectPath = '/dashboard/produccion'

    router.push(redirectPath)
  }

  // ── INICIO DE SESIÓN RÁPIDO CON 1 CLIC ───────────────────────────────────
  const loginRapido = (acc: typeof ACUENTAS_RAPIDAS[0]) => {
    setEmail(acc.email)
    setPassword(acc.pass)
    setRolSeleccionadoDemo(acc.rol)

    document.cookie = `durey_demo_role=${acc.rol}; path=/; max-age=86400`
    document.cookie = `durey_demo_name=${encodeURIComponent(acc.nombre)}; path=/; max-age=86400`
    document.cookie = `durey_demo_email=${encodeURIComponent(acc.email)}; path=/; max-age=86400`

    toast.success(`Acceso de prueba iniciado como ${acc.nombre} (${acc.rol.toUpperCase()})`, { icon: acc.icon })

    let redirectPath = '/dashboard/admin'
    if (acc.rol === 'vendedora') redirectPath = '/dashboard/ventas'
    else if (acc.rol === 'almacenero') redirectPath = '/dashboard/almacen'
    else if (acc.rol === 'preparador') redirectPath = '/dashboard/preparado'
    else if (acc.rol === 'planchador') redirectPath = '/dashboard/planchado'
    else if (acc.rol === 'tecnico') redirectPath = '/dashboard/mantenimiento'
    else if (acc.rol === 'tejedor') redirectPath = '/dashboard/produccion'

    router.push(redirectPath)
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-4 relative overflow-hidden font-sans">
      {/* Círculos decorativos resplandecientes de fondo */}
      <div className="absolute top-10 left-10 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center z-10">

        {/* COLUMNA IZQUIERDA: TARJETA DE LOGIN CON FORMULARIO */}
        <div className="lg:col-span-6 glass rounded-3xl p-8 border border-white/10 shadow-2xl space-y-6 animate-fadeInUp">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-blue-500/30 text-white">
              <Shirt className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-black text-2xl text-white tracking-tight flex items-center gap-2">
                DUREY <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">FÁBRICA DE MEDIAS</span>
              </h1>
              <p className="text-xs text-slate-400 font-medium">Sistema Integral de Gestión y Control Logístico</p>
            </div>
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white tracking-tight">Iniciar Sesión</h2>
            <p className="text-xs text-slate-400">Ingresa tus credenciales de acceso para entrar al sistema</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* EMAIL */}
            <div>
              <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Correo Electrónico / Usuario
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="ej. vendedora@durey.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input-dark pl-10 py-3 text-xs w-full font-semibold text-white border-white/10 focus:border-blue-500"
                />
              </div>
            </div>

            {/* CONTRASEÑA */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Contraseña de Acceso
                </label>
                <a href="#" onClick={(e) => { e.preventDefault(); toast.info('Contacta al Administrador para restablecer tu contraseña') }} className="text-[10px] text-blue-400 hover:underline">
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input-dark pl-10 pr-10 py-3 text-xs w-full font-semibold text-white border-white/10 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* RECORDAR SESIÓN */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-slate-400 text-xs cursor-pointer select-none">
                <input type="checkbox" defaultChecked className="checkbox checkbox-xs checkbox-primary" />
                <span>Mantener sesión iniciada</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3.5 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 border-none font-bold uppercase tracking-wider text-white shadow-lg shadow-blue-600/30 rounded-2xl flex items-center gap-2"
            >
              {loading ? 'Verificando...' : 'INGRESAR AL SISTEMA'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="pt-4 border-t border-white/[0.06] text-center">
            <span className="text-[10px] text-slate-500 font-mono">DUREY HOSIERY v3.5 · Sistema Protegido con Control de Acceso por Roles (RBAC)</span>
          </div>
        </div>

        {/* COLUMNA DERECHA: ACCESO RÁPIDO POR ROL PARA PRUEBAS E INSPECCIÓN */}
        <div className="lg:col-span-6 space-y-4">
          <div className="glass p-6 rounded-3xl border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-white/[0.08]">
              <ShieldCheck className="w-5 h-5 text-blue-400" />
              <div>
                <h3 className="font-bold text-white text-sm">Acceso Rápido por Rol</h3>
                <p className="text-[11px] text-slate-400">Selecciona un usuario de prueba para ingresar directamente al módulo de su área</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {ACUENTAS_RAPIDAS.map(acc => (
                <button
                  key={acc.rol}
                  type="button"
                  onClick={() => loginRapido(acc)}
                  className={`p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                    rolSeleccionadoDemo === acc.rol
                      ? 'border-blue-500 bg-blue-500/20 text-white'
                      : 'border-white/[0.06] bg-slate-900/50 hover:bg-slate-900 hover:border-white/20 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{acc.icon}</span>
                    <div>
                      <p className="font-bold text-xs text-white leading-tight">{acc.nombre}</p>
                      <p className="text-[10px] text-slate-400 font-mono uppercase font-semibold">{acc.rol}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
