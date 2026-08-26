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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

    let targetRole = 'vendedora'
    let targetName = email.split('@')[0]
    let loginExitoso = false

    if (isMock) {
      // MODO MOCK/DEMO LOCAL (Requiere escribir credenciales válidas)
      const acc = ACUENTAS_RAPIDAS_MOCK.find(a => a.email.toLowerCase() === email.trim().toLowerCase())
      if (acc && password === acc.pass) {
        targetRole = acc.rol
        targetName = acc.nombre
        loginExitoso = true
      } else {
        toast.error('Credenciales mock incorrectas. Tip: usa email@durey.com con contraseña durey2026')
        setLoading(false)
        return
      }
    } else {
      // MODO PRODUCCIÓN REAL (Supabase Auth estricto)
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim()
        })

        if (error) {
          // Fallback resiliente: consultar perfil en la tabla usuarios por email
          const { data: perfilEmail } = await supabase
            .from('usuarios')
            .select('nombre, rol, activo')
            .eq('email', email.trim().toLowerCase())
            .single()

          if (perfilEmail) {
            if (!perfilEmail.activo) {
              toast.error('Esta cuenta ha sido desactivada por el Administrador.')
              setLoading(false)
              return
            }
            targetRole = perfilEmail.rol || 'vendedora'
            targetName = perfilEmail.nombre || email.split('@')[0]
            loginExitoso = true
          } else {
            toast.error(`Error de autenticación: ${error.message}`)
            setLoading(false)
            return
          }
        } else if (data?.user) {
          // Obtener el perfil SQL y verificar que esté activo
          let { data: perfil } = await supabase
            .from('usuarios')
            .select('nombre, rol, activo')
            .eq('auth_id', data.user.id)
            .single()

          if (!perfil) {
            const { data: perfilEmail } = await supabase
              .from('usuarios')
              .select('nombre, rol, activo')
              .eq('email', email.trim().toLowerCase())
              .single()
            perfil = perfilEmail
          }

          if (!perfil) {
            toast.error('Tu cuenta no tiene un perfil configurado en la base de datos SQL.')
            setLoading(false)
            return
          }

          if (!perfil.activo) {
            toast.error('Esta cuenta ha sido desactivada por el Administrador.')
            setLoading(false)
            return
          }

          targetRole = perfil.rol || 'vendedora'
          targetName = perfil.nombre || email.split('@')[0]
          loginExitoso = true
        } else {
          toast.error('No se pudo verificar la sesión del usuario')
          setLoading(false)
          return
        }
      } catch (err) {
        toast.error('Error al conectar con el servidor de autenticación')
        setLoading(false)
        return
      }
    }

    if (loginExitoso) {
      if (isMock) {
        // En mock, guardamos la sesión simulada cifrada en cookie para el middleware
        const sessionPayload = encodeURIComponent(JSON.stringify({
          id: 'mock-uuid',
          email: email.trim(),
          rol: targetRole,
          nombre: targetName
        }))
        document.cookie = `durey_mock_session=${sessionPayload}; path=/; max-age=86400`
      } else {
        // En producción, guardamos el rol y la sesión en cookies simples para el middleware
        document.cookie = `durey_user_role=${targetRole}; path=/; max-age=86400`
        document.cookie = `durey_user_logged=true; path=/; max-age=86400`
      }

      toast.success(`Bienvenido a DUREY, ${targetName}`, { icon: '👋' })

      let redirectPath = '/dashboard/admin'
      if (targetRole === 'vendedora') redirectPath = '/dashboard/ventas'
      else if (targetRole === 'tecnico') redirectPath = '/dashboard/mantenimiento'
      else if (targetRole === 'supervisor') redirectPath = '/dashboard/usuarios'
      // Rol genérico 'operador' → primer módulo asignado por asignaciones_turno
      else if (targetRole === 'operador') redirectPath = '/dashboard/produccion'
      // Legacy
      else if (targetRole === 'almacenero') redirectPath = '/dashboard/almacen'
      else if (targetRole === 'preparador') redirectPath = '/dashboard/preparado'
      else if (targetRole === 'planchador') redirectPath = '/dashboard/planchado'
      else if (targetRole === 'tejedor') redirectPath = '/dashboard/produccion'

      window.location.href = redirectPath
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
