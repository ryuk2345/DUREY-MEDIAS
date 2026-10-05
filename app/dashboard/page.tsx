import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MODULOS_POR_ROL } from '@/lib/utils'
import { cookies } from 'next/headers'
import { verifySupabaseJWT } from '@/lib/auth/jwt'
import { normalizarRol } from '@/lib/auth/roles'

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  // Rol solo desde fuentes verificadas (JWT firmado o perfil en la base). Antes se
  // aceptaba la cookie durey_user_role (editable) y un rol vacío se trataba como admin.
  let rol: string | null = null

  const authToken = cookieStore.get('durey_auth_token')?.value
  if (authToken) {
    const decoded = await verifySupabaseJWT(authToken)
    if (decoded) rol = decoded.rol
  }

  if (!rol && isMock) {
    const mockSession = cookieStore.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        rol = JSON.parse(decodeURIComponent(mockSession)).rol ?? null
      } catch {
        rol = null
      }
    }
  } else if (!rol) {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (data?.user) {
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('rol, activo')
        .eq('auth_id', data.user.id)
        .maybeSingle()
      if (perfil?.activo) rol = perfil.rol
    }
  }

  const cleanRole = normalizarRol(rol)
  if (!cleanRole) redirect('/login')

  const primerModulo = MODULOS_POR_ROL[cleanRole]?.[0]
  if (!primerModulo) redirect('/login')
  if (primerModulo === 'admin') redirect('/dashboard/admin')
  redirect(`/dashboard/${primerModulo}`)
}
