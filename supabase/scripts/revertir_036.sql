-- Reversión de la migración 036. Se aplica a mano, nunca como migración numerada.
-- Vuelve a dejar escribir con sesión en catálogo, caja, clientes y egresos, y quita las
-- funciones, el disparador, la vista y la columna comprobante_url (se pierde lo guardado en ella).
BEGIN;

GRANT INSERT, UPDATE, DELETE ON TABLE public.cajas_diarias, public.clientes, public.egresos_adicionales,
  public.catalogo_medias, public.modelos_media, public.compras_materia_prima, public.cuotas_compras, public.pagos_proveedores TO authenticated;

DROP VIEW IF EXISTS public.vista_gastos_materia_prima;

DROP FUNCTION IF EXISTS public.eliminar_egreso(uuid);
DROP FUNCTION IF EXISTS public.registrar_egreso(text, numeric, text, date, text);
DROP FUNCTION IF EXISTS public.eliminar_cliente(uuid);
DROP FUNCTION IF EXISTS public.guardar_cliente(uuid, jsonb);
DROP FUNCTION IF EXISTS public.cerrar_caja(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.abrir_caja(uuid, numeric);
DROP FUNCTION IF EXISTS public.crear_modelo_media(text);
DROP FUNCTION IF EXISTS public.eliminar_producto(uuid);
DROP FUNCTION IF EXISTS public.cambiar_estado_producto(uuid, text);
DROP FUNCTION IF EXISTS public.editar_producto(uuid, jsonb);
DROP FUNCTION IF EXISTS public.crear_producto(jsonb);

DROP TRIGGER IF EXISTS catalogo_medias_identidad_fija ON public.catalogo_medias;
DROP FUNCTION IF EXISTS public.proteger_identidad_producto();
DROP FUNCTION IF EXISTS public.exigir_algun_modulo(text[]);

ALTER TABLE public.egresos_adicionales DROP COLUMN IF EXISTS comprobante_url;

COMMIT;
