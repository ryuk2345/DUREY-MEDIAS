import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { verifySupabaseJWT, generateSupabaseJWT } from '@/lib/auth/jwt'
import { normalizarRol } from '@/lib/auth/roles'
import { COOKIE_TOKEN_DB, OPCIONES_COOKIE_TOKEN_DB, tokenAceptadoPorSupabase } from '@/lib/auth/tokenDb'

// Rutas accesibles por rol (en el dashboard)
const ROLE_ROUTES: Record<string, string[]> = {
  admin: [
    '/admin', '/usuarios', '/catalogo', '/maquinas', '/disenos', '/produccion', 
    '/remallado', '/planchado', '/preparado', '/almacen', '/ventas', '/clientes',
    '/despacho', '/mantenimiento', '/reportes', '/materia-prima',
    '/egresos', '/balance', '/calendario'
  ],
  supervisor: [
    '/usuarios', '/catalogo', '/maquinas', '/disenos', '/produccion', '/remallado', 
    '/planchado', '/preparado', '/almacen', '/ventas', '/clientes', '/despacho', 
    '/mantenimiento', '/reportes', '/materia-prima', '/calendario'
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
  volteador: ['/volteado'],
}


export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const isMock = !url || !anonKey || url.includes('tu-proyecto') || url.includes('placeholder') || !url.includes('.supabase.co')

  let user: any = null
  let role: string | null = null
  // JWT con el que el navegador debe consultar la base (ver lib/auth/tokenDb.ts)
  let tokenSesion: string | null = null

  const authToken = request.cookies.get('durey_auth_token')?.value
  const roleCookie = request.cookies.get('durey_user_role')?.value
  const loggedCookie = request.cookies.get('durey_user_logged')?.value

  if (isMock) {
    const mockSession = request.cookies.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        const parsed = JSON.parse(decodeURIComponent(mockSession))
        user = { id: parsed.id, email: parsed.email }
        role = parsed.rol || null
      } catch (e) {
        user = null
      }
    } else if (loggedCookie && roleCookie) {
      user = { id: 'mock-user', email: 'admin@durey.com' }
      role = roleCookie
    }
  } else if (authToken) {
    // 🚀 RUTA DE ALTA VELOCIDAD (0.1ms en memoria local con jose, 0 llamadas de red a Supabase)
    const decoded = await verifySupabaseJWT(authToken)
    if (decoded) {
      user = { id: decoded.sub, email: decoded.email }
      role = decoded.rol
      tokenSesion = authToken
    }
  }

  // 🔄 PERÍODO DE TRANSICIÓN TRANSPARENTE:
  // Si el usuario no tiene durey_auth_token pero tiene sesión activa previa,
  // verificamos una única vez con Supabase y auto-emitimos durey_auth_token para que
  // a partir del siguiente clic tome la vía rápida sin tener que cerrar sesión.
  if (!isMock && !user && loggedCookie) {
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
      if (data?.user) {
        const { data: perfil } = await supabase
          .from('usuarios')
          .select('id, nombre, rol, activo')
          .eq('auth_id', data.user.id)
          .single()

        if (perfil && perfil.activo) {
          user = { id: perfil.id || data.user.id, email: data.user.email }
          role = perfil.rol || null

          // Auto-emitir el JWT firmado para que todas las futuras navegaciones sean instantáneas
          const newToken = await generateSupabaseJWT({
            id: user.id,
            email: user.email || '',
            rol: role,
            nombre: perfil.nombre || 'Usuario'
          })

          const oneWeek = 60 * 60 * 24 * 7
          supabaseResponse.cookies.set('durey_auth_token', newToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: oneWeek
          })
          tokenSesion = newToken
        }
      }
    } catch (e) {
      // Si no se puede verificar la sesión, NO se confía en cookies editables por el cliente
      user = null
    }
  }

  const cleanRole = normalizarRol(role)
  const pathname = request.nextUrl.pathname

  // Sesión sin rol válido = sin sesión
  if (!cleanRole) user = null

  // Sincronizar la copia legible del JWT (cookie durey_db_token) con la sesión:
  // las sesiones abiertas antes de este cambio la reciben sin volver a iniciar sesión,
  // y si la sesión ya no es válida se borra para no mandar un token vencido.
  if (!isMock) {
    const tokenDbActual = request.cookies.get(COOKIE_TOKEN_DB)?.value
    if (user && tokenSesion && tokenDbActual !== tokenSesion) {
      if ((await tokenAceptadoPorSupabase(tokenSesion)) === true) {
        supabaseResponse.cookies.set(COOKIE_TOKEN_DB, tokenSesion, OPCIONES_COOKIE_TOKEN_DB)
      }
    } else if (!user && tokenDbActual) {
      supabaseResponse.cookies.set(COOKIE_TOKEN_DB, '', { path: '/', maxAge: 0 })
    }
  }

  // 1. Redirigir al login si no está autenticado y está en ruta protegida
  if (!user && pathname.startsWith('/dashboard')) {
    const redireccion = NextResponse.redirect(new URL('/login', request.url))
    if (request.cookies.get(COOKIE_TOKEN_DB)) redireccion.cookies.set(COOKIE_TOKEN_DB, '', { path: '/', maxAge: 0 })
    return redireccion
  }

  // 2. Redirigir al dashboard si ya está autenticado y entra al login
  if (user && (pathname === '/login' || pathname === '/')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // 3. Control de acceso estricto por rol en las subrutas del dashboard
  if (user && cleanRole !== 'admin' && pathname.startsWith('/dashboard') && pathname !== '/dashboard') {
    const allowedRoutes = ROLE_ROUTES[cleanRole!] || []

    const segments = pathname.split('/')
    const moduleName = '/' + segments[2]

    if (!allowedRoutes.includes(moduleName)) {
      const targetModule = allowedRoutes[0] ? `/dashboard${allowedRoutes[0]}` : '/login'
      return NextResponse.redirect(new URL(targetModule, request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}