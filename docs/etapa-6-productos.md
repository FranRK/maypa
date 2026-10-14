# Etapa 6: catálogo multiempresa

## Funcionalidad

`/dashboard` enlaza a `/productos?organizacion=<uuid>`. Sin selección explícita se utiliza la primera membresía activa, siguiendo la etapa 5. El parámetro es solo una solicitud: el servidor verifica la pertenencia y obtiene la organización de la membresía autenticada.

El catálogo permite buscar por nombre o SKU sin distinguir mayúsculas, filtrar activos/inactivos/todos y navegar páginas de diez registros. El orden es nombre e ID para evitar ambigüedad en la paginación. Crear y editar utilizan los campos reales de Producto: sku, nombre, unidad, precioVenta y stockMinimo. El estado se cambia mediante una operación separada. Desactivar requiere confirmación y conserva el registro y las referencias históricas; no existe acción de borrado físico.

PROPIETARIO y ADMINISTRADOR administran el catálogo; EMPLEADO solo consulta. La interfaz oculta los controles al empleado, pero la protección efectiva se realiza dentro del servicio utilizado por cada Server Action.

## Validación y seguridad

- Se reutiliza la sesión verificada por Supabase `getUser` y las membresías activas de Prisma, sin modificar Auth.
- Cada operación vuelve a autorizar; ninguna identidad o rol proviene del formulario. La organización solicitada se coteja con las membresías del usuario verificado. Cada consulta y actualización incluye el ID de organización autorizado.
- Las escrituras se realizan en una transacción que vuelve a leer y bloquea la membresía con `FOR SHARE`. Una baja o cambio de rol concurrente debe esperar al fin de la escritura; si ocurrió antes, la operación se rechaza.
- Zod valida SKU y nombre no vacíos, unidad, longitudes, UUID y filtros. Precio y stock mínimo se procesan como strings decimales, admiten coma o punto y no admiten negativos, notación científica, desbordamiento ni precisión que PostgreSQL redondearía. Precio: hasta 12 enteros y 2 decimales; stock mínimo: 11 enteros y 3 decimales.
- El SKU conserva sus mayúsculas y minúsculas. Su unicidad sigue exactamente la restricción existente `(organizacionId, sku)`, sensible a mayúsculas. No se modifica la política del esquema.
- Las acciones extraen una lista explícita de campos, traducen errores esperados a mensajes visibles y no retornan detalles de conexiones o errores internos. Después de escribir llaman `refresh()` para actualizar el router: las consultas del catálogo son dinámicas y no utilizan caché compartida.
- La conexión privilegiada local de Prisma sigue pudiendo omitir RLS. Este módulo depende de la autorización explícita y los filtros por organización; queda pendiente el rol de mínimos privilegios documentado en la etapa 5.

## Prueba manual

1. Mantener Supabase Docker local iniciado y ejecutar `npm run dev:local`.
2. Iniciar sesión con el usuario local que ya tiene una membresía activa y abrir Productos desde el dashboard.
3. Abrir Crear producto y completar SKU, nombre, unidad, precio y stock mínimo. Verificar el mensaje y la aparición en el listado.
4. Intentar el mismo SKU dentro de la organización y verificar el error visible.
5. Editar el producto; desactivarlo aceptando la confirmación. Buscarlo en Inactivos y reactivarlo.
6. Probar búsquedas por SKU y nombre, estados y páginas cuando haya más de diez productos.
7. Con una membresía EMPLEADO, comprobar la consulta sin controles de escritura. Pedir una organización ajena debe mostrar acceso restringido sin su catálogo.

## Pruebas automatizadas

`npm run test:productos:local` usa Prisma y Supabase Auth reales en loopback, con identidades y organizaciones ficticias. Se verifica el destino con Supabase CLI y Docker antes de escribir. Los usuarios tienen contraseñas aleatorias mantenidas solo en memoria. Al terminar se eliminan exclusivamente las fixtures creadas por esa ejecución; el servicio de la aplicación no permite eliminar productos.

`npm run test:productos:local -- --http` añade comprobaciones contra Next en `127.0.0.1:3000`, incluyendo formularios SSR y envíos reales a Server Actions. Requiere el servidor `dev:local` iniciado. El resolvedor `scripts/resolve-typescript.mjs` permite ejecutar el cliente generado para bundlers directamente con Node, sin cambiar el generador ni añadir dependencias.

No se modifican schema.prisma, migraciones, credenciales ni Supabase Cloud. No se crean saldos ni movimientos al dar de alta productos; estos corresponden a etapas posteriores. No se agrega moneda al precio porque el esquema todavía no define una.

## Límites pendientes

La paginación con offset puede cambiar cuando otros usuarios crean productos simultáneamente. No se implementa control de versión para ediciones concurrentes: prevalece la última escritura. La revisión visual interactiva en distintos dispositivos queda pendiente; las pruebas HTTP comprueban renderizado y operaciones, no la apariencia del navegador. Antes de producción debe implementarse el rol PostgreSQL de mínimos privilegios y revisar la política de normalización del SKU.

## Resultado de esta etapa

- `npx tsc --noEmit`: salida 0.
- `npx eslint .`: salida 0, sin advertencias en la ejecución final.
- `npm run test:auth`: 9 pruebas aprobadas, salida 0.
- `npm run test:productos:local -- --http`: 20 comprobaciones aprobadas, salida 0. Incluye envío hidratado real a Server Actions, creación persistida, error de SKU duplicado y rechazo de un formulario obtenido antes de cambiar el rol a EMPLEADO.
- `git diff --check`: salida 0.

Las pruebas preliminares detectaron imports del cliente generado que Node no resolvía sin extensión; se añadió un resolvedor solo para tests. La codificación multipart del test se ajustó al React instalado (prefijo `_1_` y campos antes de la referencia raíz).

Una prueba preliminar de POST HTML sin JavaScript creó su fixture, pero la respuesta completa quedó pendiente en el servidor de desarrollo y terminó por timeout; otra ejecución equivalente se canceló y se limpiaron explícitamente sus dos organizaciones ficticias. No se considera validado el envío sin JavaScript. El flujo hidratado de React sí pasó todas sus comprobaciones. Next registró advertencias de sistema de archivos lento; sigue pendiente revisar el comportamiento en navegador y el envío sin JavaScript, sin atribuir ese timeout a PostgreSQL (no se observaron bloqueos).

Se reutilizó un servidor Next local que ya estaba escuchando en 3000. El intento de iniciar otro falló con EADDRINUSE, sin reemplazar ni detener el servidor existente.
