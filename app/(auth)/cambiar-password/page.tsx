'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shirt, Lock, Eye, EyeOff, ShieldCheck, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

function CambiarPasswordContent() {
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [confirmarPassword, setConfirmarPassword] = useState('')
  const [showNueva, setShowNueva] = useState(false)
  const [showConfirmar, setShowConfirmar] = useState(false)
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState('')
  const [userName, setUserName] = useState('')

  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Leer userId y nombre desde cookies (seteadas en el login)
    const id = document.cookie.split('; ').find(r => r.startsWith('durey_user_id='))?.split('=')[1] ?? ''
    const name = document.cookie.split('; ').find(r => r.startsWith('durey_user_name='))?.split('=')[1] ?? ''
    if (!id) {
      router.push('/login')
      return
    }
    setUserId(id)
    setUserName(decodeURIComponent(name))
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (nuevaPassword.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (nuevaPassword !== confirmarPassword) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    if (nuevaPassword === 'durey2026') {
      toast.error('No puedes usar la contraseña temporal. Elige una diferente.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          nuevaPassword,
          esPrimerLogin: true
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        toast.error(data.error || 'Error al cambiar contraseña')
        setLoading(false)
        return
      }

      toast.success('✅ Contraseña actualizada correctamente. Bienvenido al sistema.')

      // Redirigir al dashboard (la cookie de rol ya está seteada del login anterior)
      const rol = document.cookie.split('; ').find(r => r.startsWith('durey_user_role='))?.split('=')[1] ?? 'vendedora'
      let redirect = '/dashboard/admin'
      if (rol === 'vendedora') redirect = '/dashboard/ventas'
      else if (rol === 'tecnico') redirect = '/dashboard/mantenimiento'
      else if (rol === 'supervisor') redirect = '/dashboard/usuarios'
      else if (rol === 'operador') redirect = '/dashboard/produccion'
      else if (rol === 'almacenero') redirect = '/dashboard/almacen'
      else if (rol === 'preparador') redirect = '/dashboard/preparado'
      else if (rol === 'planchador') redirect = '/dashboard/planchado'
      else if (rol === 'tejedor') redirect = '/dashboard/produccion'

      router.push(redirect)
    } catch (err: any) {
      toast.error('Error de conexión: ' + err.message)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 p-4 relative overflow-hidden font-sans">
      <div className="absolute top-10 left-10 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md z-10">
        <div className="glass rounded-3xl p-8 border border-amber-500/20 shadow-2xl space-y-6 animate-fadeInUp">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/30 text-white">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-black text-2xl text-white tracking-tight">Cambio de Contraseña</h1>
              <p className="text-xs text-amber-400 font-medium">Requerido en primer ingreso</p>
            </div>
          </div>

          {/* Aviso */}
          <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Contraseña temporal activa</p>
              <p className="text-xs text-amber-400/80 mt-1">
                Hola <span className="font-bold text-white">{userName}</span>, por seguridad debes crear
                tu propia contraseña antes de continuar. No podrás saltarte este paso.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Nueva contraseña */}
            <div>
              <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Nueva Contraseña
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showNueva ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Mínimo 8 caracteres"
                  value={nuevaPassword}
                  onChange={e => setNuevaPassword(e.target.value)}
                  className="input-dark pl-10 pr-10 py-3.5 text-xs w-full font-semibold text-white border-white/10 focus:border-amber-500"
                />
                <button type="button" onClick={() => setShowNueva(!showNueva)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showNueva ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirmar contraseña */}
            <div>
              <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Confirmar Contraseña
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showConfirmar ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Repite la nueva contraseña"
                  value={confirmarPassword}
                  onChange={e => setConfirmarPassword(e.target.value)}
                  className={`input-dark pl-10 pr-10 py-3.5 text-xs w-full font-semibold text-white border-white/10 focus:border-amber-500 ${
                    confirmarPassword && confirmarPassword !== nuevaPassword ? 'border-red-500/60' : ''
                  }`}
                />
                <button type="button" onClick={() => setShowConfirmar(!showConfirmar)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  {showConfirmar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmarPassword && confirmarPassword !== nuevaPassword && (
                <p className="text-red-400 text-[10px] mt-1 font-medium">Las contraseñas no coinciden</p>
              )}
            </div>

            {/* Indicador de fortaleza */}
            {nuevaPassword.length > 0 && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[...Array(4)].map((_, i) => {
                    const strength = Math.min(Math.floor(nuevaPassword.length / 3), 4)
                    return (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-all ${
                        i < strength
                          ? strength <= 1 ? 'bg-red-500' : strength <= 2 ? 'bg-amber-500' : strength <= 3 ? 'bg-blue-500' : 'bg-emerald-500'
                          : 'bg-white/10'
                      }`} />
                    )
                  })}
                </div>
                <p className="text-[10px] text-slate-400">
                  {nuevaPassword.length < 8 ? 'Mínimo 8 caracteres' : nuevaPassword.length < 12 ? 'Aceptable — considera una más larga' : '✅ Contraseña fuerte'}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || nuevaPassword !== confirmarPassword || nuevaPassword.length < 8}
              className="btn-primary w-full justify-center py-3.5 text-xs bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 border-none font-bold uppercase tracking-wider text-white shadow-lg shadow-amber-600/30 rounded-2xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Guardando...' : '✅ Confirmar Nueva Contraseña'}
            </button>
          </form>

          <div className="pt-4 border-t border-white/[0.06] text-center">
            <span className="text-[10px] text-slate-500 font-mono">DUREY HOSIERY v3.5 · Seguridad de Acceso</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CambiarPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="text-white">Cargando...</div></div>}>
      <CambiarPasswordContent />
    </Suspense>
  )
}
