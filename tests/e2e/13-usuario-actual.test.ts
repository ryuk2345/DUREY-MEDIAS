/**
 * Identidad del usuario en el navegador: una sola fuente (/api/auth/sesion, JWT firmado).
 * Antes cada pantalla usaba supabase.auth.getUser() (siempre null en este sistema) y
 * caía en valores inventados: autor '1' en el Calendario, rol 'admin' por defecto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { obtenerUsuarioActual, olvidarUsuarioActual } from '@/lib/auth/usuarioActual'
import { createMockClient } from '@/lib/supabase/mockDb'

const ADMIN = { id: '65a2de1b-03f2-4b95-82c2-cc2e3ffc30bb', email: 'admin@durey.com', nombre: 'Admin General', rol: 'admin' }

describe('obtenerUsuarioActual', () => {
  beforeEach(() => olvidarUsuarioActual())

  it('[NEGOCIO] devuelve el usuario de la sesión verificada', async () => {
    const servidor = vi.fn<typeof fetch>(async () => Response.json(ADMIN))
    expect(await obtenerUsuarioActual(servidor)).toEqual(ADMIN)
    expect(servidor.mock.calls[0][0]).toBe('/api/auth/sesion')
  })

  it('[NEGOCIO] sin sesión devuelve null (nunca un id ni un rol inventado)', async () => {
    const servidor = vi.fn<typeof fetch>(async () => Response.json({ error: 'No autenticado' }, { status: 401 }))
    expect(await obtenerUsuarioActual(servidor)).toBeNull()
  })

  it('error de red → null, y se vuelve a preguntar después', async () => {
    const caido = vi.fn<typeof fetch>(async () => { throw new Error('offline') })
    expect(await obtenerUsuarioActual(caido)).toBeNull()
    expect(await obtenerUsuarioActual(vi.fn<typeof fetch>(async () => Response.json(ADMIN)))).toEqual(ADMIN)
  })

  it('una sola consulta al servidor por página', async () => {
    const servidor = vi.fn<typeof fetch>(async () => Response.json(ADMIN))
    await Promise.all([obtenerUsuarioActual(servidor), obtenerUsuarioActual(servidor)])
    await obtenerUsuarioActual(servidor)
    expect(servidor).toHaveBeenCalledTimes(1)
  })

  it('al cerrar sesión se olvida (otro usuario en la misma pestaña)', async () => {
    await obtenerUsuarioActual(vi.fn<typeof fetch>(async () => Response.json(ADMIN)))
    olvidarUsuarioActual()
    const otro = { ...ADMIN, id: 'otro', rol: 'supervisor' }
    expect(await obtenerUsuarioActual(vi.fn<typeof fetch>(async () => Response.json(otro)))).toEqual(otro)
  })
})

describe('Base local: filtro or() como PostgREST', () => {
  it('eventos compartidos + los personales del usuario', async () => {
    const supabase = createMockClient()
    const { data: todos } = await supabase.from('eventos_calendario').select('*')
    const { data } = await supabase.from('eventos_calendario').select('*').or(`visibilidad.eq.compartido,creado_por.eq.${ADMIN.id}`)
    const esperado = (todos ?? []).filter((e: { visibilidad: string; creado_por: string }) => e.visibilidad === 'compartido' || e.creado_por === ADMIN.id)
    expect(data).toEqual(esperado)
  })
})
