-- ==============================================================================
-- Migración 020: Proteger la tabla 'usuarios' de la clave pública (anon)
--
-- Problema: 010/015 dieron GRANT ALL sobre 'usuarios' a anon y authenticated.
-- Como la anon key viaja en el JavaScript del navegador, cualquiera podía:
--   * leer password_hash de todos los usuarios
--   * cambiar su propio 'rol' a 'admin' o activar/desactivar cuentas
--   * insertar o borrar usuarios
--
-- Después de esta migración el navegador solo puede LEER columnas no sensibles
-- y ACTUALIZAR 'estado' (disponible/ocupada). Crear, editar, activar, borrar y
-- cambiar contraseñas pasa por /api/usuarios, que valida la sesión y usa service_role.
--
-- PRE-REQUISITO: SUPABASE_SERVICE_ROLE_KEY configurada en Vercel. El login y
-- /api/usuarios leen password_hash con service_role; sin esa clave el login falla.
--
-- Rollback (solo si algo se rompe y mientras se corrige):
--   GRANT ALL ON TABLE public.usuarios TO anon, authenticated;
-- ==============================================================================

BEGIN;

REVOKE ALL ON TABLE public.usuarios FROM anon, authenticated;

GRANT SELECT (id, auth_id, nombre, email, rol, activo, estado, created_at, debe_cambiar_password)
  ON public.usuarios TO anon, authenticated;

GRANT UPDATE (estado) ON public.usuarios TO anon, authenticated;

COMMIT;
