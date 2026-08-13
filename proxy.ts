import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Rutas accesibles por rol
const ROLE_ROUTES: Record<string, string[]> = {
  admin: ['/admin', '/produccion', '/remallado', '/planchado', '/preparado', '/almacen', '/ventas', '/despacho', '/mantenimiento', '/catalogo', '/reportes'],
  supervisor: ['/produccion', '/remallado', '/planchado', '/preparado', '/almacen', '/despacho', '/catalogo', '/reportes'],
  tejedor: ['/produccion'],
  remalladora: ['/remallado'],
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

  // Redirigir al login si no está autenticado y está en ruta protegida
  if (!user && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirigir al dashboard si ya está autenticado y entra al login
  if (user && (pathname === '/login' || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}