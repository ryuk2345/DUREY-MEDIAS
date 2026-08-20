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
  tejedor: ['/produccion', '/mantenimiento'],
  remalladora: ['/remallado', '/mantenimiento'],
  planchador: ['/planchado'],
  preparador: ['/preparado'],
  almacenero: ['/almacen', '/despacho'],
  vendedora: ['/ventas'],
  tecnico: ['/mantenimiento'],
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

  const demoRole = request.cookies.get('durey_demo_role')?.value
  const hasDemo = !!demoRole

  let user = null
  if (!hasDemo) {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } else {
    user = { id: 'demo-uuid', email: `${demoRole}@durey.com` }
  }

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
  if (user && pathname.startsWith('/dashboard') && pathname !== '/dashboard') {
    const role = demoRole || 'vendedora'
    const allowedRoutes = ROLE_ROUTES[role] || []

    // Obtener la subruta (ejemplo: /dashboard/ventas/crear -> /ventas)
    const segments = pathname.split('/')
    const moduleName = '/' + segments[2]

    // Si la subruta solicitada no está permitida para el rol del usuario, denegar
    if (!allowedRoutes.includes(moduleName)) {
      // Redirigir a la raíz del dashboard para que le asigne su primer módulo permitido
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}