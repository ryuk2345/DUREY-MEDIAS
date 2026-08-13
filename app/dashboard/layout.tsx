import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { cookies } from 'next/headers'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  
  const cookieStore = await cookies()
  const demoRole = cookieStore.get('durey_demo_role')?.value
  const demoName = cookieStore.get('durey_demo_name')?.value

  let user = null
  if (!demoRole) {
    const { data } = await supabase.auth.getUser()
    user = data.user
  }

  if (!user && !demoRole) redirect('/login')

  let userName = 'Usuario'
  let userRol = 'vendedora'

  if (demoRole) {
    userName = demoName || 'Usuario Demo'
    userRol = demoRole
  } else if (user) {
    // Obtener el perfil del usuario con su rol
    const { data: perfil } = await supabase
      .from('usuarios')
      .select('nombre, rol')
      .eq('auth_id', user.id)
      .single()

    userName = perfil?.nombre ?? user.email ?? 'Usuario'
    userRol = perfil?.rol ?? 'vendedora'
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar userRol={userRol} userName={userName} />
      {/* 
        Mobile  (< md):  no sidebar → pt-16 for topbar, no left margin
        Tablet  (md–lg): icon rail (w-16) → ml-16
        Desktop (≥ lg):  full sidebar (w-60) → ml-60
      */}
      <main className="flex-1 min-h-screen overflow-x-hidden pt-16 md:pt-0 md:ml-16 lg:ml-60">
        <div className="p-4 sm:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
