# Etapa 10: nombre obligatorio de perfil e histórico de producto en la venta

**Estado: fase 1 y fase 2 aplicadas.** Las cuatro migraciones están aplicadas en la
base local y el esquema guardado (`prisma/schema.prisma` → `Perfil.nombre`/`apellido`
como `String`) está en sincronía con PostgreSQL (`TEXT NOT NULL` más los dos `CHECK`
definitivos). El perfil real (`22fa054c-7a98-47d3-9021-17342a2af17d`) ya tenía sus
nombres cargados, así que la fase 2 no tuvo que inventar ninguno. El cliente Prisma se
regeneró después de aplicar la fase 2. No se modificó ninguna migración anterior, no se
modificaron `prisma.config.ts` ni `prisma.local.config.ts`, no se ejecutaron `migrate
reset`, `db push` ni `migrate dev`, y no se tocó Supabase Cloud. Sin commits.

Las operaciones comerciales exigen un perfil evaluable como `COMPLETO`: `INCOMPLETO` y
también `NO_EVALUABLE` se rechazan con `PERFIL_INCOMPLETO` (fallar cerrado). Con la fase
2 aplicada un `NO_EVALUABLE` no debería ocurrir; se bloquea por las dudas.

El cambio va en **dos fases** porque la base ya tenía un perfil y no existe ningún
origen de nombres reales: imponer `NOT NULL` en la misma migración obligaba a inventar
el nombre de esa persona. Primero se crearon las columnas (§4); los nombres reales los
aporta la persona desde `/perfil/completar` (§6.1); recién entonces se impone
`NOT NULL` (§11).

## 1. Estado real de la base local (por qué son dos fases)

| Dato | Cantidad |
|---|---|
| Perfiles | **1** |
| Usuarios de Supabase Auth | 2 (1 sin perfil) |
| Organizaciones | 1 |
| Miembros | 1 |
| Productos | 3 |
| Saldos de stock | 2 |
| Movimientos | 3 |
| Ventas | 1 |
| Detalles de venta | 1 |
| Devoluciones | 0 |

**No existe ningún origen de nombres reales.** `auth.users` solo tiene `email`,
`email_verified`, `phone_verified` y `sub`; no hay columna de nombre ni datos de
nombre en `raw_user_meta_data` ni en `identities.identity_data`. Comprobado con
consultas de solo lectura.

Destino verificado: contenedor `supabase_db_stock-manager`
(PostgreSQL 17.11), publicado en `127.0.0.1:54322`, base `postgres`.
`prisma.local.config.ts` rechaza cualquier destino que no sea `loopback:54322/postgres`
y no lee `.env`, así que las credenciales de Supabase Cloud de `.env`
(`DATABASE_URL`/`DIRECT_URL`) no intervienen en ningún comando.

## 2. Cambios

### `Perfil`

| Columna | Tipo | Nulidad | Nota |
|---|---|---|---|
| `nombre` | `TEXT` | anulable en fase 1; `NOT NULL` en fase 2 | Lo aporta la persona |
| `apellido` | `TEXT` | anulable en fase 1; `NOT NULL` en fase 2 | Lo aporta la persona |

Sin `DEFAULT`: la base nunca inventa un valor.

### `DetalleVenta`

| Columna | Tipo | Nulidad | Nota |
|---|---|---|---|
| `nombreProducto` | `TEXT` | `NULL` (permanente) | Nombre al momento de la venta |
| `skuProducto` | `TEXT` | `NULL` (permanente) | SKU al momento de la venta |

**Las ventas anteriores quedan en `NULL` y no se rellenan.** Copiar el nombre actual
del catálogo afirmaría algo sobre el pasado que no se puede verificar: el producto
pudo cambiar de nombre o de SKU después de la venta. `NULL` es la marca de "venta
anterior a la etapa 10", no un dato perdido.

### Restricciones

| Restricción | Alcance | Qué rechaza |
|---|---|---|
| `Perfil_nombre_no_vacio` | `Perfil.nombre` | cadena vacía y cadena solo de espacios |
| `Perfil_apellido_no_vacio` | `Perfil.apellido` | cadena vacía y cadena solo de espacios |
| `DetalleVenta_nombreProducto_no_vacio` | `DetalleVenta.nombreProducto` | vacío o solo espacios **cuando tiene contenido**; `NULL` permitido |
| `DetalleVenta_skuProducto_no_vacio` | `DetalleVenta.skuProducto` | igual que la anterior |
| `DetalleVenta_historico_coherente` | `DetalleVenta` | nombre y SKU **uno solo** de los dos: tienen que ser los dos `NULL` o los dos con contenido |

Todas usan `~ '[^[:space:]]'`, que exige al menos un carácter que no sea espacio en
blanco: cubre espacio, tabulación, salto de línea, retorno de carro, `\v` y `\f`.
Las de `Perfil` están escritas como `IS NULL OR ...` en la fase 1 para ser válidas
mientras la columna es anulable; **la fase 2 las reemplaza por su forma definitiva**
(`CHECK ("nombre" ~ '[^[:space:]]')`) junto con `NOT NULL`, para que la definición
guardada no sugiera que `NULL` es posible. El conjunto de valores rechazados no
cambia. Las de `DetalleVenta` quedan como están, porque esas columnas siguen siendo
anulables a propósito.

`DetalleVenta_historico_coherente` se define como
`CHECK (("nombreProducto" IS NULL) = ("skuProducto" IS NULL))`: la comparación de dos
booleanos nunca da `NULL`, así que la fila histórica actual (`NULL`/`NULL`) cumple.

### Decisiones deliberadas

- **Sin límite de longitud.** No se pidió y un tope arbitrario podría rechazar
  nombres legítimos.
- **Sin `DEFAULT`** en ninguna de las cuatro columnas.
- **`apellido` no admite cadena vacía.** Una persona con un solo nombre tendrá que
  escribir algo en el apellido. Es consecuencia directa de exigir ambos obligatorios
  y no vacíos.
- La fase 2 **no toca `DetalleVenta`**.

## 3. Sincronía entre `prisma/schema.prisma` y PostgreSQL

| Momento | `Perfil.nombre` / `apellido` en PostgreSQL | En `prisma/schema.prisma` | En sincronía |
|---|---|---|---|
| **Estado actual (fases 1 y 2 aplicadas)** | `TEXT NOT NULL` + `CHECK` de no vacío | `String` | **sí** |

`DetalleVenta.nombreProducto` / `skuProducto` quedan `String?` en el esquema y
anulables en la base para siempre: nunca hay divergencia. La fase 1 no modifica la
nulidad de ninguna columna existente.

**No regenerar el cliente todavía.** `src/generated/prisma/` (en `.gitignore`) hoy
contiene un cliente generado contra el esquema viejo. Si se ejecuta
`npx prisma generate` **antes** de aplicar la fase 1, el cliente va a pedir
`DetalleVenta."nombreProducto"` y `DetalleVenta."skuProducto"`, que no existen, y el
detalle de venta (`lib/ventas/service.ts`) va a fallar en tiempo de ejecución con
"column does not exist" (SQLSTATE 42703). Por eso no se ejecutó `generate` ni
`scripts/validar-prisma-local.mjs`, que lo incluye entre sus pasos. Después de la
fase 1, regenerar es seguro.

`lib/auth/perfil.ts` es la única pieza de código que lee `Perfil` vía Prisma
(`findUnique` sin `select`). Está escrito para funcionar con las dos generaciones del
cliente: mientras el cliente no conozca `nombre`/`apellido`, sus claves no llegan en la
fila y la evaluación del perfil es `NO_EVALUABLE` (no bloquea a nadie). Al regenerar el
cliente después de la fase 1, la regla del perfil incompleto (§6) queda activa sin
tocar código.

## 4. Comandos exactos

### Fase 1 — aplicar la migración creada (**ya aplicada**)

Estado: aplicada sobre la base local. Tres migraciones aplicadas, la última
`20261017000000_perfil_nombre_y_detalle_historico` con
`applied_steps_count = 1`; los recuentos de datos no cambiaron (1 perfil, 1 detalle…).
Los comandos de abajo quedan como registro de lo que se ejecutó (y sirven para
`migrate status`).

Antes: ver los recuentos reales (solo lectura; deben dar 1 y 1, y no debe haber
otra migración pendiente más que la de la etapa 10):

```sql
SELECT count(*) AS perfiles FROM public."Perfil";
SELECT count(*) AS detalles FROM public."DetalleVenta";
```

**No usar `scripts/aplicar-migracion-local.mjs`**: ese script exige una base vacía y
aborta con datos existentes.

Aplicar (el comando imprime el destino verificado y no expone la contraseña; para
solo mirar, cambiar `migrate deploy` por `migrate status`):

```powershell
node --input-type=module -e "const {spawnSync}=await import('node:child_process');const {dockerLocalTarget}=await import('./scripts/docker-local-target.mjs');const t=dockerLocalTarget();console.log('Destino:',JSON.stringify(t.safe));const r=spawnSync('npx prisma migrate deploy --config prisma.local.config.ts',{stdio:'inherit',shell:true,env:{...process.env,LOCAL_DATABASE_URL:t.url}});process.exit(r.status??1)"
```

Esperado: `Destino: {"host":"127.0.0.1","port":"54322",...}` y una sola migración
aplicada (`20261017000000_perfil_nombre_y_detalle_historico`).

Comprobar después (debe dar `0` y mostrar las 5 restricciones):

```sql
SELECT count(*) FROM public."DetalleVenta" WHERE ("nombreProducto" IS NULL) <> ("skuProducto" IS NULL);
SELECT conname FROM pg_constraint
 WHERE conname IN ('Perfil_nombre_no_vacio','Perfil_apellido_no_vacio',
                   'DetalleVenta_nombreProducto_no_vacio','DetalleVenta_skuProducto_no_vacio',
                   'DetalleVenta_historico_coherente');
SELECT id, "nombre", "apellido" FROM public."Perfil" ORDER BY "creadoEn";
```

La fase 1 dejó los `nombre`/`apellido` del perfil existente en `NULL`. Con el cliente ya
regenerado, ese perfil queda `INCOMPLETO`: puede consultar todo, pero no puede registrar
ventas ni administrar productos, inventario u organización hasta completar sus datos en
`/perfil/completar` (§6.1).

**Regenerar el cliente se hizo a partir de acá** (antes no, §3). Con eso el detalle de
venta puede leer `nombreProducto`/`skuProducto` y la regla del perfil incompleto quedó
activa. El comando exacto que se ejecutó fue:

```powershell
node --input-type=module -e "const {spawnSync}=await import('node:child_process');const {dockerLocalTarget}=await import('./scripts/docker-local-target.mjs');const t=dockerLocalTarget();const r=spawnSync('npx prisma generate --config prisma.local.config.ts',{stdio:'inherit',shell:true,env:{...process.env,LOCAL_DATABASE_URL:t.url}});process.exit(r.status??1)"
```

**Regenerar el cliente ya se hizo** (después de aplicar la fase 1). El cliente generado
(7.10.0) conoce `nombre`/`apellido`, así que la regla del perfil incompleto está activa
y el detalle de venta puede leer `nombreProducto`/`skuProducto`. Se regeneró **después**
de aplicar la fase 1: hacerlo antes habría roto el detalle de venta con
"column does not exist" (SQLSTATE 42703).

### Fase 2 — cargar los nombres reales e imponer `NOT NULL`

**Paso 1. Cargar los nombres reales desde la interfaz.** Los aporta la persona; no se
derivan del correo ni se usan valores de relleno. El único perfil existente hoy es
`22fa054c-7a98-47d3-9021-17342a2af17d`, y hoy está `INCOMPLETO`:

1. Iniciar sesión con esa cuenta y entrar a `/perfil/completar` (o usar el enlace
   "Completar mi perfil" del aviso).
2. Escribir el nombre y el apellido reales y guardar. La identidad la resuelve la
   sesión; no hay ningún id en el formulario.
3. Comprobar en la base que quedó escrito (`SELECT id, "nombre", "apellido" FROM
   public."Perfil" ORDER BY "creadoEn";`) y que la cuenta recuperó los permisos
   comerciales (registrar una venta o un movimiento de prueba desde la interfaz).

El `UPDATE` con SQL directo sirve si la persona no puede entrar; es el mismo efecto,
pero por fuera de la aplicación:

```sql
SELECT id, "nombre", "apellido" FROM public."Perfil" ORDER BY "creadoEn";

UPDATE public."Perfil"
   SET "nombre" = '<nombre real>', "apellido" = '<apellido real>'
 WHERE id = '<uuid del perfil>';
```

**Paso 2. Verificar que no queda ninguno pendiente.** Las cuatro consultas del
encabezado de `docs/etapa-10-perfil-nombre-obligatorio.sql.draft` deben dar `0`.

**Paso 3. Convertir el borrador en migración** (recién ahora: si la fase 1 no estuviera
aplicada, `migrate deploy` la tomaría junto con la fase 2 y fallaría con los perfiles
sin nombre):

```powershell
New-Item -ItemType Directory prisma\migrations\20261018000000_perfil_nombre_obligatorio
Copy-Item docs\etapa-10-perfil-nombre-obligatorio.sql.draft `
          prisma\migrations\20261018000000_perfil_nombre_obligatorio\migration.sql
```

Y en `prisma/schema.prisma`, pasar `nombre` y `apellido` de `String?` a `String`
(es el mismo commit que el `ALTER COLUMN`).

**Paso 4. Aplicar** (mismo comando que la fase 1) y **recién entonces**
`npx prisma generate`.

**Paso 5.** `scripts/seed-local.mjs` y los scripts `probar-*-local.mjs` **ya están
actualizados** y funcionan con las dos estructuras (§5). No hace falta tocarlos de
nuevo: el seed escribe los nombres cuando las columnas existen, y las pruebas ya crean
usuarios ficticios con nombre y apellido explícitos.

## 5. Registro de nuevos usuarios, seed y pruebas

### 5.1 Formulario de registro

`components/sign-up-form.tsx` pide **Nombre** y **Apellido** como campos obligatorios
(además de email y contraseña), con `required` en el formulario y una validación
explícita que rechaza vacío y solo-espacios (`trim`, que también recorta el espacio
duro `U+00A0`, el mismo caso que rechaza el `CHECK` de la base).

Los valores se envían en `options.data` de `supabase.auth.signUp` y quedan en
`auth.users.raw_user_meta_data`. Es el único lugar donde el registro los puede
guardar: `public."Perfil"` no es escribible desde el cliente (`GRANT` revocado y RLS
para el rol de API).

**La metadata es solo el registro de lo que declaró la persona, no la fuente de
verdad.** La fuente de verdad es `public."Perfil"`, y nadie puede escribirla desde el
navegador (no hay Server Action que reciba un id de usuario). El camino automático está
contado en §6.2: el registro valida la metadata con el mismo esquema Zod y la copia a
`public."Perfil"`, y si el alta queda pendiente de confirmar por correo, lo hace
`/auth/confirm` al confirmar. El registro **no depende exclusivamente** de la metadata:
si falta, está incompleta o es inválida, no se escribe nada y la persona completa sus
datos en `/perfil/completar`, que precarga lo que haya declarado.

### 5.2 Seed

`scripts/seed-local.mjs` (`seedLocalOrganization`) recibe los datos de la persona como
**quinto parámetro obligatorio** `{ nombre, apellido }` y los exige con el mismo
criterio que los `CHECK` (`/\S/`, que también excluye el espacio duro `U+00A0`). Sin
ellos lanza un error explícito que no inventa ni deriva nada, y que señala dónde ver los
valores declarados en el registro:

```powershell
npm run seed:local -- --email <email-local> --nombre <nombre> --apellido <apellido>
```

La estructura desplegada se detecta con una consulta al catálogo
(`information_schema.columns`), nunca interpretando un mensaje de error:

| Estructura | Perfil | Nombres |
|---|---|---|
| Sin fase 1 (hoy) | se crea como antes (`id`) | no se pierden: quedan en la metadata de Auth; el seed lo avisa por consola |
| Con fase 1 | se crea o se completa | `INSERT ... ON CONFLICT (id) DO UPDATE` escribe `nombre` y `apellido` |
| Con fase 2 | igual que con fase 1 | los nombres son obligatorios y no vacíos |

El `ON CONFLICT (id) DO UPDATE` también **completa un perfil preexistente** creado
antes de la fase 1 (el caso del perfil actual), sin duplicar filas, y es idempotente:
repetir el seed con los mismos valores deja una sola fila con esos valores.

### 5.3 Pruebas locales

Los fixtures `probar-auth`, `probar-dashboard`, `probar-ventas`, `probar-productos`,
`probar-inventario` y `probar-migracion` crean los perfiles con nombres ficticios
explícitos (`Prueba` + el nombre de la suite: `Auth`, `Dashboard`, `Ventas`, …). No se
derivan del correo y no son valores de relleno para personas reales. El fixture de Auth
además crea las cuentas con `user_metadata: { nombre, apellido }`, igual que el
formulario, y comprueba que esos valores quedan guardados en la metadata.

## 6. Perfiles sin completar: sin operaciones comerciales

Un perfil a medio cargar (nombre o apellido en `NULL`, vacío o solo espacios) **no puede
operar sobre datos comerciales**, porque toda operación queda registrada a nombre de esa
persona.

- `lib/auth/policy.ts`: nuevo código `PERFIL_INCOMPLETO` y el conjunto
  `PERMISOS_COMERCIALES` = `ADMINISTRAR_ORGANIZACION`, `ADMINISTRAR_PRODUCTOS`,
  `ADMINISTRAR_INVENTARIO`, `REGISTRAR_VENTAS`. `exigirOrganizacion` evalúa el perfil
  **solo** para esos permisos y **después** de validar sesión, membresía y rol: sin
  sesión, sin membresía o con rol insuficiente el error sigue siendo el de siempre.
- Consultar (`VER_DASHBOARD`, `VER_PRODUCTOS`, `VER_INVENTARIO`, `VER_VENTAS`) sigue
  permitido: la persona puede entrar y ver que le falta completar sus datos.
- `lib/auth/perfil.ts`: lee el perfil con Prisma y decide entre `COMPLETO`,
  `INCOMPLETO` y `NO_EVALUABLE`.
- La distinción es estructural: si la fila **no trae las claves** `nombre`/`apellido`
  (la columna todavía no existe, o el cliente generado aún no la conoce) es
  `NO_EVALUABLE`; tras la fase 2 no debería ocurrir y, por las dudas, las operaciones
  comerciales lo tratan igual que `INCOMPLETO` (solo `COMPLETO` autoriza escrituras). Si
  la columna existe y el valor es `NULL`, es `INCOMPLETO` y también bloquea. Nunca se
  detecta la versión del esquema por el mensaje de un error, y no hay ningún `catch` que
  oculte errores de base de datos.

| Momento | Efecto |
|---|---|
| Fase 1 sin aplicar | `NO_EVALUABLE`: no bloquea a nadie (estado anterior) |
| **Fases 1 y 2 aplicadas (estado actual)** | **solo `COMPLETO` autoriza escrituras**: `INCOMPLETO` y `NO_EVALUABLE` se rechazan con `PERFIL_INCOMPLETO`; además no puede existir un perfil sin nombres |

### 6.1 Aviso y pantalla para completar el perfil

`app/perfil/completar/page.tsx` (con `components/perfil/formulario.tsx` y la Server
Action `app/perfil/actions.ts`) es el camino para cargar el nombre y el apellido. Sus
reglas:

- **La identidad sale exclusivamente de la sesión autenticada de Supabase Auth.**
  `guardarPerfilDeSesion` (`lib/auth/server.ts`) resuelve el usuario con
  `obtenerUsuarioAutenticado` y escribe **esa** fila. El formulario no envía ningún id:
  si alguien agrega `usuarioId`, `id` o `email` al `FormData`, se ignoran (probado en el
  fixture).
- **Validación con Zod** (`lib/auth/perfil-reglas.ts`, módulo puro sin acceso a datos):
  `trim`, obligatorio, máximo 80 caracteres y `refine(/\S/)`, con el mismo criterio que
  los `CHECK` de PostgreSQL (el `\S` de JavaScript también excluye el espacio duro
  `U+00A0`). Vacío, solo espacios, tipos ajenos y textos demasiado largos se rechazan
  **antes** de tocar la base y el formulario muestra el error por campo.
- **Se actualiza solo el `Perfil` de la persona autenticada.** Es un `upsert` por clave
  primaria (`id` = usuario): si la fila no existe se crea, y si existe se actualiza sin
  duplicarla. Como `Perfil.id` es `FK` a `auth.users(id)`, nunca puede quedar una fila
  colgando ni crearse un perfil para una cuenta inexistente.
- Al guardar redirige al panel. **El aviso** con el enlace directo aparece en
  `NavPrincipal` (shell de las cinco pantallas privadas: panel, productos, inventario,
  ventas y detalle de venta) y también en la pantalla "Acceso restringido" del panel.
  Se calcula con `estadoPerfilDeUsuario(context.user.id)`, sin repetir la consulta a
  Auth.
- La pantalla de ventas no arma el formulario de venta cuando el perfil está
  incompleto: el catálogo inicial se pide con `REGISTRAR_VENTAS`, que exige el perfil
  completo. El historial y la consulta siguen disponibles.

### 6.2 Registro: los nombres declarados llegan a PostgreSQL

El registro escribe en **la misma** pieza de código (`guardarPerfil` en
`lib/auth/perfil.ts`), desde **dos** puntos de entrada, los dos del lado del servidor y
los dos con la identidad resuelta por Supabase Auth:

| Momento | Quién escribe | Cuándo |
|---|---|---|
| El alta ya devolvió sesión | Server Action `completarPerfilDeRegistro` (`app/auth/actions.ts`), invocada por `components/sign-up-form.tsx` después de `signUp` | Camino normal en local (`enable_confirmations = false`) |
| El alta espera confirmación por correo | `completarPerfilDeUsuario` desde `app/auth/confirm/route.ts`, después de `verifyOtp`/`exchangeCodeForSession` | Cuando la sesión todavía no estaba disponible al registrarse |

`completarPerfilDesdeMetadata` **no sobrescribe nunca un perfil completo** (si la
persona ya cargó sus datos, esos mandan) y es idempotente. Si la metadata no trae
nombres válidos, no crea la fila y devuelve `INCOMPLETO`: la persona los carga en
`/perfil/completar` y ahí quedan precargados lo que sí haya declarado.

**Errores parciales.** Si la escritura del perfil falla cuando la cuenta ya se creó y la
sesión está abierta, no se pierde nada: el alta redirige a `/perfil/completar?aviso=1`,
que avisa que hay que guardar los datos a mano, y la confirmación por correo hace lo
mismo si la escritura falla después de confirmar. En los dos casos el error se registra
en el log del servidor (`console.error`); ninguno de los dos caminos da por exitoso algo
que no se escribió.

**El registro no otorga nada más.** Comprobado en el fixture: completar el perfil no
crea organizaciones, ni membresías, ni permisos; sin membresía se sigue rechazando con
`SIN_ORGANIZACION`.

## 7. Riesgos

| Riesgo | Alcance | Mitigación |
|---|---|---|
| Regenerar el cliente antes de aplicar la fase 1 | Rompe el detalle de venta en tiempo de ejecución | No ejecutar `generate` ni `validar-prisma-local.mjs` hasta aplicar la fase 1 |
| Aplicar la fase 2 con perfiles sin datos | Falla la transacción, no corrompe datos | Las cuatro consultas de control deben dar `0` antes |
| Crear la migración de la fase 2 antes de la fase 1 | `migrate deploy` aplica todas las pendientes y fallaría | La fase 2 se mantiene como borrador fuera de `prisma/migrations/` |
| Bloqueo de tabla durante los `ALTER TABLE` | Muy bajo: 1 fila por tabla, `SET LOCAL lock_timeout = '5s'` | Ya presente en los dos SQL |
| Usuarios nuevos sin nombre | Después de la fase 2, el `INSERT` del `Perfil` falla | El seed exige `{ nombre, apellido }` y los fixtures ya los pasan (§5) |
| Perfil a medio cargar entre la fase 1 y la fase 2 | La persona podría ver bloqueadas las ventas | Para eso está `/perfil/completar` (§6.1) con el aviso y el enlace directo; y la regla del perfil incompleto (§6) impide operar comercialmente sin nombre |
| Escritura del perfil fallida justo después del alta | La cuenta existe pero el nombre no queda escrito | El alta redirige a `/perfil/completar?aviso=1` y lo registra en el log; la persona lo guarda a mano (§6.2) |
| `probar-migracion-local.mjs` desactualizado | Solo corre sobre base vacía con **todas** las migraciones: ya hoy es inservible (afirma 1 migración) | Sus expectativas de historia y de conteo de CHECK se revisan al aplicar la etapa 10; sus `INSERT` de `Perfil` ya llevan nombres |

## 8. Lo que este cambio NO hace

- No crea ninguna tabla nueva (en particular, no crea `AuditoriaVenta`).
- No toca `MovimientoStock`, `Venta`, `Producto`, `SaldoStock` ni las tablas de
  devoluciones.
- No rellena `DetalleVenta` con datos del catálogo actual.
- No deriva ni inventa nombres, ni usa valores predeterminados.
- No agrega `DEFAULT` ni límites de longitud en la base de datos. El tope de 80
  caracteres de §6.1 es validación de la aplicación, no una restricción de PostgreSQL.
- No agrega índices: ninguna consulta nueva los necesita.
- No modifica RLS ni privilegios. Las columnas nuevas heredan la protección de su
  tabla. Nota para el futuro: si algún día se reemplaza el rol de ejecución por uno
  con `GRANT` por columna, hay que incluir estas cuatro.
- No modifica `auth.users`: el nombre y el apellido de una persona nueva quedan en su
  metadata, y `Perfil` sigue siendo la fuente de verdad del sistema.

## 9. Validaciones ejecutadas

- `npx prisma validate --config prisma.local.config.ts`: **exit 0**,
  "The schema at prisma\schema.prisma is valid".
- `npx prisma format --check --config prisma.local.config.ts`: **exit 0**,
  "All files are formatted correctly!".
- `npx prisma migrate status --config prisma.local.config.ts`: **"Database schema is up
  to date!"**, 3 migraciones aplicadas, incluida
  `20261017000000_perfil_nombre_y_detalle_historico`. Confirma el destino:
  `127.0.0.1:54322`.
- `npx tsc --noEmit`: exit 0.
- `npx eslint .`: exit 0.
- `node --test tests/authorization.test.mjs`: **14 casos aprobados, 0 fallos**
  (incluye los 5 nuevos del perfil incompleto y `evaluarPerfilDesdeFila`).
- `node --test tests/perfil.test.mjs` (`npm run test:perfil`): **8 casos aprobados, 0
  fallos** (nuevo): recorte de espacios, obligatoriedad, solo espacios (incluye espacio
  duro y tabulación), tipos que no son texto, máximo de longitud, y `nombresDeMetadata`
  (toma los nombres declarados, rechaza lo inválido y **ignora** las claves ajenas que
  trae la metadata real de Auth: `sub`, `email`, `email_verified`…).
- `node --test tests/dashboard.test.mjs`: **16 casos aprobados, 0 fallos**.
- Las 6 suites locales contra la estructura **con la fase 1 aplicada y el cliente
  regenerado**:
  `probar-auth-local.mjs` **12/12**, `probar-dashboard-local.mjs` **10/10**,
  `probar-productos-local.mjs` **16/16**, `probar-inventario-local.mjs` **24/24**,
  `probar-ventas-local.mjs` **22/22** y la misma suite con `--http` **26/26** (esta
  última ejerce de verdad el camino del servidor Next: Server Actions →
  `exigirOrganizacion` con `REGISTRAR_VENTAS` → `evaluarPerfilConPrisma`).
- `probar-perfil-local.mjs` (`npm run test:perfil:local`): **23 comprobaciones
  aprobadas, 0 fallos** (nuevo). Detalle en §9.1.

### 9.1 Cobertura de `probar-perfil-local.mjs`

23 comprobaciones, todas con usuarios ficticios explícitos que se borran al terminar
(el fixture limpia sus organizaciones, productos, ventas, movimientos, perfiles y
cuentas de Auth; los recuentos de la base quedan iguales):

1. Sin fila previa, `guardarPerfil` crea el `Perfil` propio con los valores recortados.
2. Guardar dos veces actualiza la misma fila, sin duplicar el perfil.
3. Vacíos, solo espacios, tipos ajenos y textos demasiado largos: rechazados **sin
   escribir** (la fila queda byte a byte igual).
4. Guardar el perfil propio no modifica el de otra persona.
5. Sin cuenta de Auth no se puede crear un perfil (la relación `FK` se respeta).
6. Registro: el perfil ausente se crea con los nombres declarados en la metadata.
7. Registro repetible: no sobrescribe un perfil ya completo.
8. Un perfil incompleto (columnas en `NULL`) se completa con la metadata sin crear
   filas nuevas.
9. Metadata sin nombres utilizables (ausente, `null`, incompleta, vacía, solo espacios,
   demasiado larga, no textual): no crea el perfil y **no inventa valores**.
10. Completar el perfil no otorga organización, membresía ni permisos (sin membresía
    sigue siendo `SIN_ORGANIZACION`).
11. **Perfil incompleto: las cuatro operaciones comerciales se rechazan con
    `PERFIL_INCOMPLETO` y no escriben nada** (ni venta, ni movimiento, ni producto); las
    cuatro consultas siguen permitidas.
12. El panel muestra el aviso con el enlace directo a `/perfil/completar`.
13. El aviso aparece también en productos, inventario y ventas.
14. Sin sesión, `/perfil/completar` redirige a `/auth/login`.
15. La pantalla pide `nombre` y `apellido` y precarga lo declarado en el registro.
16. **Por HTTP**: vacíos y solo espacios rechazados por la Server Action, sin escribir.
17. **Por HTTP: el `id` que manda el formulario se ignora**; con la sesión de A y los
    campos `usuarioId`/`id`/`email` de B, se escribe el perfil de A y el de B queda
    intacto.
18. Completar el perfil devuelve los cuatro permisos comerciales.
19. Con el perfil completo vuelven a funcionar ventas, inventario y productos (se
    registra una venta y un movimiento de verdad).
20. Con el perfil completo el aviso desaparece.
21. Otra persona no ve el perfil ajeno ni datos de la otra organización.
22. Confirmar el correo (`/auth/confirm` con un enlace real de *magic link* del Auth
    local) deja el perfil escrito en PostgreSQL con los nombres declarados.
23. **Por HTTP**: la Server Action del alta
    (`completarPerfilDeRegistro`, con la sesión de un usuario recién creado cuya fila
    todavía no existe) escribe los nombres en PostgreSQL y no solo en la metadata.

En todas las respuestas HTTP el fixture comprueba además que no se filtran la clave de
administración ni la cadena de conexión.

### Prueba de compatibilidad de la fase 1 contra los datos reales

El SQL de la migración se ejecutó completo dentro de una transacción terminada en
`ROLLBACK`, sobre la base local con sus datos reales. Resultado: **15 casos, 0
fallos**.

- Las 4 sentencias `ALTER TABLE` pasan; se crean las 4 columnas (las 4 anulables) y
  las 5 restricciones; la definición guardada de la coherencia es
  `CHECK ((("nombreProducto" IS NULL) = ("skuProducto" IS NULL)))`.
- Los 1 perfil, 1 venta y 1 detalle existentes se conservan; el detalle queda en
  `NULL`/`NULL`.
- Se aceptan: ambos `NULL`, ambos con contenido, contenido con espacios externos,
  `nombre`/`apellido` completos, `NULL` en `Perfil` (fase 1).
- Se rechazan con `23514`: `nombre` sin `sku` y `sku` sin `nombre` (coherencia),
  vacío, solo espacios, tabulación + salto de línea, espacio duro `U+00A0`, y
  `sku` solo espacios.
- Después del `ROLLBACK` se verificó que la base quedó intacta: `Perfil` = `id,
  creadoEn`; `DetalleVenta` = 7 columnas; 0 columnas nuevas; 0 restricciones nuevas;
  2 migraciones aplicadas; recuentos 1 perfil / 1 detalle / 2 usuarios de Auth.

### Prueba encadenada de la fase 2

Aplicando la fase 1, cargando `nombre`/`apellido` y ejecutando el borrador de la fase
2, también en una transacción revertida: **8 casos, 0 fallos**. `nombre` y `apellido`
quedan `NOT NULL`, las restricciones quedan en su forma definitiva
(`CHECK ((nombre ~ '[^[:space:]]'::text))`), `NULL` se rechaza con `23502`, y
`DetalleVenta` sigue aceptando `NULL`/`NULL` y rechazando la incoherencia.

### Compatibilidad del `INSERT` del seed con las tres estructuras

El statement exacto que usa `scripts/seed-local.mjs`
(`INSERT ... ON CONFLICT (id) DO UPDATE SET "nombre"=EXCLUDED."nombre", ...`) se
ejecutó contra las tres estructuras dentro de una transacción terminada en `ROLLBACK`:

- **Antes de la fase 1:** el perfil se crea con el `id` (camino transitorio del seed).
- **Con la fase 1:** el mismo statement **completa sin duplicar** el perfil creado antes
  con solo `id` (1 fila, `Prueba Local`) y crea el nuevo. Repetirlo es idempotente.
- **Con la fase 2:** el mismo statement sigue funcionando con `NOT NULL` (crea y
  actualiza), y un `INSERT` sin nombres se rechaza con `23502`.

### Migraciones anteriores

Los checksums registrados coinciden byte a byte con los archivos:

- `20261012000000_inicial_multiempresa`: `ec6aabc578cbd350a5a8e67f7c7641b12d55bb3de409d8ea74434005bdda3e98`
- `20261013000000_inventario_idempotente`: `22398ce71720f247cbcf3bbb3891f9fbc60a39988a0745ff4e205d3dbfecad0a`

### Validaciones de la fase 2 (aplicada)

Ejecutadas contra la base local (`127.0.0.1:54322`, verificado por Docker y por
`prisma.local.config.ts`), sin `migrate reset`, `db push` ni `migrate dev`:

- **Precondiciones**: las cuatro consultas de control (perfiles sin datos, vacíos,
  detalles incoherentes y restos de prueba) dieron `0`; el único perfil tenía
  `nombre`/`apellido` reales. Recuentos idénticos a §1.
- `npx prisma validate` y `format --check`: exit 0.
- `npx prisma migrate deploy`: aplicó **una sola** migración,
  `20261018000000_perfil_nombre_obligatorio`.
- `npx prisma migrate status`: **"Database schema is up to date!"**, 4 migraciones.
- `information_schema.columns`: `nombre` y `apellido` en `is_nullable = NO`.
- `pg_get_constraintdef`: `Perfil_nombre_no_vacio` y `Perfil_apellido_no_vacio` quedaron
  en su forma definitiva (`CHECK ((nombre ~ '[^[:space:]]'::text))`); las de
  `DetalleVenta` no cambiaron. Recuentos de datos idénticos a §1.
- `npx prisma generate`: cliente 7.10.0 regenerado después de aplicar la fase 2.
- `npx tsc --noEmit` y `npx eslint .`: exit 0.
- Unitarias: `tests/authorization.test.mjs` 14/14 (el caso de `NO_EVALUABLE` ahora exige
  el bloqueo de las cuatro operaciones comerciales y permite las consultas),
  `tests/perfil.test.mjs` 8/8 y `tests/dashboard.test.mjs` 18/18.
- Suites locales: `probar-auth` 12/12, `probar-perfil` 23/23 (reescrito: la fase 2 impide
  crear un perfil sin nombre, así que el bloqueo por perfil no completo se ejerce
  inyectando la evaluación `INCOMPLETO` y `NO_EVALUABLE`), `probar-dashboard` 10/10,
  `probar-productos` 16/16, `probar-inventario` 24/24, `probar-ventas` 22/22 y
  `probar-ventas --http` 26/26.

`probar-migracion-local.mjs` sigue fuera de las suites de la etapa 10: solo corre sobre
base vacía con todas las migraciones y sus expectativas de recuento de migraciones se
revisan por separado.

## 10. Archivos

- `prisma/migrations/20261017000000_perfil_nombre_y_detalle_historico/migration.sql`:
  fase 1, **aplicada** (no modificar).
- `prisma/migrations/20261018000000_perfil_nombre_obligatorio/migration.sql`: fase 2,
  **aplicada** (copia byte a byte de
  `docs/etapa-10-perfil-nombre-obligatorio.sql.draft`; no modificar).
- `prisma/schema.prisma`: `Perfil.nombre` y `Perfil.apellido` como `String` (obligatorios,
  en sincronía con `NOT NULL`), `DetalleVenta.nombreProducto` y `DetalleVenta.skuProducto`
  como `String?`.
- `docs/etapa-10-perfil-nombre-obligatorio.sql.draft`: SQL de la fase 2, aplicado; queda
  como registro.
- `lib/auth/perfil-reglas.ts`: nuevo; reglas puras (solo Zod): `perfilSchema`,
  `PERFIL_CAMPO_MAX` y `nombresDeMetadata`. Lo comparten el formulario del cliente, la
  Server Action y los scripts.
- `lib/auth/perfil.ts`: nuevo; `evaluarPerfilConPrisma`, `guardarPerfil` y
  `completarPerfilDesdeMetadata` (núcleo único de escritura), y reexporta las reglas.
- `lib/auth/server.ts`: vincula `evaluarPerfil` al cliente Prisma real y agrega
  `estadoPerfilDeUsuario`, `guardarPerfilDeSesion`, `perfilDeSesion`,
  `completarPerfilDeUsuario` y `completarPerfilDeSesion`.
- `app/perfil/completar/page.tsx`, `components/perfil/formulario.tsx`,
  `app/perfil/actions.ts`: nuevos; pantalla, formulario y Server Action para cargar el
  nombre y el apellido.
- `components/nav-principal.tsx`: aviso con el enlace a `/perfil/completar`.
- `app/dashboard/page.tsx`, `app/productos/page.tsx`, `app/inventario/page.tsx`,
  `app/ventas/page.tsx`, `app/ventas/[id]/page.tsx`: calculan el estado del perfil y lo
  pasan a la navegación; el panel además enlaza desde "Acceso restringido". La pantalla
  de ventas no arma el formulario de venta sin perfil completo.
- `app/auth/actions.ts`: nuevo; `completarPerfilDeRegistro`, la Server Action que el
  alta usa para escribir los nombres.
- `components/sign-up-form.tsx`: nombre y apellido obligatorios en el registro, y la
  llamada a `completarPerfilDeRegistro` después del alta (con el camino de error
  parcial hacia `/perfil/completar?aviso=1`).
- `app/auth/confirm/route.ts`: escribe los nombres declarados al confirmar la cuenta.
- `lib/auth/policy.ts`: `PERFIL_INCOMPLETO`, `PERMISOS_COMERCIALES`,
  `exigePerfilCompleto`, `evaluarPerfilDesdeFila` y la dependencia `evaluarPerfil`. Con
  la fase 2, las operaciones comerciales fallan cerrado: solo `COMPLETO` las autoriza, de
  modo que `INCOMPLETO` y `NO_EVALUABLE` se rechazan.
- `tests/authorization.test.mjs`: casos del perfil incompleto, lectura permitida,
  `NO_EVALUABLE` (bloquea escrituras, permite consultas), orden de las validaciones y
  `evaluarPerfilDesdeFila`.
- `tests/perfil.test.mjs`: nuevo (§9.1).
- `scripts/probar-perfil-local.mjs`: nuevo (§9.1); reescrito para la fase 2: verifica que
  la base rechaza un perfil sin nombre y ejerce el bloqueo inyectando `INCOMPLETO` y
  `NO_EVALUABLE`.
- `package.json`: scripts `test:perfil` y `test:perfil:local`.
- `scripts/seed-local.mjs`: `{ nombre, apellido }` obligatorio, detección por catálogo y
  escritura de los nombres cuando las columnas existen.
- `scripts/probar-auth-local.mjs`, `probar-dashboard-local.mjs`,
  `probar-ventas-local.mjs`, `probar-productos-local.mjs`,
  `probar-inventario-local.mjs`, `probar-migracion-local.mjs`: usuarios ficticios con
  nombre y apellido explícitos y la dependencia `evaluarPerfil` en cada autorización.
- `docs/etapa-5-auth-multiempresa.md`: comando del seed actualizado.
- Este documento. El borrador anterior
  (`docs/etapa-10-perfil-nombre-detalle-historico.sql.draft`) se eliminó porque
  proponía derivar nombres del correo.

## 11. Procedimiento definitivo para cerrar la migración

> **Completado el 2026-10-16.** El perfil `22fa054c-7a98-47d3-9021-17342a2af17d` ya
> tenía sus nombres (`fran`/`recalde`), se creó y aplicó
> `20261018000000_perfil_nombre_obligatorio`, `prisma/schema.prisma` pasó a `String` y el
> cliente se regeneró. La base local quedó con **4 migraciones** y "Database schema is up
> to date!". Los pasos se conservan como registro de lo ejecutado.

Lo que queda es **una sola cosa**: que el perfil existente tenga sus nombres reales y
que la base imponga `NOT NULL`. La fase 1 ya está aplicada, así que ya no hay riesgo de
que `migrate deploy` tome las dos fases juntas.

### Antes de empezar

1. `npx prisma migrate status --config prisma.local.config.ts` →
   "Database schema is up to date!" (3 migraciones).
2. `SELECT count(*) FROM public."Perfil" WHERE "nombre" IS NULL OR "apellido" IS NULL;`
   → hoy da `1`. Ese es el único perfil pendiente: `22fa054c-7a98-47d3-9021-17342a2af17d`.

### Paso A — cargar los nombres reales (desde la interfaz)

Iniciar sesión con esa cuenta, entrar a `/perfil/completar`, escribir nombre y apellido
reales y guardar. Alternativa por SQL: el `UPDATE` del Paso 1 de §4. **No se derivan del
correo y no se usan valores de relleno.** Después, con esa misma cuenta, comprobar que
se puede registrar una venta (o un movimiento de inventario): es la prueba de que los
permisos comerciales volvieron.

Verificación: la consulta del punto 2 de "Antes de empezar" debe dar `0`.

### Paso B — crear la migración de la fase 2

1. `New-Item -ItemType Directory prisma\migrations\20261018000000_perfil_nombre_obligatorio`
   y copiar `docs\etapa-10-perfil-nombre-obligatorio.sql.draft` como `migration.sql`
   (sin editarlo: primero el archivo, después el checksum).
2. En `prisma/schema.prisma`, `Perfil.nombre` y `Perfil.apellido` pasan de `String?` a
   `String` (mismo commit que el `ALTER COLUMN`).
3. `npx prisma validate --config prisma.local.config.ts` y
   `npx prisma format --check --config prisma.local.config.ts`.

### Paso C — aplicar y regenerar

1. Aplicar con el comando de la fase 1 (mismo `migrate deploy --config
   prisma.local.config.ts`); debe aplicar **una sola** migración.
2. `npx prisma generate --config prisma.local.config.ts` (ahora las columnas son
   `NOT NULL`, así que el cliente y la base quedan en sincronía).
3. Reiniciar el servidor de desarrollo para que tome el cliente nuevo.

### Paso D — verificación final

| Comprobación | Resultado esperado |
|---|---|
| `migrate status` | "Database schema is up to date!", 4 migraciones |
| `SELECT count(*) FROM public."Perfil" WHERE "nombre" IS NULL OR "apellido" IS NULL` | `0` |
| `SELECT is_nullable FROM information_schema.columns WHERE table_name='Perfil' AND column_name IN ('nombre','apellido')` | dos filas `NO` |
| Definición de `Perfil_nombre_no_vacio` / `Perfil_apellido_no_vacio` | `CHECK ((nombre ~ '[^[:space:]]'::text))` y la de apellido |
| Recuentos de §1 (perfil, organización, miembro, productos, saldos, movimientos, ventas, detalles, usuarios de Auth) | idénticos a hoy |
| `npx tsc --noEmit` y `npx eslint .` | exit 0 |
| Las 6 suites locales + `--http` + `tests/perfil.test.mjs` | todo en verde |
| Registro de una cuenta nueva desde `/auth/sign-up` | el `Perfil` queda creado con los nombres ya en el primer intento |

### Paso E — dejar constancia

Actualizar el encabezado de este documento ("fase 2 aplicada"), la tabla de
sincronía de §3 (ya sin la fila de `String?`) y el borrador
`docs/etapa-10-perfil-nombre-obligatorio.sql.draft` (queda como registro del SQL
aplicado). Recién entonces conviene un commit con el conjunto completo.

**Lo que no hay que hacer:** `migrate reset`, `db push`, `migrate dev`, editar la
migración de la fase 1 o su checksum, y tocar Supabase Cloud. Nada de esto hace falta
para cerrar la migración.
