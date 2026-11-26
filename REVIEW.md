# REVIEW.md — qué mira primero quien revisa en DUREY

Se ratifica junto con la constitución (`02-DOCS/wiki/sdd/constitution.md`). Se amplía cuando un hallazgo se repite; nunca en silencio.

## El resumen empieza con un conteo
"N hallazgos: X bloqueos, Y a corregir, Z detalles", antes de todo lo demás.

## Cómo se ve un fallo aquí
- Un permiso a `anon`, una tabla nueva sin RLS o sin la política `durey_usuarios_con_sesion`, una función nueva sin `search_path` fijo.
- Una migración que edita otra anterior, que no va en `BEGIN; … COMMIT;`, que pone una restricción antes de migrar los datos, o sin test SQL / sin reversión cuando cambia algo existente.
- Stock, caja, cuotas o estados cambiados con varias llamadas desde la pantalla en lugar de una RPC atómica (se queda a medias si falla una).
- Lógica de negocio duplicada en una pantalla (stock calculado en el cliente, transiciones de máquina o roles a mano) en vez de `lib/domain`, `lib/utils`, `MODULOS_POR_ROL` o `vista_stock_medias`.
- Datos del negocio guardados en `localStorage`, o datos inventados mostrados en pantalla.
- Fechas: un `new Date('AAAA-MM-DD')` mostrado sin `formatearFecha` (en Lima sale el día anterior); "hoy" calculado en UTC.
- Un test que pasa también sin el cambio (no prueba nada) o una puerta de verificación que no puede fallar.
- Un secreto en el código.

## Rutas que no se revisan
`node_modules/`, `.next/`, `mock_db.json`, `mock_db.e2e.json`, `package-lock.json`, `02-DOCS/raw/`.

## Tope de detalles
Como máximo 3 detalles (nits) por revisión; el resto se descarta.

## Siempre con una persona
- Aplicar migraciones en la base real y cualquier SQL que borre o cambie datos existentes: confirmación escrita del dueño (constitución, principio 12).
- Cambios en las rutas sensibles de abajo: nivel 2 obligatorio (especificación aprobada + panel de 3 revisores).

## Rutas sensibles (siempre nivel 2)
La lista que aplica `rsc risk` está en `.rsc-risk.json` (versionado en la raíz; manda la versión de `main`). Si cambia una, se cambian las dos.

**Login, sesión y permisos**
- `lib/auth/` (JWT, sesión, roles, token de base, usuario actual)
- `proxy.ts` (y `middleware.ts` si existiera)
- `app/api/auth/` (login, logout, sesión, cambio de contraseña, token de base)
- `app/api/usuarios/` y `app/api/usuarios-lista/`
- `app/api/diagnostico/`
- `app/(auth)/` (pantallas de login y cambio de contraseña)
- `lib/utils/index.ts`: solo las líneas de `MODULOS_POR_ROL` y `ROLES_LABELS`, incluidas las de cada rol (`tejedor: ['produccion', …]`)

**Caja, cobros y pagos**
- `lib/domain/finance.ts`
- `app/dashboard/ventas/` (ventas, cuotas, cobros y caja del día)
- `app/dashboard/egresos/` y `app/dashboard/balance/`
- `app/dashboard/materia-prima/`: solo las líneas que tocan pagos y cuotas a proveedores o la caja (`registrar_pago_proveedor`, `reprogramar_cuota_compra`, `cuotas_compras`, `pagos_proveedores`, `cajas_diarias`)
- Migraciones SQL (`supabase/migrations/`): ya son nivel 2 por ser migraciones; incluye las funciones `registrar_cobro_cuotas`, `registrar_pago_proveedor` y `_sumar_a_caja`.
