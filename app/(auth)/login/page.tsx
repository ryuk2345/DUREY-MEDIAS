'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shirt, Lock, Mail, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

const ACUENTAS_RAPIDAS_MOCK = [
  { rol: 'admin', nombre: 'Administrador General', email: 'admin@durey.com', pass: 'durey2026' },
  { rol: 'supervisor', nombre: 'Supervisor Durey', email: 'supervisor@durey.com', pass: 'durey2026' },
  { rol: 'operador', nombre: 'Carlos Operador', email: 'operador@durey.com', pass: 'durey2026' },
  { rol: 'vendedora', nombre: 'Sofia Vendedora', email: 'vendedora@durey.com', pass: 'durey2026' },
  { rol: 'tecnico', nombre: 'Pedro Técnico', email: 'tecnico@durey.com', pass: 'durey2026' },
  // Legacy — compatible con datos históricos
  { rol: 'almacenero', nombre: 'Juan Almacenero', email: 'almacenero@durey.com', pass: 'durey2026' },
  { rol: 'tejedor', nombre: 'Tejedor Operario', email: 'tejedor@durey.com', pass: 'durey2026' },
  { rol: 'planchador', nombre: 'Carlos Planchador', email: 'planchador@durey.com', pass: 'durey2026' },
  { rol: 'preparador', nombre: 'Lucia Preparadora', email: 'preparador@durey.com', pass: 'durey2026' },
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

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

    try {
      // 1. Invocar endpoint de autenticación que emite JWT firmado
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: password.trim() })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        toast.error(data.error || 'Credenciales inválidas')
        setLoading(false)
        return
      }

      const { user, access_token } = data

      // 2. Inyectar el JWT en el cliente de Supabase para que las peticiones lleven Authorization: Bearer <jwt>
      if (access_token) {
        try {
          const { error: sessionErr } = await supabase.auth.setSession({
            access_token,
            refresh_token: access_token
          })
          if (!sessionErr) {
            console.log('🔑 [Shadow Auth] Sesión Supabase activada con JWT:', {
              user_id: user.id,
              role: user.rol,
              email: user.email
            })
          }
        } catch (sessionEx) {
          console.warn('Nota: Sincronización de sesión Supabase en progreso:', sessionEx)
        }
      }

      toast.success(`Bienvenido a DUREY, ${user.nombre}`, { icon: '👋' })

      let redirectPath = '/dashboard/admin'
      if (user.rol === 'vendedora') redirectPath = '/dashboard/ventas'
      else if (user.rol === 'tecnico') redirectPath = '/dashboard/mantenimiento'
      else if (user.rol === 'supervisor') redirectPath = '/dashboard/usuarios'
      else if (user.rol === 'operador') redirectPath = '/dashboard/produccion'
      else if (user.rol === 'almacenero') redirectPath = '/dashboard/almacen'
      else if (user.rol === 'preparador') redirectPath = '/dashboard/preparado'
      else if (user.rol === 'planchador') redirectPath = '/dashboard/planchado'
      else if (user.rol === 'tejedor') redirectPath = '/dashboard/produccion'

      router.push(redirectPath)
    } catch (err: any) {
      toast.error('Error al conectar con el servidor: ' + (err.message || 'Error desconocido'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-4 relative overflow-hidden font-sans">
      {/* Círculos decorativos resplandecientes de fondo */}
      <div className="absolute top-10 left-10 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* TARJETA DE LOGIN CON FORMULARIO */}
        <div className="glass rounded-3xl p-8 border border-white/10 shadow-2xl space-y-6 animate-fadeInUp">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-blue-500/30 text-white">
              <Shirt className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-black text-2xl text-white tracking-tight flex items-center gap-2">
                DUREY <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">FÁBRICA</span>
              </h1>
              <p className="text-xs text-slate-400 font-medium">Gestión y Control Logístico de Medias</p>
            </div>
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white tracking-tight">Iniciar Sesión</h2>
            <p className="text-xs text-slate-400">Ingresa tus credenciales para acceder al sistema</p>
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
                  placeholder="ejemplo@durey.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input-dark pl-10 py-3.5 text-xs w-full font-semibold text-white border-white/10 focus:border-blue-500"
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
                  className="input-dark pl-10 pr-10 py-3.5 text-xs w-full font-semibold text-white border-white/10 focus:border-blue-500"
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
            <span className="text-[10px] text-slate-500 font-mono">DUREY HOSIERY v3.5 · Control de Acceso Protegido por Roles (RBAC)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
