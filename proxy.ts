import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Rutas accesibles por rol (en el dashboard)
const ROLE_ROUTES: Record<string, string[]> = {
  admin: [
    '/admin', '/usuarios', '/catalogo', '/maquinas', '/produccion', 
    '/remallado', '/planchado', '/preparado', '/almacen', '/ventas', 
    '/despacho', '/mantenimiento', '/reportes',
    '/materia-prima'
  ],
  supervisor: [
    '/usuarios', '/catalogo', '/maquinas', '/produccion', '/remallado', 
    '/planchado', '/preparado', '/almacen', '/despacho', '/reportes',
    '/materia-prima'
  ],
  operador: [
    '/produccion', '/remallado', '/planchado', '/preparado', '/almacen', 
    '/mantenimiento'
  ],
  tejedor: ['/produccion', '/mantenimiento'],
  remalladora: ['/remallado', '/mantenimiento'],
  planchador: ['/planchado'],
  preparador: ['/preparado'],
  almacenero: ['/almacen', '/despacho'],
  vendedora: ['/ventas'],
  tecnico: ['/mantenimiento'],
}

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
  return r in ROLE_ROUTES ? r : 'admin'
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isMock = !url || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  let user = null
  let role = 'admin'

  if (isMock) {
    const mockSession = request.cookies.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        const parsed = JSON.parse(decodeURIComponent(mockSession))
        user = { id: parsed.id, email: parsed.email }
        role = parsed.rol || 'admin'
      } catch (e) {
        user = null
      }
    }
  } else {
    const { data } = await supabase.auth.getUser()
    user = data.user

    const roleCookie = request.cookies.get('durey_user_role')?.value
    const loggedCookie = request.cookies.get('durey_user_logged')?.value

    if (user) {
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('rol, activo')
        .eq('auth_id', user.id)
        .single()

      if (perfil && perfil.activo) {
        role = perfil.rol || roleCookie || 'admin'
      } else if (roleCookie) {
        role = roleCookie
      }
    } else if (loggedCookie && roleCookie) {
      user = { id: 'authenticated-user', email: 'active@durey.com' } as any
      role = roleCookie
    }
  }

  const cleanRole = normalizeRole(role)
  const pathname = request.nextUrl.pathname

  // 1. Redirigir al login si no está autenticado y está en ruta protegida
  if (!user && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 2. Redirigir al dashboard si ya está autenticado y entra al login
  if (user && (pathname === '/login' || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // 3. Control de acceso estricto por rol en las subrutas del dashboard (Admins tienen acceso total sin redirección)
  if (user && cleanRole !== 'admin' && pathname.startsWith('/dashboard') && pathname !== '/dashboard') {
    const allowedRoutes = ROLE_ROUTES[cleanRole] || ROLE_ROUTES['admin']

    const segments = pathname.split('/')
    const moduleName = '/' + segments[2]

    if (!allowedRoutes.includes(moduleName)) {
      const targetModule = allowedRoutes[0] ? `/dashboard${allowedRoutes[0]}` : '/dashboard/admin'
      return NextResponse.redirect(new URL(targetModule, request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}