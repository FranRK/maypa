# Primera migracion: aplicada y probada solo en Supabase local

La migracion oficial es 20261012000000_inicial_multiempresa/migration.sql.
Se aplico una sola vez mediante Prisma Migrate al Supabase Docker local y
se comprobaron su historial, checksum, restricciones, indices y RLS.
El borrador .sql.draft permanece como antecedente: no aplicarlo por separado.

No se aplico en Cloud. Nunca modificar el SQL ya aplicado: los comentarios del
archivo conservan la etapa de borrador original para mantener su checksum.
Los cambios posteriores deben agregarse mediante nuevas migraciones.

Conexion local: prisma.local.config.ts, sin dotenv ni fallback a Cloud.
Aplicacion inicial (solo base vacia): node scripts/aplicar-migracion-local.mjs.
Pruebas repetibles (sin datos propios): node scripts/probar-migracion-local.mjs.
Validacion/generacion local: node scripts/validar-prisma-local.mjs.
Los scripts obtienen la conexion de supabase status, verifican loopback y
el contenedor, ocultan credenciales y rechazan destinos inesperados.

Procedencia: ../../docs/etapa-3-primera-migracion.md.
Resultados reales y limites: ../../docs/etapa-4-validacion-local.md.
