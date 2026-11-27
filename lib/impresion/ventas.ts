/**
 * Páginas imprimibles de Ventas y Despacho (Fase 6B). Todo dato que viene de la base o del
 * usuario pasa por escaparHtml: un nombre con código no se ejecuta al imprimir.
 */
import { escaparHtml as e } from '@/lib/utils'
import type { LineaOrden } from '@/lib/domain/despacho'

export type ProductoVendido = { codigo: string; sku?: string | null; docenas: number; precio_docena: number }
export type CuotaImpresa = { numero_cuota: number; fecha_vencimiento: string; monto: number }

const soles = (n: number) => `S/ ${Number(n).toFixed(2)}`
const td = 'border:1px solid #cbd5e1;padding:6px;font-size:11px'

/** Tabla de productos de una venta (SKU, docenas, precio por docena, subtotal). */
export function tablaProductos(productos: ProductoVendido[]): string {
  if (!productos.length) return ''
  const filas = productos.map(p => `<tr><td style="${td};font-family:monospace">${e(p.sku || p.codigo)}</td><td style="${td};text-align:right">${e(Number(p.docenas))}</td>
    <td style="${td};text-align:right">${soles(p.precio_docena)}</td><td style="${td};text-align:right;font-weight:bold">${soles(Number(p.docenas) * Number(p.precio_docena))}</td></tr>`).join('')
  return `<table data-tabla="productos"><thead><tr><th>Producto</th><th style="text-align:right">Docenas</th><th style="text-align:right">Precio x doc.</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${filas}</tbody></table>`
}

export function htmlCronogramaPagos(d: {
  codigoVenta: string; cliente: string; documento: string; telefono?: string | null; vendedora: string
  adelanto: number; total: number; cuotas: CuotaImpresa[]; productos: ProductoVendido[]; fechaEmision: string
}): string {
  const filas = d.cuotas.map(c => `<tr><td style="${td};text-align:center;font-weight:bold">Cuota N° ${e(c.numero_cuota)}</td>
    <td style="${td};text-align:center">${e(c.fecha_vencimiento)}</td><td style="${td};text-align:right;font-weight:bold;color:#059669">${soles(c.monto)}</td></tr>`).join('')
  return `<html><head><title>Cronograma de Pagos — Venta ${e(d.codigoVenta)}</title><style>
    body{font-family:'Segoe UI',Arial,sans-serif;padding:25px;color:#0f172a;max-width:520px;margin:0 auto}
    .ticket{border:2px solid #0f172a;border-radius:16px;padding:20px}h2{margin:0;font-size:18px;color:#db2777;text-align:center}
    h3{font-size:12px;margin:14px 0 0}p{margin:4px 0;font-size:12px;color:#475569}table{width:100%;border-collapse:collapse;margin-top:8px}
    th{background:#f1f5f9;border:1px solid #cbd5e1;padding:6px;font-size:10px;text-transform:uppercase}
    .firmas{margin-top:35px;display:flex;justify-content:space-between;font-size:11px;color:#64748b}.firma{border-top:1px solid #94a3b8;width:45%;text-align:center;padding-top:4px}
  </style></head><body><div class="ticket">
    <h2>FÁBRICA DE MEDIAS DUREY</h2><div style="text-align:center;font-size:12px;font-weight:bold;margin-bottom:12px">COMPROMISO Y CRONOGRAMA DE PAGOS</div>
    <p>Venta N°: <strong>${e(d.codigoVenta)}</strong> · Vendedora: <strong>${e(d.vendedora)}</strong></p>
    <p>Cliente: <strong>${e(d.cliente)}</strong></p>
    <p>DNI/RUC: <strong>${e(d.documento)}</strong> · Teléfono: <strong>${e(d.telefono || '—')}</strong></p>
    <p>Fecha de emisión: <strong>${e(d.fechaEmision)}</strong></p>
    <h3>Productos</h3>${tablaProductos(d.productos)}
    <div style="margin-top:10px;background:#f0fdf4;border:1px solid #bbf7d0;padding:8px;border-radius:8px;font-size:12px;font-weight:bold;color:#15803d">
      TOTAL VENTA: ${soles(d.total)} | ADELANTO PAGADO: ${soles(d.adelanto)}</div>
    <h3>Cuotas</h3><table><thead><tr><th>N° Cuota</th><th>Vencimiento</th><th style="text-align:right">Monto</th></tr></thead><tbody>${filas}</tbody></table>
    <div class="firmas"><div class="firma">Firma Cliente / DNI</div><div class="firma">Firma Vendedora (${e(d.vendedora)})</div></div>
  </div></body></html>`
}

export function htmlCarteraCobranza(d: {
  vendedora: string; total: number
  cuotas: { codigo_venta?: string; cliente?: string; telefono?: string | null; numero_cuota: number; fecha_vencimiento: string; monto: number }[]
}): string {
  const filas = d.cuotas.map(c => `<tr><td style="${td};font-family:monospace">${e(c.codigo_venta)}</td><td style="${td};font-weight:bold">${e(c.cliente)}</td>
    <td style="${td};font-family:monospace">${e(c.telefono || '—')}</td><td style="${td};text-align:center">Cuota ${e(c.numero_cuota)}</td>
    <td style="${td};text-align:center;font-weight:bold;color:#b91c1c">${e(c.fecha_vencimiento)}</td><td style="${td};text-align:right;font-weight:bold;color:#047857">${soles(c.monto)}</td></tr>`).join('')
  return `<html><head><title>Cartera de Cobranza — ${e(d.vendedora)}</title><style>
    body{font-family:'Segoe UI',Arial,sans-serif;padding:25px;color:#0f172a}h2{margin:0;font-size:18px;color:#be185d}p{margin:4px 0 15px;color:#64748b;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#fce7f3;color:#9d174d;border:1px solid #fbcfe8;padding:8px;font-size:11px;text-transform:uppercase}
  </style></head><body><h2>FÁBRICA DE MEDIAS DUREY — CARTERA DE COBRANZA DE VENTAS</h2>
    <p>Asesora / Vendedora: <strong>${e(d.vendedora)}</strong> · Total pendiente de cobro: <strong>${soles(d.total)}</strong> (${d.cuotas.length} cuotas)</p>
    <table><thead><tr><th>Venta</th><th>Cliente / Razón social</th><th>Teléfono</th><th>Cuota</th><th>Vencimiento</th><th style="text-align:right">Monto pendiente</th></tr></thead><tbody>${filas}</tbody></table>
  </body></html>`
}

/** Orden de despacho (decisiones Q4-A y 6B-1-B): por SKU, lo pedido y los sacos disponibles con su salón. */
export function htmlOrdenDespacho(d: {
  codigoVenta: string; cliente: string; documento: string; direccion?: string | null; vendedora?: string | null; fecha: string
  lineas: (LineaOrden & { codigo: string; sku?: string | null })[]
}): string {
  const bloques = d.lineas.map(l => {
    const sacos = l.sacos.length
      ? l.sacos.map(s => `<tr><td style="${td}">${e(s.salon)}</td><td style="${td};font-family:monospace">${e(s.codigo_paquete)}</td><td style="${td};text-align:right">${e(Number(s.docenas))}</td><td style="${td};width:60px"></td></tr>`).join('')
      : `<tr><td colspan="4" style="${td};color:#b91c1c">No hay sacos de este producto en los salones</td></tr>`
    const aviso = l.falta > 0 ? `<p style="color:#b91c1c;font-weight:bold">Faltan ${e(l.falta)} docenas en almacén para este producto</p>` : ''
    return `<h3>${e(l.sku || l.codigo)} · pedido: ${e(l.pedidas)} doc. · disponible: ${e(l.disponibles)} doc.</h3>${aviso}
      <table><thead><tr><th>Salón</th><th>Saco</th><th style="text-align:right">Docenas</th><th>Elegido</th></tr></thead><tbody>${sacos}</tbody></table>`
  }).join('')
  return `<html><head><title>Orden de Despacho — ${e(d.codigoVenta)}</title><style>
    body{font-family:'Segoe UI',Arial,sans-serif;padding:25px;color:#0f172a}h2{margin:0;font-size:18px;color:#1d4ed8}h3{font-size:13px;margin:18px 0 4px}
    p{margin:4px 0;font-size:12px;color:#475569}table{width:100%;border-collapse:collapse}th{background:#eff6ff;border:1px solid #cbd5e1;padding:6px;font-size:10px;text-transform:uppercase}
    .firmas{margin-top:40px;display:flex;justify-content:space-between;font-size:11px;color:#64748b}.firma{border-top:1px solid #94a3b8;width:30%;text-align:center;padding-top:4px}
  </style></head><body><h2>FÁBRICA DE MEDIAS DUREY — ORDEN DE DESPACHO</h2>
    <p>Pedido: <strong>${e(d.codigoVenta)}</strong> · Fecha: <strong>${e(d.fecha)}</strong>${d.vendedora ? ` · Vendedora: <strong>${e(d.vendedora)}</strong>` : ''}</p>
    <p>Cliente: <strong>${e(d.cliente)}</strong> · DNI/RUC: <strong>${e(d.documento)}</strong></p>
    ${d.direccion ? `<p>Dirección: ${e(d.direccion)}</p>` : ''}
    <p>Almacén elige sacos completos hasta cubrir lo pedido de cada producto.</p>${bloques}
    <div class="firmas"><div class="firma">Ventas</div><div class="firma">Almacén</div><div class="firma">Despacho</div></div>
  </body></html>`
}

/** Abre la página en una pestaña nueva y lanza la impresión. */
export function imprimirHtml(html: string): boolean {
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(html); win.document.close(); win.print()
  return true
}
