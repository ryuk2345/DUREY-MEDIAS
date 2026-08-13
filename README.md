# Sistema de Gestión DUREY — Fábrica y Tienda de Medias

Este es el sistema completo de gestión para la fábrica y tienda de medias DUREY, construido con **Next.js (App Router)**, **Supabase (PostgreSQL)** y **TailwindCSS**.

## 🚀 Inicio Rápido (Local)

### 1. Requisitos Previos
- Node.js instalado
- Un proyecto creado en [Supabase](https://supabase.com)

### 2. Configurar Variables de Entorno
Crea o edita el archivo `.env.local` en la raíz del proyecto e ingresa tus credenciales de Supabase:
```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-key-anonima
```

### 3. Ejecutar Migraciones SQL
1. Ve a **SQL Editor** en tu panel de Supabase.
2. Copia todo el contenido de `supabase/migrations/001_schema_completo.sql` y ejecútalo.
3. Esto creará el esquema relacional de 22 tablas con índices, secuencias y datos de prueba precargados (Usuarios con roles, Máquinas, Ubicaciones y Catálogo de medias).

### 4. Instalar y Levantar Servidor
```bash
npm install
npm run dev
```
Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## 🛠️ Roles de Prueba del Sistema
El archivo SQL precarga los siguientes usuarios de prueba para que puedas iniciar sesión sin configuraciones complejas de Auth. Puedes usar cualquiera de los siguientes correos (contraseña la que configures en Supabase o simulados en frontend):

| Nombre | Email | Rol | Módulos Accesibles |
| :--- | :--- | :--- | :--- |
| Admin General | `admin@durey.com` | `admin` | Todo el sistema |
| Supervisor Durey | `supervisor@durey.com` | `supervisor` | Catálogo, Tejido, Remallado, Planchado, Preparado, Almacén, Despacho, Reportes |
| Carlos Tejedor | `tejedor@durey.com` | `tejedor` | Registro de Tejido, Reportar Avería |
| Ana Remalladora | `remalladora@durey.com` | `remalladora` | Registro de Remallado, Reportar Avería |
| Mario Planchador | `planchador@durey.com` | `planchador` | Planchado Diario |
| Lucia Preparadora | `preparador@durey.com` | `preparador` | Preparar Paquetes y Generar QR |
| Juan Almacenero | `almacenero@durey.com` | `almacenero` | Salones de Almacén, Traslados |
| Sofia Vendedora | `vendedora@durey.com` | `vendedora` | Carrito de Ventas, Créditos, Caja Diaria |
| Pedro Tecnico | `tecnico@durey.com` | `tecnico` | Mantenimiento y Reparaciones |

---

## 📦 Módulos Implementados

1. **Dashboard Administrador (`/dashboard/admin`):** KPIs en tiempo real de ingresos reales, cuentas por cobrar, costos de producción y gastos de mantenimiento técnico. Gráfico interactivo y deudas atrasadas.
2. **Catálogo de Medias (`/dashboard/catalogo`):** CRUD completo con códigos físicos autogenerados en base a atributos, costos de producción y baja lógica para mantener consistencia de datos históricos.
3. **Producción Tejido (`/dashboard/produccion`):** Gestión de turnos (8h/12h, Día/Noche), vinculando máquinas, tejedores y medias. Registro de docenas producidas por máquina.
4. **Remallado (`/dashboard/remallado`):** Minidepósitos con barra de progreso. Habilita lotes al acumular exactamente 75 docenas del mismo tipo de media y horario. Asignación a máquinas remalladoras específicas y traspaso por saturación.
5. **Planchado Diario (`/dashboard/planchado`):** Cronograma semanal rotativo por planchador y día. Filtrado inteligente que muestra a cada planchador solo las medias que debe planchar según el criterio del día.
6. **Preparado y Embolsado (`/dashboard/preparado`):** Embolsado de medias, ID único de bulto y generación de código QR interactivo y descargable.
7. **Almacén y Salones (`/dashboard/almacen`):** Monitoreo de stock distribuido por salones físicos y Almacén General (con alertas de saturación).
8. **Despacho y Entregas (`/dashboard/despacho`):** Escaneo de QR de paquetes vendidos para validación con orden, generación de Guía de Remisión (Shalom, Olva) y confirmación de recepción subiendo el cargo firmado.
9. **Ventas y Caja (`/dashboard/ventas`):** Carrito de ventas con búsqueda RENIEC, opción de cuotas/créditos, registro de cobranza con evidencia (capturas) y cuadre de caja diario.
10. **Mantenimiento (`/dashboard/mantenimiento`):** Control técnico de averías. Compara el reporte del operador frente a la solución del técnico, controlando repuestos e historial de costos.
11. **Reportes (`/dashboard/reportes`):** Descarga de reportes detallados en formatos **Excel (.xlsx)** y **PDF** para cada una de las áreas del sistema.

