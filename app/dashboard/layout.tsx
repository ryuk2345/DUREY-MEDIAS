import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { cookies } from 'next/headers'
import StockNotification from '@/components/layout/StockNotification'
import EventNotificationBanner from '@/components/layout/EventNotificationBanner'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  let userName = 'Administrador'
  let userRol = 'admin'
  let isAuthenticated = false

  const roleCookie = cookieStore.get('durey_user_role')?.value
  const loggedCookie = cookieStore.get('durey_user_logged')?.value
  const nameCookie = cookieStore.get('durey_user_name')?.value

  if (isMock) {
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
  } else {
    try {
      const { data } = await supabase.auth.getUser()
      const user = data?.user

      if (user) {
        let { data: perfil } = await supabase
          .from('usuarios')
          .select('nombre, rol, activo')
          .eq('auth_id', user.id)
          .single()

        if (!perfil && user.email) {
          const { data: perfilEmail } = await supabase
            .from('usuarios')
            .select('nombre, rol, activo')
            .eq('email', user.email.toLowerCase())
            .single()
          perfil = perfilEmail
        }

        if (perfil && perfil.activo) {
          userName = perfil.nombre || nameCookie ? decodeURIComponent(nameCookie || '') : 'Usuario'
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
        <div className="fixed top-4 right-6 z-40 hidden md:block">
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
