/**
 * Fase 6B — orden de despacho imprimible, cronograma con detalle de productos y búsqueda
 * de cliente por DNI/RUC (Decolecta, solo desde el servidor).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { tipoDocumento, urlDecolecta, normalizarDecolecta } from '@/lib/domain/documento'
import { armarOrdenDespacho } from '@/lib/domain/despacho'
import { htmlOrdenDespacho, htmlCronogramaPagos, htmlCarteraCobranza, tablaProductos } from '@/lib/impresion/ventas'

vi.mock('@/lib/auth/jwt', () => ({ verifySupabaseJWT: vi.fn() }))
import { verifySupabaseJWT } from '@/lib/auth/jwt'
import { GET } from '@/app/api/documento/route'

const MALO = '<img src=x onerror=alert(1)>'

describe('DNI y RUC', () => {
  it('reconoce DNI de 8 dígitos y RUC de 11 que empiezan como RUC', () => {
    expect(['46027897', ' 46027897 ', '20601030013', '10460278975', '4602789', '460278971', '30601030013', '2060103001A', ''].map(tipoDocumento))
      .toEqual(['dni', 'dni', 'ruc', 'ruc', null, null, null, null, null])
  })
  it('arma la ruta de Decolecta de cada tipo', () => {
    expect(urlDecolecta('dni', '46027897')).toBe('https://api.decolecta.com/v1/reniec/dni?numero=46027897')
    expect(urlDecolecta('ruc', '20601030013')).toBe('https://api.decolecta.com/v1/sunat/ruc?numero=20601030013')
  })
  it('lee la respuesta de RENIEC (ejemplo de la documentación)', () => {
    expect(normalizarDecolecta('dni', '46027897', { first_name: 'ROXANA KARINA', first_last_name: 'DELGADO', second_last_name: 'HUAMANI', full_name: 'DELGADO HUAMANI ROXANA KARINA', document_number: '46027897' }))
      .toEqual({ tipo_documento: 'dni', numero_documento: '46027897', nombre: 'DELGADO HUAMANI ROXANA KARINA', direccion: '' })
    expect(normalizarDecolecta('dni', '46027897', { first_name: 'ANA', first_last_name: 'RUIZ', second_last_name: '' })?.nombre).toBe('ANA RUIZ')
    expect(normalizarDecolecta('dni', '46027897', { error: 'Invalid request' })).toBeNull()
  })
  it('lee la respuesta de SUNAT con dirección y lugar', () => {
    expect(normalizarDecolecta('ruc', '20601030013', { razon_social: 'REXTIE S.A.C.', numero_documento: '20601030013', estado: 'ACTIVO',
      direccion: 'AV. JOSE GALVEZ BARRENECHEA NRO 566 INT. 101 URB. CORPAC ', distrito: 'SAN ISIDRO', provincia: 'LIMA', departamento: 'LIMA' }))
      .toEqual({ tipo_documento: 'ruc', numero_documento: '20601030013', nombre: 'REXTIE S.A.C.',
        direccion: 'AV. JOSE GALVEZ BARRENECHEA NRO 566 INT. 101 URB. CORPAC, SAN ISIDRO - LIMA - LIMA' })
    expect(normalizarDecolecta('ruc', '20601030013', { message: 'ruc no valido' })).toBeNull()
    expect(normalizarDecolecta('ruc', '20601030013', null)).toBeNull()
  })
})

describe('orden de despacho', () => {
  const sacos = [
    { codigo_paquete: 'S-2', catalogo_media_id: 'A', docenas: 6, salon: 'Salón B' },
    { codigo_paquete: 'S-1', catalogo_media_id: 'A', docenas: 6, salon: 'Salón A' },
    { codigo_paquete: 'S-3', catalogo_media_id: 'C', docenas: 6, salon: 'Salón A' },
  ]
  it('por SKU pedido lista todos sus sacos con salón, lo disponible y lo que falta', () => {
    const orden = armarOrdenDespacho([{ catalogo_media_id: 'A', docenas: 4 }, { catalogo_media_id: 'A', docenas: 6 }, { catalogo_media_id: 'B', docenas: 3 }], sacos)
    expect(orden).toEqual([
      { catalogo_media_id: 'A', pedidas: 10, disponibles: 12, falta: 0, sacos: [sacos[1], sacos[0]] },
      { catalogo_media_id: 'B', pedidas: 3, disponibles: 0, falta: 3, sacos: [] },
    ])
  })
  it('la página impresa lleva salón, saco y docenas, avisa lo que falta y protege los textos', () => {
    const lineas = armarOrdenDespacho([{ catalogo_media_id: 'A', docenas: 10 }, { catalogo_media_id: 'B', docenas: 3 }], sacos)
      .map(l => ({ ...l, codigo: l.catalogo_media_id === 'A' ? 'T-A' : MALO, sku: null }))
    const html = htmlOrdenDespacho({ codigoVenta: 'V-1001', cliente: MALO, documento: '20601030013', direccion: MALO, vendedora: MALO, fecha: '2026-11-27', lineas })
    expect(html).toContain('ORDEN DE DESPACHO')
    expect(html).toMatch(/Salón A<\/td><td[^>]*>S-1<\/td><td[^>]*>6<\/td>/)
    expect(html).toContain('Faltan 3 docenas')
    expect(html).toContain('No hay sacos de este producto')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('cronograma y cartera', () => {
  const productos = [{ codigo: 'T-A', sku: 'SKU-A', docenas: 2, precio_docena: 40 }, { codigo: 'T-B', sku: null, docenas: 1.5, precio_docena: 30 }]
  it('el cronograma lleva el detalle de productos con subtotales, además de las cuotas', () => {
    const html = htmlCronogramaPagos({ codigoVenta: 'V-1', cliente: 'Ana', documento: '46027897', vendedora: 'Vende', adelanto: 20, total: 125,
      cuotas: [{ numero_cuota: 1, fecha_vencimiento: '2026-12-10', monto: 105 }], productos, fechaEmision: '27/11/2026' })
    expect(html).toContain('Productos')
    expect(html).toMatch(/SKU-A<\/td><td[^>]*>2<\/td>\s*<td[^>]*>S\/ 40\.00<\/td><td[^>]*>S\/ 80\.00<\/td>/)
    expect(html).toMatch(/T-B<\/td><td[^>]*>1\.5<\/td>\s*<td[^>]*>S\/ 30\.00<\/td><td[^>]*>S\/ 45\.00<\/td>/)
    expect(html).toContain('Cuota N° 1')
    expect(tablaProductos([])).toBe('')
  })
  it('cronograma y cartera protegen nombres de cliente y vendedora', () => {
    const c = htmlCronogramaPagos({ codigoVenta: MALO, cliente: MALO, documento: MALO, telefono: MALO, vendedora: MALO, adelanto: 0, total: 1, cuotas: [], productos: [{ codigo: MALO, docenas: 1, precio_docena: 1 }], fechaEmision: 'x' })
    const k = htmlCarteraCobranza({ vendedora: MALO, total: 1, cuotas: [{ codigo_venta: MALO, cliente: MALO, telefono: MALO, numero_cuota: 1, fecha_vencimiento: '2026-12-01', monto: 1 }] })
    for (const html of [c, k]) { expect(html).not.toContain('<img'); expect(html).toContain('&lt;img') }
  })
})

describe('GET /api/documento', () => {
  const pedir = (numero: string, conCookie = true) => {
    const req = new NextRequest(`http://localhost/api/documento?numero=${numero}`)
    if (conCookie) req.cookies.set('durey_auth_token', 't')
    return GET(req)
  }
  const sesion = (rol: string | null) => vi.mocked(verifySupabaseJWT).mockResolvedValue(rol ? ({ sub: 'u1', rol } as never) : null)
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('DECOLECTA_TOKEN', 'tok-123') })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('sin sesión o sin el módulo ventas/clientes rechaza sin llamar a Decolecta', async () => {
    sesion(null)
    expect((await pedir('46027897', false)).status).toBe(401)
    expect((await pedir('46027897')).status).toBe(401)
    sesion('tejedor')
    expect((await pedir('46027897')).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('documento inválido: 400 sin llamar', async () => {
    sesion('vendedora')
    const r = await pedir('12345')
    expect(r.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sin token: 503 «no configurada» sin llamar', async () => {
    sesion('vendedora'); vi.stubEnv('DECOLECTA_TOKEN', '')
    const r = await pedir('46027897')
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ configurado: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('con token consulta SUNAT con Bearer y devuelve solo los datos de la venta', async () => {
    sesion('admin')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ razon_social: 'REXTIE S.A.C.', numero_documento: '20601030013', direccion: 'AV. X 1', distrito: 'SAN ISIDRO', es_agente_retencion: false }), { status: 200 }))
    const r = await pedir('20601030013')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ tipo_documento: 'ruc', numero_documento: '20601030013', nombre: 'REXTIE S.A.C.', direccion: 'AV. X 1, SAN ISIDRO' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.decolecta.com/v1/sunat/ruc?numero=20601030013')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
  })
  it('errores de Decolecta: token rechazado 502, no encontrado 404, caída 502', async () => {
    sesion('vendedora')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    expect((await pedir('46027897')).status).toBe(502)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'ruc no valido' }), { status: 422 }))
    expect((await pedir('20601030013')).status).toBe(404)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'x' }), { status: 200 }))
    expect((await pedir('46027897')).status).toBe(404)
    fetchMock.mockRejectedValueOnce(new Error('red'))
    expect((await pedir('46027897')).status).toBe(502)
  })
})
