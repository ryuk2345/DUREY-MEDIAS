import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { cookies } from 'next/headers'
import StockNotification from '@/components/layout/StockNotification'
import EventNotificationBanner from '@/components/layout/EventNotificationBanner'
import { verifySupabaseJWT } from '@/lib/auth/jwt'
import { normalizarRol } from '@/lib/auth/roles'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  // Nombre y rol solo desde fuentes verificadas (JWT firmado, sesión mock local o perfil
  // activo en la base). Antes se aceptaba la cookie durey_user_role, que el usuario
  // puede editar, y los valores por defecto eran "Administrador"/"admin".
  let userName = ''
  let rolSesion: string | null = null

  const authToken = cookieStore.get('durey_auth_token')?.value
  const nameCookie = cookieStore.get('durey_user_name')?.value

  if (authToken) {
    const decoded = await verifySupabaseJWT(authToken)
    if (decoded) {
      userName = decoded.nombre
      rolSesion = decoded.rol
    }
  }

  if (!rolSesion && isMock) {
    const mockSession = cookieStore.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        const parsed = JSON.parse(decodeURIComponent(mockSession))
        userName = parsed.nombre || 'Usuario'
        rolSesion = parsed.rol ?? null
      } catch {
        rolSesion = null
      }
    }
  } else if (!rolSesion) {
    try {
      const supabase = await createClient()
      const { data } = await supabase.auth.getUser()
      const user = data?.user
      if (user) {
        const { data: perfil } = await supabase
          .from('usuarios')
          .select('nombre, rol, activo')
          .or(`auth_id.eq.${user.id}${user.email ? `,email.eq.${user.email.toLowerCase()}` : ''}`)
          .limit(1)
          .maybeSingle()
        if (perfil?.activo) {
          userName = perfil.nombre || (nameCookie ? decodeURIComponent(nameCookie) : 'Usuario')
          rolSesion = perfil.rol
        }
      }
    } catch {
      rolSesion = null
    }
  }

  const userRol = normalizarRol(rolSesion)
  if (!userRol) redirect('/login')

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
