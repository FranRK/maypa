# Primera migracion: validacion PostgreSQL real en Supabase local

## Destino verificado y estado inicial

Supabase status devolvio loopback 127.0.0.1:54322, base postgres, rol postgres.
Contenedor Docker: supabase_db_stock-manager, puerto interno 5432.
Servidor: PostgreSQL 17.11. No se muestran URI completas, contrasenas ni claves.
Bases del servidor local: postgres, _supabase, storage_vectors, template0, template1.
Se escribio exclusivamente en postgres; las otras bases no se modificaron.

Antes de migrar: ningun objeto de tabla propio en public u otros schemas no
internos, cero auth.users, storage.buckets, storage.objects y vault.secrets.
auth.users ya existia. No se eliminaron tablas o datos para preparar la prueba.
Los objetos y datos internos preinstalados de Supabase se conservaron.

La primera inspeccion en sandbox fallo por permisos de telemetria/Docker.
Se repitio fuera del sandbox con permisos autorizados, ocultando secretos.

## Configuracion y aplicacion

prisma.local.config.ts no carga dotenv, DIRECT_URL ni DATABASE_URL de Cloud.
Exige LOCAL_DATABASE_URL con host 127.0.0.1/localhost, puerto 54322 y base postgres.
Rechaza parametros de conexion que puedan redirigir el destino.
Los scripts derivan esta variable en memoria de npx supabase status -o json
y verifican el contenedor local en ejecucion; no guardan credenciales en archivos.

Se copio el borrador a la migracion oficial SIN cambiar su contenido:

    prisma/migrations/20261012000000_inicial_multiempresa/migration.sql

SHA256: ec6aabc578cbd350a5a8e67f7c7641b12d55bb3de409d8ea74434005bdda3e98
Provider en migration_lock.toml: postgresql.
La cabecera del SQL conserva su origen historico como borrador; no cambiar
el archivo aplicado porque su checksum ya esta registrado.

Comando aplicado, tras repetir la comprobacion de base vacia:

    npx prisma migrate deploy --config prisma.local.config.ts

Resultado: codigo 0, All migrations have been successfully applied.
Una sola fila de public._prisma_migrations, finished_at no nulo, sin rollback
y checksum igual al archivo. No se aplico primero SQL manualmente.

## Pruebas reales

    node scripts/probar-migracion-local.mjs

Resultado: codigo 0, 45 comprobaciones aprobadas:

- Diez tablas propias con RLS y tres enums. La tabla administrativa
  _prisma_migrations existe adicionalmente para el historial de Prisma.
- 22 FK validadas, todas RESTRICT en DELETE/UPDATE, incluyendo Perfil/Auth.
- 17 CHECK validados, 29 indices explicitos y diez indices de PK.
- Diez politicas restrictivas false para anon/authenticated; ninguno de los
  tres roles anon/authenticated/service_role tiene privilegios de tabla.
- Fixtures de dos organizaciones, perfiles, membresias, productos, ventas,
  saldos, movimientos y una devolucion ligada al movimiento original.
- Rechazo SQLSTATE 23503 de referencias entre empresas, producto distinto
  de la linea, devolucion con cabecera de otra venta y Perfil sin Auth.
- Rechazo 23514 de cantidades cero, precios/stock/total negativos,
  subtotal incoherente, signo/referencias de movimiento invalidos, NaN,
  baja incoherente, clave vacia y huella no hexadecimal.
- Rechazo 23505 de clave de venta y movimientos duplicados.
- Baja logica conserva autores; borrado de miembro, Perfil o Auth referenciado
  rechazado por FK.
- SELECT/INSERT denegados (42501) para los tres roles API. Ademas se otorgaron
  permisos temporales de SELECT/INSERT a authenticated dentro de la transaccion:
  RLS devolvio cero filas y rechazo INSERT, probando la politica separada del grant.
- La conexion postgres vio las dos empresas, demostrando que la conexion
  privilegiada de Prisma no queda aislada automaticamente por RLS.
- ROLLBACK final completo: todas las tablas propias y auth.users quedaron vacias,
  y los grants temporales se revirtieron. Solo permanece el historial de migracion.

La primera ejecucion del test fallo antes de insertar fixtures: el driver pg
devolvio el tipo de catalogo name[] como texto. Se corrigio el SELECT para pedir
text[] y la segunda ejecucion completo las 45 pruebas. No se cambio la migracion.

## Repeticion segura

- node scripts/verificar-supabase-local.mjs: solo lectura, precondicion de base
  vacia antes de primera aplicacion; ahora rechazara las tablas ya migradas.
- node scripts/aplicar-migracion-local.mjs: solo para primera aplicacion a base
  vacia; no resetear ni reaplicar manualmente el SQL.
- node scripts/probar-migracion-local.mjs: requiere tablas propias/Auth sin
  datos, inserta fixtures y comprueba errores dentro de una transaccion revertida.
- node scripts/validar-prisma-local.mjs: validate, format --check, generate y
  migrate status, todos con --config prisma.local.config.ts.

## Validaciones finales

Todos los comandos siguientes terminaron con codigo de salida 0:

- npx supabase status -o json (capturado y con credenciales ocultas).
- npx prisma migrate deploy --config prisma.local.config.ts.
- npx prisma validate --config prisma.local.config.ts.
- npx prisma format --check --config prisma.local.config.ts.
- npx prisma generate --config prisma.local.config.ts: cliente 7.10.0 generado
  en src/generated/prisma, ignorado por Git; sin cambios de dependencias.
- npx prisma migrate status --config prisma.local.config.ts: up to date.
- npx tsc --noEmit: sin diagnosticos.
- npx eslint .: sin diagnosticos.
- node scripts/probar-migracion-local.mjs: 45 pruebas PostgreSQL aprobadas.
- git diff --check: sin errores de espacios; avisos locales de safe.directory/LF.

Tres pruebas negativas adicionales de configuracion local rechazaron antes de
conectar un host remoto ficticio, puerto incorrecto y parametro host de redireccion.
No se utilizaron credenciales de Cloud ni se establecieron conexiones remotas.

## Limites pendientes

No se probaron el servidor de aplicacion, JWT, endpoints ni la API HTTP/PostgREST.
La prueba de permisos se hizo en PostgreSQL mediante SET LOCAL ROLE.
No se implementaron transacciones comerciales ni triggers: total contra suma de
lineas, stock contra suma de movimientos y limite acumulado de devoluciones
siguen pendientes, al igual que autorizacion por membresia activa/rol.
Falta definir un rol Prisma de ejecucion con permisos minimos y probarlo.
La aplicacion debe autorizar cada consulta; postgres y BYPASSRLS eluden RLS.
La politica actual cierra acceso directo a la API de tablas comerciales.
Mantener la FK manual Perfil/Auth en futuras migraciones y usar una sombra
de desarrollo con Auth preexistente. No usar Cloud como base sombra.

Supabase Cloud no se consulto ni modifico. No se editaron archivos .env ni
credenciales existentes, no se ejecuto db push, reset ni migrate dev.
