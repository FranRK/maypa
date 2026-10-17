# Etapa 5: autenticacion y autorizacion multiempresa local

## Iniciar la aplicacion y preparar el primer usuario

1. Tener Supabase Docker local en marcha. Ejecutar npm run dev:local.
2. Abrir http://127.0.0.1:3000/auth/sign-up y registrar nombre, apellido, email y
   contrasena. La plantilla usa Supabase Auth; no se guardan contrasenas propias.
   La configuracion local existente no exige confirmacion; si la activas, usar
   el correo local (http://127.0.0.1:54324) para confirmar la cuenta.
3. Ejecutar npm run seed:local -- --email <email-registrado-localmente>
   --nombre <nombre> --apellido <apellido>.
   El email y los datos de la persona, nunca la contrasena. El nombre y el apellido
   son obligatorios y no se derivan del correo. El script obtiene la clave
   admin de Supabase status solo en memoria, verifica que el usuario local
   exista y este confirmado, y crea Perfil, Organizacion y MiembroOrganizacion.
   Detalles en docs/etapa-10-perfil-nombre-detalle-historico.md.
4. Abrir /auth/login e iniciar sesion. El destino es /dashboard. Si ya estabas
   autenticado, recargar /dashboard despues de ejecutar el seed.

El seed usa el slug estable organizacion-prueba y el rol PROPIETARIO, equivalente
a OWNER en nuestro esquema. Puede repetirse sin duplicar filas. Como herramienta
administrativa de desarrollo, puede reactivar/promover la membresia indicada;
no se expone como endpoint ni debe utilizarse como flujo de alta en produccion.
Antes del seed, una cuenta recien registrada ve Acceso restringido porque no
tiene membresias: no se asignan roles o empresas desde el navegador.

No se dejo una cuenta con contrasena prefijada: las cuentas usadas por los tests
eran ficticias, con claves aleatorias solo en memoria, y se limpiaron al terminar.
El usuario real de desarrollo crea su propia cuenta y contrasena con la plantilla.

## Entorno separado de Cloud

El .env existente contiene conexiones de Cloud y fue inspeccionado sin imprimir
secretos. No se modifico. dev-local.mjs obtiene Auth y PostgreSQL de Supabase CLI,
verifica loopback, los puertos 54321/54322 y el contenedor Docker esperado, y
pasa al proceso de Next NEXT_PUBLIC_SUPABASE_URL, la clave PUBLICA y
LOCAL_DATABASE_URL. Las variables del proceso tienen precedencia sobre .env.

La clave admin nunca se pasa a Next ni al navegador. LOCAL_DATABASE_URL solo se
consume desde lib/prisma.ts, marcado server-only; no usa DIRECT_URL/DATABASE_URL
de Cloud ni NEXT_PUBLIC para credenciales PostgreSQL. El cliente usa PrismaPg
compatible con Prisma 7.10.0 y una instancia reutilizada en desarrollo (pool max 5).
Los clientes SSR y browser rechazan URLs Auth remotas en esta etapa. npm run dev
sin el wrapper no configura las variables locales: usar npm run dev:local.
No ejecutar dev y dev:local a la vez sobre el puerto 3000.

## Identidad y autorizacion

Se reutilizaron login por email/contrasena, signup, recuperacion y logout de la
plantilla. El proxy conserva getClaims para renovar/verificar cookies; copia
cookies incluso al redirigir. La capa de servidor usa getUser contra Auth local
para recuperar una identidad verificada. Nunca autoriza con getSession ni con
un userId o rol recibido por query/formulario/metadata del navegador.

lib/auth/server.ts expone obtenerUsuarioAutenticado, obtenerMembresiasActivas y
exigirOrganizacion. Consulta Prisma MiembroOrganizacion con usuarioId de Auth y
activa=true, devuelve solo los campos necesarios y comprueba el rol.
lib/auth/policy.ts contiene las reglas puras y el tipo de error reutilizable.
Cada llamada sensible debe invocar exigirOrganizacion nuevamente; no hay cache
de identidad o membresias compartido entre solicitudes.

VER_DASHBOARD permite PROPIETARIO, ADMINISTRADOR y EMPLEADO.
ADMINISTRAR_ORGANIZACION permite solamente PROPIETARIO. No se implementaron
acciones administrativas ni comerciales: el permiso queda disponible para
proteger cada futura Action/Route Handler, ademas de su pagina.
Las futuras escrituras necesitan coordinar autorizacion y operacion en una
transaccion, para tratar cambios concurrentes de membresia/rol correctamente.

## Rutas y pantalla

- /auth/login: formulario existente, luego /dashboard.
- /auth/sign-up: alta local existente, dashboard si hay sesion inmediata.
- /auth/confirm: confirmacion OTP o intercambio PKCE, con destino local seguro.
- /dashboard: organizacion, email o UUID del usuario, rol y cerrar sesion.
- /dashboard?organizacion=<UUID>: seleccion de una organizacion permitida.
  Sin parametro se elige la primera membresia activa ordenada por nombre/UUID.
- /protected: ruta anterior de la plantilla, ahora redirige a /dashboard.

Una cuenta sin membresia activa ve un mensaje restringido sin datos de empresas.
Una organizacion ajena, inactiva o UUID mal formado muestra not-found sin revelar
datos de esa empresa. Next con Cache Components requiere Suspense: despues de
iniciar el streaming, la UI not-found puede llegar con HTTP 200 en vez de 404.
Esto no otorga acceso ni devuelve datos ajenos. La redireccion anonima ocurre
antes del streaming en el proxy; tambien se verifica identidad en el servidor.

## Privilegios PostgreSQL y estrategia minima

Inspeccion real local: rol postgres, rolsuper=false, rolbypassrls=true.
Las tablas siguen con RLS y sin grants para anon/authenticated/service_role.
Esto cierra la API directa, pero NO aisla una conexion Prisma privilegiada.
Las comprobaciones explicitas de usuario/membresia/rol son obligatorias.

Propuesta pendiente (no se ejecutaron grants, cambios de rol ni migraciones):

- Separar un rol de migracion del rol de ejecucion. Este ultimo debe ser LOGIN,
  NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS y no propietario de tablas.
- Para esta pantalla, otorgar solo USAGE en public y SELECT sobre Perfil,
  Organizacion y MiembroOrganizacion; ninguna escritura comercial, acceso a
  auth.users, secretos, permisos de DDL ni pertenencia a roles privilegiados.
- Con RLS, agregar politicas especificas para el rol servidor (las actuales
  no lo habilitan). Establecer el subject verificado mediante contexto LOCAL
  dentro de una transaccion Prisma y ejecutar las consultas dentro de ella.
- Perfil: id del subject; membresias: usuarioId del subject y activa;
  Organizacion: existencia de esa membresia activa. Evitar politicas recursivas.
- Probar grants, herencia, propietario y politicas con ese rol antes de cambiar
  la conexion. Con solo reemplazar postgres por un rol limitado, la pantalla
  actual no funcionaria sin las politicas/contexto transaccional correspondientes.

No se afirmo ni implemento proteccion automatica de Prisma por RLS. Las credenciales
del servidor necesitan gestion de secretos y el alcance del rol depende del flujo
que se implemente en una etapa posterior. Cloud no se consulto ni modifico.

## Pruebas ejecutadas

- npm run test:auth: codigo 0, catorce pruebas unitarias. Cubren anonimo, sin
  organizacion, activo, baja, A/B, permiso exclusivo de propietario, identidad
  incorrecta/UUID invalido, baja consultada de nuevo en cada operacion, destinos
  internos seguros para la confirmacion de Auth y, desde la etapa 10, el perfil
  incompleto: sin operaciones comerciales, lectura permitida, estructura sin las
  columnas nuevas y orden de las validaciones.
- npm run test:auth:local: codigo 0, doce comprobaciones contra Auth local,
  cookies SSR, Next HTTP y Prisma/PostgreSQL reales. Login, redireccion anonima,
  formulario existente, seed repetido, metadata de nombre y apellido, sin membresia,
  activo, A/B, baja, EMPLEADO frente a permiso de propietario, privilegios y logout.
- La prueba comprueba que URI PostgreSQL y clave admin no aparezcan en HTML.
  Crea cuentas mediante Auth Admin local con contrasenas aleatorias en memoria;
  elimina solo sus usuarios/perfiles/membresias/organizaciones al terminar.
  No resetea ni borra datos anteriores. No es una prueba de clicks de navegador.
- npx tsc --noEmit: codigo 0.
- npx eslint .: codigo 0.

Node 24.15.0 ejecuta las pruebas .ts mediante type stripping. Emite un aviso de
module type al importar policy.ts; las pruebas pasan sin instalar otro runner.
Next genera AGENTS.md automaticamente y muestra avisos de filesystem lento y
partialPrefetching no configurado. No impidieron las pruebas funcionales.

Fuentes: [Supabase SSR](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs),
[Next DAL](https://nextjs.org/docs/app/guides/authentication).

## Archivos de esta etapa

Nuevos: app/dashboard/page.tsx; lib/prisma.ts; lib/auth/server.ts;
lib/auth/policy.ts; lib/auth/redirect.ts; lib/supabase/config.ts;
scripts/dev-local.mjs; scripts/seed-local.mjs; scripts/probar-auth-local.mjs;
tests/authorization.test.mjs; este documento; AGENTS.md generado por Next.

Modificados: app/auth/confirm/route.ts; app/protected/page.tsx;
components/login-form.tsx; components/logout-button.tsx;
components/sign-up-form.tsx; components/update-password-form.tsx;
lib/supabase/client.ts; lib/supabase/server.ts; lib/supabase/proxy.ts;
scripts/supabase-local.mjs; package.json (solo scripts, sin dependencias nuevas).

Sin cambios de esquema, migraciones, credenciales o dependencias. Sin commit ni
push automaticos de esta etapa.
