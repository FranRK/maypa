# Primera migracion: borrador local para revision

> Documento historico de la etapa 3. La etapa 4 promovio y aplico la migracion
> exclusivamente en Supabase local. Ver etapa-4-validacion-local.md para las
> pruebas PostgreSQL realizadas y el estado actual. Cloud sigue sin cambios.

## Estado y alcance

No habia prisma/migrations al comenzar. No se consulto ni modifico Supabase.
El archivo prisma/migrations/20261012_inicial_multiempresa.sql.draft contiene
10 tablas, 3 enums, indices, FK, CHECK y seguridad API, dentro de BEGIN/COMMIT.
No se creo migration.sql aplicable, no se genero cliente y no se modificaron
credenciales, paquetes, endpoints ni logica Auth. El versionado se prepara con
archivos locales en el repositorio; no se creo un commit.

## Generacion reproducible

Comando ejecutado con Prisma 7.10.0 (codigo 0):

    npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20261012_inicial_multiempresa.sql.draft

El diff usa solo el esquema local y un origen vacio, sin datasource como origen
ni destino. Se calificaron los nombres de tablas/tipos en public, para evitar
dependencias del search_path. Al regenerar, escribir a un archivo temporal:
NO sobrescribir el consolidado, ya que se perderia el SQL personalizado.

El consolidado agrega: precondiciones sobre auth.users.id UUID/PK y roles API;
la FK manual de Perfil; los CHECK de etapa-2-integridad-comercial.sql; el SQL de
etapa-3-complemento-inicial.sql; y RLS/REVOKE/politica api_sin_acceso en cada tabla.
Incluye todos los indices y relaciones producidos por el diff de Prisma.
El lock_timeout de 5s evita esperas largas por locks; cualquier fallo revierte
el bloque completo. El borrador es inicial y no es reejecutable sobre sus tablas.

## Supabase Auth y bajas de empleados

Se elimino UsuarioAuth y la dependencia Preview externalTables, el schema auth
Prisma y la creacion de auth.users en la sombra. Perfil conserva UUID sin default,
y sus membresias siguen usando la PK compuesta organizacionId/usuarioId.
La FK manual usa ON DELETE/UPDATE RESTRICT: retiene las referencias y bloquea
borrado de Auth mientras exista Perfil. Baja logica: activa=false, bajaEn no nulo.
Actualizar el servidor en una etapa futura para rechazar membresias inactivas.

Solo la FK hace referencia a auth.users (ademas de leer catalogos en preflight).
No se crean ni alteran tablas, tipos, funciones, triggers o permisos internos de
Auth. La FK manual no existe en PSL; preservar y revisar su SQL en futuros diffs.
La base sombra futura necesitara Auth existente. No usar Supabase real como sombra.

## Seguridad deliberadamente cerrada

Cada tabla propia tiene ENABLE ROW LEVEL SECURITY y una politica AS RESTRICTIVE
FOR ALL TO anon, authenticated USING(false) WITH CHECK(false). Tambien se revocan
privilegios de tabla para PUBLIC, anon, authenticated y service_role, evitando
los grants predeterminados. No se cambian permisos de schema public ni de Auth.
No hay API CRUD directa permitida, aunque el usuario haya iniciado sesion.

No se crearon roles de servidor ni permisos para Prisma. Un rol BYPASSRLS o el
propietario puede eludir politicas: la autenticacion y autorizacion del servidor
siguen siendo obligatorias. Antes de desplegar definir rol de ejecucion, grants
y politicas necesarias; verificar herencia de roles, propietarios, vistas y
funciones existentes que puedan exponer datos. Las tablas aisladas no prueban
la seguridad de todo el proyecto Supabase.

## Bloqueo para promocion a migracion aplicable

La revision local del SQL no garantiza su aplicacion en PostgreSQL. La solicitud
prohibe ejecutar SQL que modifique bases, por lo que no se ejecuto ni el borrador
ni pruebas DDL/DML locales. No se verificaron privilegios reales, RLS ni catalogos
de Supabase. El archivo queda como borrador por esa validacion pendiente.

En desarrollo con Supabase Auth preexistente: verificar PK/roles/permisos y que
public no tenga las tablas/tipos propios; ejecutar el archivo con interrupcion
ante errores; inspeccionar restricciones, indices y politicas; probar referencias
entre empresas, cantidades/precios/NaN invalidos, idempotencia y bajas. Usar roles
API para probar denegacion y un rol servidor para probar el flujo autorizado.
Las reglas complejas permanecen documentadas: sin triggers ni consistencia
transaccional automatica entre saldo y movimientos en esta migracion.

Fuentes: [Prisma CLI](https://docs.prisma.io/docs/orm/reference/prisma-cli-reference),
[Supabase perfiles](https://supabase.com/docs/guides/auth/managing-user-data),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Validaciones locales

- prisma validate: codigo 0, esquema valido.
- prisma format --check: codigo 0, formato correcto.
- tsc --noEmit: codigo 0, sin diagnosticos.
- Revision estatica del SQL: codigo 0; 10 tablas, 3 enums, 29 indices,
  22 FK (21 Prisma y 1 Auth), 17 CHECK y 10 politicas de denegacion.
  Verificacion de columnas y claves unicas de destino de las FK propias.
- git diff --check: codigo 0, sin errores de espacios; avisos locales de Git
  sobre safe.directory y conversion LF/CRLF.

Estas comprobaciones no ejecutan PostgreSQL ni comprueban los permisos reales.

- npx eslint .: codigo 0, sin diagnosticos. La comprobacion adicional con
  node node_modules/eslint/bin/eslint.js . tambien termino con codigo 0.
