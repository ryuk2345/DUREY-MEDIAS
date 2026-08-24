import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Mapeo de control de acceso por rol para el middleware (módulos autorizados)
const MODULOS_POR_ROL: Record<string, string[]> = {
  admin: [
    'admin', 'usuarios', 'catalogo', 'maquinas', 'produccion', 'remallado',
    'planchado', 'preparado', 'almacen', 'ventas', 'despacho', 'mantenimiento',
    'materia_prima', 'reportes'
  ],
  supervisor: [
    'usuarios', 'catalogo', 'maquinas', 'produccion', 'remallado',
    'planchado', 'preparado', 'almacen', 'despacho', 'materia_prima', 'reportes'
  ],
  operador: [
    'produccion', 'remallado', 'planchado', 'preparado', 'almacen', 'mantenimiento'
  ],
  vendedora: ['ventas'],
  tecnico: ['mantenimiento'],
  // Legacy
  tejedor: ['produccion', 'mantenimiento'],
  remalladora: ['remallado', 'mantenimiento'],
  volteador: ['volteado'],
  planchador: ['planchado'],
  preparador: ['preparado'],
  almacenero: ['almacen', 'despacho']
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Solo aplicar seguridad en sub-rutas de /dashboard
  if (pathname.startsWith('/dashboard/')) {
    const segments = pathname.split('/')
    const subRoute = segments[2] // ej: 'volteado', 'produccion', 'remallado'

    // Si es la raíz de /dashboard o sub-rutas internas que no sean secciones principales, permitir
    if (!subRoute || subRoute === 'api') {
      return NextResponse.next()
    }

    let rol = 'vendedora' // Rol por defecto restrictivo

    // 1. Obtener rol de la sesión mock
    const mockSession = request.cookies.get('durey_mock_session')?.value
    if (mockSession) {
      try {
        const parsed = JSON.parse(decodeURIComponent(mockSession))
        rol = parsed.rol || 'vendedora'
      } catch (e) {
        // Ignorar error de análisis
      }
    } else {
      // 2. Obtener rol de la cookie de producción
      const prodRole = request.cookies.get('durey_user_role')?.value
      if (prodRole) {
        rol = prodRole
      }
    }

    const modulosAutorizados = MODULOS_POR_ROL[rol] || []

    // Si el módulo al que intenta acceder no está autorizado para su rol, redirigir a /dashboard
    // que a su vez lo redirigirá a su primer módulo accesible real.
    if (!modulosAutorizados.includes(subRoute)) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return NextResponse.next()
}

// Configurar rutas que intercepta el middleware
export const config = {
  matcher: ['/dashboard/:path*']
}
