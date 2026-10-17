# Etapa 8: registro de ventas

Implementado para Supabase Docker local. No se modificaron el esquema Prisma,
las migraciones aplicadas, Auth, los archivos de entorno ni dependencias.

## Uso

1. Tener Supabase local funcionando. Iniciar Next desde la raíz con
   `npm run dev:local -- --docker` (o `npm run dev:local` si Supabase CLI status responde).
   Este script proporciona las conexiones locales al proceso sin sobrescribir `.env`.
   `npm run dev` por sí solo no prepara ese entorno y puede leer la URL Cloud que
   la protección local rechaza. Si el puerto 3000 ya está ocupado, usar el servidor
   existente o detenerlo antes de iniciar otro.
2. Iniciar sesión con una cuenta local con membresía activa. Entrar al dashboard
   de la organización y elegir **Registrar ventas**.
3. Preparar productos activos en `/productos` y existencias en `/inventario`.
4. En `/ventas`, buscar por nombre/SKU, agregar productos e ingresar cantidades.
   El formulario muestra existencias consultadas, subtotales y total estimado.
5. **Revisar venta** consulta precios y stock del servidor. Revisar el total y
   elegir **Confirmar venta**. Los datos quedan bloqueados durante el envío.
6. Abrir **Ver venta registrada** (`/ventas/[id]?organizacion=...`). Comprobar
   precios históricos, cantidades, total, autor y movimientos relacionados.
   En inventario se verá una salida VENTA por renglón y el saldo actualizado.

No hay edición, eliminación, anulación ni devolución de ventas desde este módulo.
El historial tiene paginación de 20 registros; la búsqueda de productos también
pagina de 20 en 20. Límite de 100 productos diferentes por venta.

## Importes y revisión

Se reciben solamente IDs de productos, cantidades, clave UUID y revisión de precios.
Los precios, totales y autor enviados adicionalmente por el navegador se ignoran.
Cada precio se lee de Producto dentro de la transacción, conservándolo en
DetalleVenta.precioUnitario. Cantidades positivas: hasta 11 enteros y 3 decimales,
sin notación exponencial, NaN ni redondeo implícito. Se admite coma decimal.
Se rechazan productos repetidos, incluso con diferencias de mayúsculas en el UUID.

Decimal usa precisión 40. Cada subtotal = cantidad × precio, redondeado con
ROUND_HALF_UP a dos decimales (coincide con round(numeric,2) del CHECK existente).
Total = suma de esos subtotales; máximo 999999999999.99. El cálculo visual es
orientativo; la revisión y la confirmación vuelven a calcular todo en el servidor.
La revisión lleva SHA-256 de organización y precios ordenados por producto; si
cambia un precio antes de confirmar, se rechaza la confirmación para revisarlo.
La revisión no reserva stock. La comprobación definitiva sucede bajo bloqueo.

## Transacciones, concurrencia y trazabilidad

Prisma interactive transaction, ReadCommitted (predeterminado de PostgreSQL),
timeout/maxWait de 15 segundos. No se usan triggers ni funciones nuevas de BD.

Orden compartido de bloqueos:

1. Membresía FOR SHARE; volver a comprobar activa y permiso dentro de la transacción.
2. Advisory transaction lock sobre `venta:organizacion:clave`.
3. Buscar la venta por unique(organizacionId,claveIdempotencia).
4. Bloquear TODOS los productos FOR UPDATE en orden canónico por UUID; comprobar
   organización y estado activo. Esto serializa también los cambios de precios.
5. Crear la cabecera CONFIRMADA y sus fechas dentro de la transacción.
6. Para cada producto, bloquear saldo (crear cero si falta), comprobar que coincide
   con SUM(MovimientoStock.variacion), verificar saldo suficiente y actualizarlo.
7. Crear DetalleVenta y MovimientoStock tipo VENTA, con variación negativa, autor
   verificado y detalleVentaId. Las FK compuestas existentes conservan organización
   y producto; el índice único evita dos salidas VENTA para el mismo detalle.

Las operaciones de inventario usan los mismos helpers de membresía, producto,
saldo consistente y actualización. Bloquear productos en orden evita ciclos
entre ventas de varios productos, aunque el cliente los envíe en orden inverso.
Un fallo revierte cabecera, detalles, movimientos y saldos. No se permite una
venta parcial. La venta conserva su membresía histórica mediante las FK RESTRICT.

## Idempotencia

Se reutilizan los campos existentes Venta.claveIdempotencia/huellaSolicitud y su
índice único por organización. SHA-256 incluye organización, usuario autenticado,
productos/cantidades canónicos ordenados y revisión de precios. Un reintento con
igual clave/huella devuelve la venta original sin consultar nuevos precios ni
descontar stock. Cambiar contenido o autor con la misma clave se rechaza.

El formulario conserva la clave durante errores/reintentos y bloquea nuevos
envíos después de recibir éxito. Ante un resultado incierto conserva la solicitud
y ofrece reintentar; no permite modificar ese carrito hasta recuperar el resultado.
Los movimientos VENTA no utilizan claves independientes: su idempotencia se deriva
de la venta y del unique por detalle/tipo.

Limitación: el borrador vive en memoria del componente, no se guarda entre recargas
o cierres del navegador. Si se pierde la respuesta y se recarga la página, comprobar
primero el historial antes de generar otra solicitud. Distintas claves representan
ventas distintas, incluso con el mismo contenido. La recuperación de borradores
entre recargas queda pendiente.

## Seguridad y límites

PROPIETARIO, ADMINISTRADOR y EMPLEADO pueden VER_VENTAS y REGISTRAR_VENTAS.
Cada búsqueda, revisión, listado, detalle y escritura obtiene la identidad verificada
del servidor y exige membresía activa de la organización solicitada. El ID de la
organización es una selección, nunca prueba de autorización. El autor/rol no se
aceptan del navegador. Las acciones devuelven datos mínimos y errores controlados.

Prisma sigue usando el rol PostgreSQL local privilegiado del proyecto. RLS no
sustituye estos controles y no se presupone que lo limite. La estrategia futura de
rol mínimo sigue documentada en etapa 5; este módulo no cambia grants ni RLS.
SQL directo privilegiado puede eludir las reglas del servicio (sumatoria del total,
inmutabilidad de ventas confirmadas, correspondencia exacta de cantidades del
detalle y movimiento). No se afirma que esas invariantes estén completamente
garantizadas por la base. Todo escritor futuro debe usar la misma estrategia.

Los nombres, SKU y unidad mostrados en ventas históricas son los del producto actual;
el esquema conserva como históricos cantidad, precio y subtotal, no esos textos.
La etapa 10 tiene preparado —sin aplicar— el SQL y la estrategia de visualización
para capturar el nombre y el SKU al momento de vender, sin rellenar las ventas ya
registradas: ver `docs/etapa-10-perfil-nombre-detalle-historico.md`.
El autor histórico es el UUID de la membresía (Perfil no tiene nombre/email); desde
la etapa 9 se muestra como correo propio o como "Empleado" abreviado, con el UUID
completo disponible, y el nombre real llega con la etapa 10.
No hay moneda en el esquema; los importes siguen la unidad monetaria que ya usa
el catálogo, sin añadir impuestos, pagos ni conversión.

Pendiente: recuperación de borradores; moneda/política fiscal y formato regional de
importes (la etapa 9 mantiene `toFixed(2)` a propósito); rol de BD mínimo.
La revisión visual manual de escritorio/celular y la verificación del foco y del
desplazamiento posterior a confirmar quedaron hechas en la etapa 9 (ver
`docs/etapa-9-dashboard.md`).
La SUM del historial por producto favorece consistencia pero puede requerir revisión
de rendimiento cuando crezca el historial. El listado usa offset, sin snapshot entre
páginas. Ninguno de estos puntos autoriza cambios contra Supabase Cloud.

## Archivos

- `lib/ventas/service.ts`: consultas autorizadas, validación y transacción de venta.
- `lib/ventas/server.ts`: vínculo server-only con Prisma y autorización reales.
- `lib/ventas/importes.ts`: cálculo Decimal compartido, apto para navegador.
- `app/ventas/page.tsx`: organización activa, formulario e historial paginado.
- `app/ventas/[id]/page.tsx`: consulta protegida del detalle y movimientos.
- `app/ventas/actions.ts`: búsqueda, revisión y confirmación con mensajes seguros.
- `components/ventas/formulario.tsx`: carrito, revisión y reintentos.
- `lib/inventario/cantidades.ts`: extracción de funciones exactas de cantidades.
- `lib/inventario/transacciones.ts`: extracción de bloqueos y control de saldos.
- `lib/inventario/service.ts`: reutiliza helpers; conserva exports compatibles.
- `lib/auth/policy.ts`: permisos de consulta y registro de ventas para los tres roles.
- `app/dashboard/page.tsx`: enlace a ventas con organización seleccionada.
- `scripts/probar-ventas-local.mjs`: pruebas reales PostgreSQL/Auth y HTTP opcional.
- `package.json`: script test:ventas:local.
- Este documento.

## Validación ejecutada

- `npm run test:ventas:local -- --docker`: 22 comprobaciones aprobadas, exit 0.
- `npm run test:ventas:local -- --docker --http`: 26 comprobaciones aprobadas, exit 0.
  Incluye páginas protegidas, detalle, búsqueda/cotización/confirmación mediante
  Server Actions HTTP, reintento sin duplicados y manipulación de producto ajeno.
- `npm run test:inventario:local -- --docker`: 24 comprobaciones aprobadas, exit 0.
- `npm run test:auth`: 9 pruebas aprobadas, exit 0.
- `npx tsc --noEmit`: exit 0.
- `node node_modules/eslint/bin/eslint.js .`: exit 0, sin errores ni advertencias.

Comprobación final de solo lectura: ambas migraciones aplicadas conservan checksums
idénticos a sus archivos; cero organizaciones `ventas-%` y cero usuarios Auth
`ventas-%@example.test` pendientes. Rol actual `postgres`: rolsuper=false,
rolbypassrls=true; por eso se mantienen todas las comprobaciones del servidor.

Se probaron: ventas unitarias/múltiples, redondeo, stock y ledger, inactivos e
inexistentes, cantidades inválidas, precios históricos, cambio de precio,
concurrencia entre ventas y con ajustes de inventario, cuatro reintentos simultáneos,
clave reutilizada con otro contenido, aislamiento de empresas, roles y baja,
sin sesión, overflow monetario y rollback tras un fallo inyectado en el segundo
movimiento. El rollback se verificó contando cabeceras/detalles/movimientos y saldos,
seguido de un reintento exitoso de la misma solicitud.

Cada ejecución verifica contenedores Docker del proyecto, loopback 54322/postgres,
API Auth loopback 54321 y la identidad PostgreSQL antes de crear fixtures. Los usuarios
temporales son ventas-UUID@example.test; contraseñas aleatorias solo en memoria.
La limpieza elimina exclusivamente los registros vinculados a las organizaciones
y usuarios creados en esa ejecución, nunca historial real. No se ejecutaron migraciones.

Durante el desarrollo se corrigieron un tipo de array explícito requerido por TS,
una regla React de inmutabilidad del cálculo visual y la detección de referencias
públicas de acciones de esta versión Next en el test HTTP. Las ejecuciones iniciales
fallidas no se cuentan como aprobadas. Node emite la advertencia preexistente
MODULE_TYPELESS_PACKAGE_JSON; no se cambió el tipo de módulo del proyecto.
