import { NextResponse, type NextRequest } from 'next/server'
import { requerirSesion } from '@/lib/auth/session'
import { MODULOS_POR_ROL } from '@/lib/utils'
import { tipoDocumento, urlDecolecta, normalizarDecolecta } from '@/lib/domain/documento'

/**
 * GET /api/documento?numero=<DNI o RUC>
 * Busca el nombre (y la dirección, si es RUC) en Decolecta (RENIEC/SUNAT).
 * Solo con sesión y rol con el módulo ventas o clientes, para que nadie gaste el saldo
 * desde fuera. El token vive en la variable de servidor DECOLECTA_TOKEN, nunca en el código
 * ni en el navegador. Sin token responde 503 { configurado: false }.
 */
const puedeBuscar = (rol: string) => ['ventas', 'clientes'].some(m => MODULOS_POR_ROL[rol]?.includes(m))

export async function GET(req: NextRequest) {
  const auth = await requerirSesion(req, puedeBuscar)
  if ('respuesta' in auth) return auth.respuesta

  const numero = (new URL(req.url).searchParams.get('numero') ?? '').trim()
  const tipo = tipoDocumento(numero)
  if (!tipo) return NextResponse.json({ error: 'Ingresa un DNI de 8 dígitos o un RUC de 11 dígitos' }, { status: 400 })

  const token = process.env.DECOLECTA_TOKEN?.trim()
  if (!token) return NextResponse.json({ configurado: false, error: 'La búsqueda por DNI/RUC no está configurada' }, { status: 503 })

  let resp: Response
  try {
    resp = await fetch(urlDecolecta(tipo, numero), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return NextResponse.json({ error: 'No se pudo consultar RENIEC/SUNAT. Escribe los datos a mano.' }, { status: 502 })
  }
  if (resp.status === 401 || resp.status === 403) {
    return NextResponse.json({ error: 'El token de Decolecta no es válido o se acabó el saldo' }, { status: 502 })
  }
  if (!resp.ok) return NextResponse.json({ error: `No se encontró el ${tipo.toUpperCase()} ${numero}` }, { status: 404 })

  const datos = normalizarDecolecta(tipo, numero, await resp.json().catch(() => null))
  if (!datos) return NextResponse.json({ error: `No se encontró el ${tipo.toUpperCase()} ${numero}` }, { status: 404 })
  return NextResponse.json(datos)
}
