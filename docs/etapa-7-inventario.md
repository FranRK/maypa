# Etapa 7: inventario multiempresa

## Estado y cambio imprescindible

La inspección de PostgreSQL local confirmó los CHECK existentes de saldo no negativo, valores finitos y signo/referencias según TipoMovimiento, y las FK compuestas hacia producto y autor. Había cero movimientos al iniciar esta etapa. MovimientoStock no tenía idempotencia para movimientos independientes, ni índice de stock inicial único ni CHECK de motivo de ajuste.

Se agregaron al esquema Prisma solamente `MovimientoStock.claveIdempotencia` UUID opcional, `huellaSolicitud` CHAR(64) opcional y la unicidad `(organizacionId, claveIdempotencia)`. Los movimientos comerciales futuros pueden conservar NULL porque su idempotencia pertenece al flujo comercial; los independientes INICIAL/COMPRA/AJUSTE deben tener ambos campos por CHECK.

La propuesta está en `docs/etapa-7-inventario-migracion.sql.draft`. El usuario autorizó aplicar y probar exclusivamente en local. Se registró la nueva migración `prisma/migrations/20261013000000_inventario_idempotente/migration.sql` con Prisma Migrate usando `prisma.local.config.ts`; no se modificó la inicial ni se ejecutó su SQL manualmente. El script `scripts/migrar-inventario-local.mjs --aplicar` comprueba CLI, Docker, loopback:54322/postgres, checksum de la inicial, migraciones pendientes y ausencia de movimientos históricos antes de aplicar. No carga `.env` ni utiliza conexiones Cloud.

La migración añade dos columnas, dos índices únicos (clave por organización y un INICIAL por producto) y tres CHECK (pares clave/huella coherentes, idempotencia independiente obligatoria y motivo de ajuste). No altera Auth, permisos ni políticas RLS. El encabezado SQL conserva el texto de su propuesta original; el estado aplicado se acredita en `_prisma_migrations`, no en ese comentario. No se cambia un archivo ya aplicado para corregir comentarios.

## Funcionalidad y política

- `/inventario?organizacion=<uuid>` enlazado desde `/dashboard`; selección validada contra membresías activas. Sin selección explícita se usa la primera membresía activa, igual que etapas anteriores.
- Listado de diez productos por página: stock actual, unidad, mínimo, indicador de stock bajo (cantidad estrictamente menor al mínimo), estado y búsqueda por nombre/SKU. Un producto sin SaldoStock se muestra con cero, sin crear filas durante la consulta.
- Filtros activos/inactivos/todos y stock todos/bajo/sin stock. Historial paginado de veinte movimientos, filtrado por producto y tipo, con fecha en horario de Buenos Aires, autor UUID, variación firmada, tipo y nota. Perfil no tiene nombre propio; no se consulta Auth administrativo para mostrar autores.
- Registro de INICIAL positivo, COMPRA positivo (etiqueta «Ingreso de mercadería», sin documento de compra) y AJUSTE positivo/negativo con motivo obligatorio. No hay acciones de VENTA, ANULACION_VENTA ni DEVOLUCION en esta etapa.
- INICIAL debe ser el primer movimiento de un producto, no solamente el primero de ese tipo. Cero inicial no se registra: cero es la ausencia de saldo/movimientos. Productos inactivos conservan historial y no aceptan operaciones nuevas. Un reintento confirmado puede devolverse aun si luego el producto fue desactivado, sin escribir nada nuevo.
- Cantidades distintas de cero, hasta once enteros y tres decimales, coma o punto. No se redondea ni usa punto flotante; se calcula en milésimas con BigInt. Se valida también el límite del saldo DECIMAL(14,3).

## Transacción y concurrencia

Se utiliza una transacción interactiva Prisma con SQL parametrizado únicamente para bloqueos y consultas de existencias; no se instalan funciones privilegiadas ni triggers nuevos.

1. Supabase `getUser()` verifica identidad y se exige el permiso ADMINISTRAR_INVENTARIO en la organización solicitada.
2. Se valida la entrada y se comprueba que las nuevas columnas, CHECK e índices están disponibles. La consulta puede funcionar antes de aplicar la migración; las escrituras se rechazan de forma explícita en ese caso.
3. Dentro de la transacción se vuelve a verificar y bloquea la membresía con FOR SHARE, evitando bajas/cambios de rol durante la escritura.
4. Un advisory lock transaccional derivado de organización y clave serializa reintentos, incluso antes de que exista el movimiento. Colisiones del hash solo serializan operaciones adicionales; no permiten identificarlas como iguales. La restricción única persistida es la garantía definitiva de la clave.
5. Si existe la clave, se compara la huella SHA-256 de organización, autor verificado, producto, tipo, variación decimal canónica y nota normalizada. Mismos datos retornan el ID ya confirmado sin modificar el saldo. Datos distintos (incluido autor/producto distinto) se rechazan.
6. FOR UPDATE sobre Producto serializa operaciones por producto, incluso sin fila de saldo, y se comprueba estado y regla INICIAL. Luego se crea el saldo cero si falta y se bloquea con FOR UPDATE.
7. Antes de escribir se verifica que el saldo coincida con la suma del historial. Se calcula el siguiente saldo exacto y se rechazan negativos/desbordamientos.
8. Se inserta MovimientoStock y se actualiza SaldoStock dentro de la misma transacción. Cualquier fallo revierte también el saldo recién creado. Los locks se liberan al commit/rollback.

No se actualiza ni elimina un movimiento desde la aplicación. Corregir un error requiere un AJUSTE nuevo con motivo. La conservación del historial comercial no depende de borrar productos o miembros.

## Seguridad

PROPIETARIO y ADMINISTRADOR registran movimientos; EMPLEADO consulta. Cada llamada del servicio verifica la sesión y membresía, incluyendo reintentos. Organización, usuario y rol de escritura provienen del contexto autenticado. El ID de producto y la organización solicitada son entradas no confiables: se validan y todas las operaciones se limitan a la organización autorizada. Las FK compuestas mantienen el aislamiento estructural del producto y del autor.

No hay endpoint ni formulario para editar SaldoStock directamente. La API Supabase continúa sin acceso directo a tablas propias. Prisma local usa un rol con BYPASSRLS: los permisos del servidor y filtros son obligatorios; falta desplegar el rol de mínimos privilegios documentado en la etapa 5. No se afirma que Prisma validate o RLS por sí solos protejan el sistema.

## Idempotencia del formulario

El servidor genera una clave UUID para el formulario. Se conserva durante errores y reintentos del mismo formulario. Tras confirmar una operación, sus campos quedan bloqueados y «Nuevo movimiento» genera otra clave. La misma clave no se puede reutilizar para una operación distinta. Recargar/cerrar la página pierde el borrador: antes de repetir una operación con otra clave se debe consultar el historial. La persistencia de borradores entre recargas queda pendiente; no se promete deduplicación de solicitudes con claves diferentes.

## Pruebas y uso

`npm run test:inventario:local` verifica con Prisma y Supabase Auth reales, en Docker local, transacciones, precisión, inicial único, concurrencia, rollback, idempotencia, integridad saldo/historial, roles, aislamiento y CHECK. Crea usuarios con contraseñas aleatorias solo en memoria y organizaciones exclusivas; en finally elimina únicamente esas fixtures, no historial real.

`npm run test:inventario:local -- --http` añade comprobaciones de Next en 127.0.0.1:3000, incluido el envío hidratado a Server Actions y su reintento. Requiere `npm run dev:local` activo. No prueba envíos sin JavaScript ni sustituye revisión visual del navegador.

Si `supabase status` se bloquea, se puede usar `npm run test:inventario:local -- --http --docker` y `npm run dev:local -- --docker`. La alternativa inspecciona los contenedores db/kong/studio del proyecto, verifica sus nombres, estado y puertos 54322/54321, y reutiliza las claves locales de Studio exclusivamente en memoria. Las pruebas además verifican la identidad PostgreSQL mediante una conexión loopback antes de escribir. El arranque Next solo recibe la clave pública y la conexión PostgreSQL exclusiva del servidor; ninguna clave administrativa se transmite al frontend. No imprime Docker inspect ni las variables de los contenedores. La ruta predeterminada con CLI no cambia.

Para probar manualmente: iniciar Supabase local y `npm run dev:local`, iniciar sesión, abrir Inventario desde Dashboard, registrar INICIAL en un producto sin movimientos, ingresar mercadería y ajustar con motivos. Intentar un segundo INICIAL, cantidad cero o ajuste que deje negativo; verificar error sin alteración del saldo. Abrir su historial y confirmar autor/variaciones. Usar filtros y comprobar que un EMPLEADO ve stock/historial sin formulario.

## Validaciones ejecutadas

- Nueva migración aplicada mediante `npx prisma migrate deploy --config prisma.local.config.ts`, con las guardas del script y autorización explícita del usuario: salida 0. Dos migraciones registradas; ambas coinciden con el checksum de su archivo, incluida la inicial intacta.
- `npx prisma validate --config prisma.local.config.ts`: salida 0.
- `npx prisma format --check --config prisma.local.config.ts`: salida 0.
- `npx prisma generate --config prisma.local.config.ts`: salida 0, cliente 7.10.0.
- `npx tsc --noEmit`: salida 0.
- `npx eslint .`: salida 0, sin errores ni advertencias en la validación final.
- `npm run test:auth`: 9 pruebas aprobadas, salida 0.
- `npm run test:inventario:local`: 24 comprobaciones del servicio aprobadas, salida 0.
- `node --import ./scripts/resolve-typescript.mjs scripts/probar-inventario-local.mjs --http --docker`: 27 comprobaciones aprobadas, salida 0. Incluye las del servicio más renderizado, autorización HTTP, envío real a Server Action y reintento.
- La verificación final encontró cero organizaciones/usuarios ficticios de inventario restantes.

Las primeras pruebas HTTP tuvieron un timeout durante la compilación inicial. Una segunda consulta de Supabase CLI quedó bloqueada y se canceló, sin escribir datos. La alternativa Docker inicial rechazó una configuración incompleta porque las claves estaban en Studio y no en Kong; se corrigió la inspección para reutilizar las claves existentes, sin inventarlas. Después de regenerar Prisma Client fue necesario reiniciar Next, que conservaba su instancia anterior; la prueba HTTP de escritura pasó tras el reinicio. Next sigue avisando de filesystem lento y de `partialPrefetching` no configurado; Node muestra la advertencia heredada de paquete sin `type: module`. No se cambiaron dependencias ni configuración global para ocultarlas.

## Archivos de esta etapa

Creados:

- `app/inventario/page.tsx` y `app/inventario/actions.ts`.
- `components/inventario/formulario.tsx`.
- `lib/inventario/service.ts` y `lib/inventario/server.ts`.
- `prisma/migrations/20261013000000_inventario_idempotente/migration.sql`.
- `scripts/probar-inventario-local.mjs`, `scripts/migrar-inventario-local.mjs` y `scripts/docker-local-target.mjs`.
- `docs/etapa-7-inventario.md` y `docs/etapa-7-inventario-migracion.sql.draft`.

Modificados:

- `prisma/schema.prisma`: clave, huella e índice de idempotencia de MovimientoStock.
- `lib/auth/policy.ts`: permisos de consulta y administración de inventario.
- `app/dashboard/page.tsx`: navegación a Inventario.
- `scripts/dev-local.mjs`: alternativa explícita `--docker` para arranque verificado local.
- `package.json`: comando de pruebas de inventario, sin cambios de dependencias.

Los archivos de productos que pudieran seguir sin commit pertenecen a la etapa 6; no se reimplementaron en esta etapa.

## Límites

La paginación por offset puede cambiar con inserciones simultáneas. Las consultas de listado e historial no constituyen un único snapshot transaccional. Las futuras ventas/compras/devoluciones deben respetar el mismo protocolo de bloqueo y actualización atómica; ningún escritor paralelo debe modificar saldos directamente. La comprobación de suma del historial por escritura puede necesitar optimización con mucho volumen. Los CHECK/índices personalizados deben preservarse y revisarse al generar futuras migraciones Prisma. Antes de aplicar en cualquier entorno con movimientos existentes hace falta una transición explícita; esta etapa no hace backfill ficticio ni borra historial para migrar.
