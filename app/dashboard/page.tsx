import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MODULOS_POR_ROL } from '@/lib/utils'
import { cookies } from 'next/headers'

export default async function DashboardPage() {
  const supabase = await createClient()
  
  const cookieStore = await cookies()
  const demoRole = cookieStore.get('durey_demo_role')?.value

  let user = null
  if (!demoRole) {
    const { data } = await supabase.auth.getUser()
    user = data.user
  }

  if (!user && !demoRole) redirect('/login')

  let rol = 'vendedora'

  if (demoRole) {
    rol = demoRole
  } else if (user) {
    const { data: perfil } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('auth_id', user.id)
      .single()
    rol = perfil?.rol ?? 'vendedora'
  }

  const modulos = MODULOS_POR_ROL[rol] ?? []
  const primerModulo = modulos[0]

  // Redirigir al primer módulo accesible
  if (primerModulo === 'admin') redirect('/dashboard/admin')
  redirect(`/dashboard/${primerModulo}`)
}
