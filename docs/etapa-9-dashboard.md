# Etapa 9: panel de inicio y usabilidad móvil

Implementado para Supabase Docker local. No se modificaron el esquema Prisma, las
migraciones aplicadas, Auth, los archivos de entorno ni las dependencias. No se
ejecutaron migraciones. Todas las consultas se apoyan en servicios ya existentes
y autorizados.

## Uso

1. Iniciar Supabase local y Next con `npm run dev:local`.
2. Iniciar sesión con una cuenta con membresía activa. `/dashboard` es la pantalla
   de entrada y no requiere elegir organización: usa la membresía de la sesión.
   El parámetro `?organizacion=` solo elige entre las membresías de esa misma
   sesión; nunca autoriza.
3. Desde el panel se navega a Productos, Inventario y Ventas con la organización
   seleccionada conservada.

## Indicadores

| Indicador | Definición exacta |
|---|---|
| Ventas del día | Suma de `Venta.total` con `estado = CONFIRMADA` y `creadaEn` dentro del día argentino |
| Cantidad de ventas | Cantidad de ventas `CONFIRMADA` de ese mismo rango |
| Productos con stock bajo | Productos **activos** con `coalesce(SaldoStock.cantidad, 0) < Producto.stockMinimo` y `stockMinimo > 0` |
| Últimas ventas | Las 5 ventas más recientes de la organización, `creadaEn desc, id desc` |
| Movimientos recientes | Los 5 movimientos más recientes, `creadoEn desc, id desc`, con su producto |

Cada indicador enlaza al detalle existente: el historial de ventas, el inventario
filtrado por `stock=bajo` y el historial por producto (`#historial`).

La definición de stock bajo es una réplica exacta de
`inventario.listar({ estado: "activos", stock: "bajo" })`, y hay una prueba que
compara ambos resultados entre sí en vez de confiar en que coincidan.

### Ventas brutas

`ESTADOS_VENTA_BRUTA = ["CONFIRMADA"]` está exportado y comentado en
`lib/dashboard/service.ts`. Cuenta solo ventas confirmadas porque son las únicas
que existen hoy: el esquema tiene `DevolucionVenta` y `DetalleDevolucion`, pero
ningún servicio las crea, y las ventas no se anulan. Por eso el indicador se llama
*bruto* y no *neto*: cuando existan devoluciones o anulaciones, el neto se calcula
restando esos importes y **sin** cambiar el filtro de estados.

### Zona horaria

`lib/fechas.ts` es el dueño de `ZONA_HORARIA = "America/Argentina/Buenos_Aires"`,
`rangoDelDiaAr` y `formatearFechaHora`. El día argentino se convierte a dos `Date`
absolutos y se pasa a Prisma como rango, sin depender de la zona del servidor ni
del navegador. Las pruebas cubren el corte exacto: 00:00 entra al día y
23:59:59.999 queda afuera, y un reloj desplazado un día mueve la ventana.

`lib/fechas.ts` no tiene importaciones relativas a propósito, para poder
ejercitarse con `node --test` sin el enlazador de TypeScript del proyecto.

## Navegación y UX móvil

- **Navegación responsive**: `components/nav-principal.tsx` aparece en el panel,
  productos, inventario, ventas y detalle de venta. Marca la sección activa con
  `aria-current="page"`, envuelve en varias líneas sin desbordar y conserva el
  nombre de la organización y el rol. Reemplaza los enlaces sueltos que antes
  había que buscar dentro de cada pantalla.
- **Áreas táctiles**: `Button`, `Input` y los `<select>` usan `h-11` (44 px) en
  celular y `sm:h-9` en escritorio. Los enlaces que son acción ("Volver a ventas",
  "Ver venta registrada", los indicadores) usan `inline-flex h-11 sm:h-9`. Los
  `<summary>` de "Crear producto", "Editar producto" y "Registrar movimiento" usan
  `min-h-[44px] sm:min-h-0`: se agranda el área sin cambiar `display`, para no
  perder el triángulo de despliegue.
- **Foco y desplazamiento al confirmar**: en `components/ventas/formulario.tsx` el
  bloque de salida tiene `tabIndex={-1}` y `aria-live="polite"`. Cuando la venta
  se confirma o el resultado queda incierto, la vista se desplaza hacia él
  (`scrollIntoView` con `block: "center"`) y el foco se mueve ahí
  (`focus({ preventScroll: true })`). En un celular el mensaje de resultado puede
  quedar a más de una pantalla de distancia del botón.
- **Estados vacíos, de carga y de error**: el panel usa `Suspense` con
  "Cargando el panel…", textos explícitos cuando no hay ventas ni movimientos, y
  conserva la pantalla "Acceso restringido" para cuentas sin membresía activa. Las
  pantallas de productos, inventario y ventas mantienen sus mensajes de error de
  filtros inválidos o acceso denegado.
- **Talles y cortes sin desborde**: las pantallas comerciales ya no muestran
  identificadores técnicos (`Identificador: <uuid>` ni el UUID del autor). Los
  importes y los totales usan `tabular-nums` para escanearse alineados, y los
  nombres, SKU y correos largos usan `break-words`/`break-all`. El renglón
  `cantidad × precio = subtotal` del detalle de venta es `flex flex-wrap`, así que
  envuelve en vez de desbordar a 320 px.
- **Etiquetas legibles**: `lib/etiquetas.ts` traduce estados de venta, roles y
  tipos de movimiento (`ETIQUETAS_ESTADO_VENTA`, `ETIQUETAS_ROL`,
  `ETIQUETAS_TIPO_MOVIMIENTO`), tipados como `Record<Enum, string>` para que
  agregar un valor al enum rompa la compilación en lugar de mostrar texto crudo.
  El detalle de venta ya no muestra `CONFIRMADA` ni ningún identificador técnico:
  muestra "Confirmada", la fecha legible y el autor.

## Autor de una operación

`components/autor.tsx` y `etiquetaAutor` muestran el autor con el nombre y el
apellido de su `Perfil`. El nombre llega por las relaciones que ya existen
(`Venta.creador` y `MovimientoStock.autor` apuntan a `MiembroOrganizacion`, que
está ligada a `Perfil`), así que no se consulta Auth administrativo, tal como
exige `docs/etapa-7-inventario.md`. La relación es la compuesta
(`organizacionId` + `usuarioId`), de modo que el nombre siempre sale de una
membresía de la organización autorizada.

| Caso | Qué se muestra |
|---|---|
| Con nombre y apellido | `Nombre Apellido` |
| Sesión propia con nombre | `Nombre Apellido (vos)` |
| Sin nombre en el perfil, sesión propia | `<correo> (vos)` |
| Sin nombre en el perfil, otra persona | `Sin nombre cargado` |

Ningún caso expone el UUID técnico del miembro: el identificador sigue disponible
en el dato (para armar enlaces internos) pero no se imprime, ni siquiera en
`title` o para lectores de pantalla. Cuando el integrante todavía no cargó su
nombre, se muestra un texto neutro en lugar de un fragmento de UUID.

## Seguridad y límites

- Toda consulta del panel pasa por `lib/dashboard/service.ts`, que obtiene la
  identidad verificada del servidor y exige membresía activa de la organización
  solicitada. El identificador de organización enviado por el navegador es una
  selección, nunca una prueba de autorización.
- El panel no expone secretos, cadenas de conexión ni datos de otras
  organizaciones. Hay pruebas HTTP que verifican que un panel ajeno no se
  renderiza y que no aparece ningún SKU de otra empresa.
- Prisma sigue usando el rol PostgreSQL privilegiado del proyecto. RLS no
  sustituye estos controles y no se presupone que lo limite.
- **Importes en pesos argentinos**: `lib/importes.ts` (módulo puro, sin
  importaciones del proyecto, igual que `lib/fechas.ts`) formatea con
  `Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })` y siempre
  dos decimales (`$ 1.234,56`). El formateo es solo de presentación: los `Decimal`
  se siguen guardando, comparando y enviando al servidor crudos, y las cantidades
  (stock, variaciones) no se formatean como moneda.
- El historial sigue usando paginación por `offset`, sin snapshot entre páginas.
- El autor sin nombre se muestra con un texto neutro ("Sin nombre cargado"); nunca
  con el UUID.

## Archivos

- `lib/dashboard/service.ts`: indicadores y listas, con la organización autorizada.
- `lib/dashboard/server.ts`: vínculo server-only con Prisma y autorización reales.
- `app/dashboard/page.tsx`: panel, navegación, estados vacíos y de carga.
- `lib/fechas.ts`: zona horaria argentina, rango del día y formato de fecha y hora.
- `lib/importes.ts`: formato de importes en `es-AR`/`ARS`, solo presentación.
- `lib/etiquetas.ts`: etiquetas en español y `etiquetaAutor` (solo texto legible).
- `components/nav-principal.tsx`, `components/dashboard/tarjeta.tsx`,
  `components/autor.tsx`: componentes nuevos reutilizados por las pantallas.
- `components/ui/button.tsx`, `components/ui/input.tsx`: alturas táctiles.
- `components/ventas/formulario.tsx`: foco y desplazamiento tras confirmar.
- `app/productos/page.tsx`, `app/inventario/page.tsx`, `app/ventas/page.tsx`,
  `app/ventas/[id]/page.tsx`: navegación, etiquetas, autor y áreas táctiles.
- `tests/dashboard.test.mjs`: pruebas unitarias de la ventana argentina, las
  etiquetas y el texto del autor.
- `tests/importes.test.mjs`: pruebas unitarias del formato de importes.
- `scripts/probar-dashboard-local.mjs`: pruebas de integración y HTTP.
- `docs/etapa-10-perfil-nombre-detalle-historico.md`: lo que falta para los nombres
  reales y el histórico de producto. La migración incremental está creada en
  `prisma/migrations/20261017000000_perfil_nombre_y_detalle_historico/` y no aplicada;
  el paso de NOT NULL queda como borrador en
  `docs/etapa-10-perfil-nombre-obligatorio.sql.draft`.

## Validación ejecutada

- `npm run test:dashboard`: 18 pruebas aprobadas, exit 0.
- `node --test tests/importes.test.mjs`: 4 pruebas aprobadas, exit 0.
- `npm run test:dashboard:local -- --http`: 11 comprobaciones aprobadas, exit 0.
  Incluye aislamiento entre dos organizaciones, corte 00:00/23:59:59.999
  argentino, reloj desplazado, solo `CONFIRMADA`, comparación con
  `inventario.listar({ stock: "bajo" })`, límites y orden de las dos listas,
  autorización (sin sesión, organización ajena, id inválido, baja de membresía)
  y HTTP (redirección anónima, indicadores, enlaces al detalle de venta y al
  historial de inventario, nombre y apellido del autor, importes formateados y
  ausencia de UUID, secretos y datos ajenos).
- `npm run test:auth`: 14 pruebas aprobadas, exit 0.
- `npm run test:perfil`: 8 pruebas aprobadas, exit 0.
- `npm run test:auth:local`: 12 comprobaciones aprobadas, exit 0.
- `npm run test:perfil:local`: 23 comprobaciones aprobadas, exit 0.
- `npm run test:productos:local -- --http`: 20 comprobaciones aprobadas, exit 0.
- `npm run test:inventario:local -- --http`: 27 comprobaciones aprobadas, exit 0.
- `npm run test:ventas:local -- --http`: 26 comprobaciones aprobadas, exit 0.
- `npx prisma validate --config prisma.local.config.ts` y
  `npx prisma format --config prisma.local.config.ts --check`: exit 0 (el esquema
  no se modificó y no se ejecutó ninguna migración).
- `npx tsc --noEmit`: exit 0. `npx eslint .`: exit 0.

Las dos aserciones de `scripts/probar-auth-local.mjs` que esperaban el valor
técnico del rol en el HTML (`/PROPIETARIO/` y `/EMPLEADO/`) se actualizaron en la
fase 1 a la etiqueta traducida, y ahora además se verifica que el valor técnico
**no** aparezca. En la fase 2 se actualizaron las aserciones que esperaban importes
crudos (`"5.00"`, `"2.50"`, `"12.50"`) y el autor con UUID: ahora comparan contra
`formatearImporte(...)` y contra el nombre y apellido del perfil, y comprueban que
el UUID del autor no aparezca. Son los únicos cambios de pruebas existentes.

### Verificación visual en navegador real

Fase 1 (escritorio 800 × 578 y celular 390 px, mediante un iframe del mismo
origen, porque la herramienta de navegador disponible no emula el ancho de
ventana) sobre `/dashboard`, `/productos`, `/inventario`, `/ventas` y
`/ventas/[id]`:

- Cero desborde horizontal en las cinco pantallas.
- Cero controles interactivos por debajo de 44 px de alto en las cinco pantallas.
- Confirmación de venta real desde el navegador: el bloque de salida pasó de
  1424 px a 277 px dentro de una ventana de 578 px (scroll 0 → 1147) y
  `document.activeElement` quedó en él, con `aria-live="polite"` y
  `tabIndex="-1"`.
- Consola del navegador sin errores en las cinco pantallas.

La fase 1 encontró y permitió corregir cuatro defectos reales que las
pruebas automáticas no detectaban: los `<summary>` medían 24 px, el `<select>` de
tipo de movimiento 36 px, los enlaces posteriores a confirmar una venta 24 px, y
el `<div>` de `Badge` estaba dentro de un `<p>` en el detalle de venta, lo que
producía un error de hidratación de React. Los cuatro quedaron corregidos.

Fase 2 (nombres, importes y móvil). La herramienta de navegación de esta sesión
corta la respuesta SSR en streaming, por lo que la carga completa de una pantalla
se quedaba en el fallback de `Suspense`. Se verificó midiendo el HTML real de cada
pantalla dentro de un iframe de 320 y de 390 px, revelando el contenido resuelto,
sobre un fixture temporal propio (organización, dos productos —uno con nombre y
SKU largos—, stock y una venta del día), ya eliminado y con sesión real:

- Cero desborde horizontal en las cinco pantallas, a 320 y a 390 px.
- Cero controles interactivos por debajo de 44 px de alto, a 320 y a 390 px.
- El autor se ve como `Camila Rosales (vos)`; ningún UUID técnico aparece en el
  texto visible (se descartaron del chequeo los correos, que sí se muestran).
- Los importes se ven como `$ 2.487,87` (panel) y `1.500 kg × $ 12,50 = $ 18,75`
  (detalle de venta), con el renglón del detalle envolviendo sin desbordar.
- El nombre y el SKU largos cortan de línea y envuelven.

Cada ejecución de las pruebas de integración verifica los contenedores Docker del
proyecto, PostgreSQL en loopback 54322, la API Auth en loopback 54321 y la
identidad de PostgreSQL antes de crear fixtures, y limpia únicamente los registros
de las organizaciones y usuarios que creó. No se modificó Supabase Cloud.
