import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { cookies } from 'next/headers'
import StockNotification from '@/components/layout/StockNotification'
import EventNotificationBanner from '@/components/layout/EventNotificationBanner'
import { verifySupabaseJWT } from '@/lib/auth/jwt'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  let userName = 'Administrador'
  let userRol = 'admin'
  let isAuthenticated = false

  const authToken = cookieStore.get('durey_auth_token')?.value
  const roleCookie = cookieStore.get('durey_user_role')?.value
  const loggedCookie = cookieStore.get('durey_user_logged')?.value
  const nameCookie = cookieStore.get('durey_user_name')?.value

  // 🚀 FAST-PATH: Verificar JWT en 0.1ms sin llamadas de red
  if (authToken) {
    const decoded = await verifySupabaseJWT(authToken)
    if (decoded) {
      userName = decoded.nombre || (nameCookie ? decodeURIComponent(nameCookie) : 'Usuario')
      userRol = decoded.rol
      isAuthenticated = true
    }
  }

  if (!isAuthenticated && isMock) {
    const mockSession = cookieStore.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        const parsed = JSON.parse(decodeURIComponent(mockSession))
        userName = parsed.nombre || 'Usuario'
        userRol = parsed.rol || 'admin'
        isAuthenticated = true
      } catch (e) {
        isAuthenticated = false
      }
    } else if (loggedCookie && roleCookie) {
      userName = nameCookie ? decodeURIComponent(nameCookie) : 'Administrador'
      userRol = roleCookie
      isAuthenticated = true
    }
  } else if (!isAuthenticated) {
    try {
      const supabase = await createClient()
      const { data } = await supabase.auth.getUser()
      const user = data?.user

      if (user) {
        let { data: perfil } = await supabase
          .from('usuarios')
          .select('nombre, rol, activo')
          .or(`auth_id.eq.${user.id}${user.email ? `,email.eq.${user.email.toLowerCase()}` : ''}`)
          .limit(1)
          .maybeSingle()

        if (perfil && perfil.activo) {
          userName = perfil.nombre || (nameCookie ? decodeURIComponent(nameCookie) : 'Usuario')
          userRol = perfil.rol || roleCookie || 'admin'
          isAuthenticated = true
        } else if (roleCookie) {
          userName = nameCookie ? decodeURIComponent(nameCookie) : 'Usuario'
          userRol = roleCookie
          isAuthenticated = true
        }
      } else if (loggedCookie && roleCookie) {
        userName = nameCookie ? decodeURIComponent(nameCookie) : 'Administrador'
        userRol = roleCookie
        isAuthenticated = true
      }
    } catch (e) {
      if (loggedCookie && roleCookie) {
        userName = nameCookie ? decodeURIComponent(nameCookie) : 'Administrador'
        userRol = roleCookie
        isAuthenticated = true
      }
    }
  }

  if (!isAuthenticated) redirect('/login')

  return (
    <div className="flex min-h-screen">
      <Sidebar userRol={userRol} userName={userName} />
      {/* 
        Mobile  (< md):  no sidebar → pt-16 for topbar, no left margin
        Tablet  (md–lg): icon rail (w-16) → ml-16
        Desktop (≥ lg):  full sidebar (w-60) → ml-60
      */}
      <main className="flex-1 min-h-screen overflow-x-hidden pt-16 md:pt-0 md:ml-16 lg:ml-60 relative">
        {/* Floating Stock Notification for Desktop */}
        <div className="fixed top-4 right-6 z-40 hidden lg:block">
          <StockNotification userRol={userRol} />
        </div>

        {/* Modal Alert for Calendar Events (Today & Next 3 Days) */}
        <EventNotificationBanner userRol={userRol} />
        
        <div className="p-4 sm:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
