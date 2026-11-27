/** Carga lo necesario para la orden de despacho de una venta y la imprime (Ventas y Despacho usan lo mismo). */
import { armarOrdenDespacho, type SacoEnSalon } from '@/lib/domain/despacho'
import { htmlOrdenDespacho, imprimirHtml } from './ventas'
import { todasLasFilas } from '@/lib/supabase/paginar'
import { hoyLocal } from '@/lib/domain/mantenimiento'

type Cliente = { nombre?: string | null; numero_documento?: string | null; direccion?: string | null } | null
type Item = { catalogo_media_id: string; docenas: number; catalogo_media: { codigo: string; sku: string | null } | null }
type Saco = { codigo_paquete: string; catalogo_media_id: string | null; docenas: number; ubicacion: { nombre: string } | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function htmlDeOrdenDespacho(supabase: any, venta: { id: string; codigo_venta: string; cliente?: Cliente; asesora?: { nombre?: string | null } | null }): Promise<{ html?: string; error?: string }> {
  const it = await supabase.from('items_venta').select('catalogo_media_id, docenas, catalogo_media:catalogo_medias(codigo, sku)').eq('venta_id', venta.id)
  if (it.error) return { error: it.error.message }
  const items = (it.data ?? []) as Item[]
  if (!items.length) return { error: 'La venta no tiene productos' }
  const skus = [...new Set(items.map(i => i.catalogo_media_id))]
  const sc = await todasLasFilas((d, h) => supabase.from('paquetes').select('codigo_paquete, catalogo_media_id, docenas, ubicacion:ubicaciones(nombre)')
    .eq('estado', 'almacenado').in('catalogo_media_id', skus).order('codigo_paquete').order('id').range(d, h))
  if (sc.error) return { error: sc.error.message }
  const sacos: SacoEnSalon[] = (sc.data as Saco[]).filter(s => s.ubicacion)
    .map(s => ({ codigo_paquete: s.codigo_paquete, catalogo_media_id: s.catalogo_media_id, docenas: Number(s.docenas), salon: s.ubicacion!.nombre }))
  const media = (id: string) => items.find(i => i.catalogo_media_id === id)?.catalogo_media
  const lineas = armarOrdenDespacho(items.map(i => ({ catalogo_media_id: i.catalogo_media_id, docenas: Number(i.docenas) })), sacos)
    .map(l => ({ ...l, codigo: media(l.catalogo_media_id)?.codigo ?? '—', sku: media(l.catalogo_media_id)?.sku }))
  return {
    html: htmlOrdenDespacho({
      codigoVenta: venta.codigo_venta, cliente: venta.cliente?.nombre ?? '—', documento: venta.cliente?.numero_documento ?? '—',
      direccion: venta.cliente?.direccion, vendedora: venta.asesora?.nombre, fecha: hoyLocal(), lineas,
    }),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function imprimirOrdenDespacho(supabase: any, venta: Parameters<typeof htmlDeOrdenDespacho>[1]): Promise<string | null> {
  const r = await htmlDeOrdenDespacho(supabase, venta)
  if (r.error || !r.html) return r.error ?? 'No se pudo armar la orden'
  return imprimirHtml(r.html) ? null : 'El navegador bloqueó la ventana de impresión'
}
