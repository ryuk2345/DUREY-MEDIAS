import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MODULOS_POR_ROL } from '@/lib/utils'
import { cookies } from 'next/headers'

export default async function DashboardPage() {
  const supabase = await createClient()
  
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  let rol = 'vendedora'
  let isAuthenticated = false

  if (isMock) {
    const mockSession = cookieStore.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        const parsed = JSON.parse(decodeURIComponent(mockSession))
        rol = parsed.rol || 'vendedora'
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
        rol = perfil.rol || roleCookie || 'vendedora'
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

  const modulos = MODULOS_POR_ROL[rol] ?? []
  const primerModulo = modulos[0]

  // Redirigir al primer módulo accesible
  if (primerModulo === 'admin') redirect('/dashboard/admin')
  redirect(`/dashboard/${primerModulo}`)
}
