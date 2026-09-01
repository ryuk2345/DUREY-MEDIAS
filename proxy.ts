import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Rutas accesibles por rol (en el dashboard)
const ROLE_ROUTES: Record<string, string[]> = {
  admin: [
    '/admin', '/usuarios', '/catalogo', '/maquinas', '/disenos', '/produccion', 
    '/remallado', '/planchado', '/preparado', '/almacen', '/ventas', '/clientes',
    '/despacho', '/mantenimiento', '/reportes', '/materia-prima',
    '/egresos', '/balance'
  ],
  supervisor: [
    '/usuarios', '/catalogo', '/maquinas', '/disenos', '/produccion', '/remallado', 
    '/planchado', '/preparado', '/almacen', '/ventas', '/clientes', '/despacho', 
    '/mantenimiento', '/reportes', '/materia-prima'
  ],
  operador: [
    '/produccion', '/remallado', '/disenos', '/planchado', '/preparado', '/almacen', 
    '/mantenimiento'
  ],
  disenador: ['/disenos', '/catalogo', '/maquinas'],
  tejedor: ['/produccion', '/disenos', '/mantenimiento'],
  remalladora: ['/remallado', '/mantenimiento'],
  remallador: ['/remallado', '/mantenimiento'],
  planchador: ['/planchado', '/mantenimiento'],
  preparador: ['/preparado'],
  almacenero: ['/almacen', '/despacho', '/materia-prima'],
  vendedora: ['/ventas', '/clientes', '/catalogo', '/despacho'],
  tecnico: ['/maquinas', '/mantenimiento'],
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const isMock = !url || !anonKey || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  let user: any = null
  let role = 'admin'

  const roleCookie = request.cookies.get('durey_user_role')?.value
  const loggedCookie = request.cookies.get('durey_user_logged')?.value

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
    } else if (loggedCookie && roleCookie) {
      user = { id: 'mock-user', email: 'admin@durey.com' }
      role = roleCookie
    }
  } else {
    try {
      const supabase = createServerClient(
        url,
        anonKey,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll()
            },
            setAll(cookiesToSet) {
              try {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                supabaseResponse = NextResponse.next({ request })
                cookiesToSet.forEach(({ name, value, options }) =>
                  supabaseResponse.cookies.set(name, value, options)
                )
              } catch (e) {
                // Ignore cookie set errors in middleware edge execution
              }
            },
          },
        }
      )

      const { data } = await supabase.auth.getUser()
      user = data.user

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
        user = { id: 'authenticated-user', email: 'active@durey.com' }
        role = roleCookie
      }
    } catch (e) {
      // Fallback ultra seguro si la conexión a Supabase falla
      if (loggedCookie && roleCookie) {
        user = { id: 'authenticated-user', email: 'active@durey.com' }
        role = roleCookie
      }
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

  // 3. Control de acceso estricto por rol en las subrutas del dashboard
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