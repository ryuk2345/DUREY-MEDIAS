import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MODULOS_POR_ROL } from '@/lib/utils'
import { cookies } from 'next/headers'

function normalizeRole(rawRole: string | undefined | null): string {
  if (!rawRole) return 'admin'
  const r = rawRole.toLowerCase().trim()
  if (r.includes('admin')) return 'admin'
  if (r.includes('super')) return 'supervisor'
  if (r.includes('oper')) return 'operador'
  if (r.includes('vend')) return 'vendedora'
  if (r.includes('tecn') || r.includes('técn')) return 'tecnico'
  if (r.includes('tej')) return 'tejedor'
  if (r.includes('remal')) return 'remalladora'
  if (r.includes('planc')) return 'planchador'
  if (r.includes('prep')) return 'preparador'
  if (r.includes('almac')) return 'almacenero'
  return r in MODULOS_POR_ROL ? r : 'admin'
}

export default async function DashboardPage() {
  const supabase = await createClient()
  
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  let rol = 'admin'
  let isAuthenticated = false

  if (isMock) {
    const mockSession = cookieStore.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        const parsed = JSON.parse(decodeURIComponent(mockSession))
        rol = parsed.rol || 'admin'
        isAuthenticated = true
      } catch (e) {
        isAuthenticated = false
      }
    }
  } else {
    const { data } = await supabase.auth.getUser()
    const user = data.user

    const roleCookie = cookieStore.get('durey_user_role')?.value
    const loggedCookie = cookieStore.get('durey_user_logged')?.value

    if (user) {
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('rol, activo')
        .eq('auth_id', user.id)
        .single()

      if (perfil && perfil.activo) {
        rol = perfil.rol || roleCookie || 'admin'
        isAuthenticated = true
      } else if (roleCookie) {
        rol = roleCookie
        isAuthenticated = true
      }
    } else if (loggedCookie && roleCookie) {
      rol = roleCookie
      isAuthenticated = true
    }
  }

  if (!isAuthenticated) redirect('/login')

  const cleanRole = normalizeRole(rol)
  const modulos = MODULOS_POR_ROL[cleanRole] ?? ['admin']
  const primerModulo = modulos[0] || 'admin'

  if (primerModulo === 'admin') redirect('/dashboard/admin')
  redirect(`/dashboard/${primerModulo}`)
}
