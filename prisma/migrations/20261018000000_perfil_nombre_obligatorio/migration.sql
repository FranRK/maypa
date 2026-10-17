-- Etapa 10, FASE 2: Perfil.nombre y Perfil.apellido obligatorios.
-- Borrador. NO ejecutado, NO aplicado. No modifica migraciones anteriores ni toca Cloud.
--
-- Por qué es un paso aparte y va después de la fase 1:
-- `prisma/migrations/20261017000000_perfil_nombre_y_detalle_historico` crea las dos
-- columnas anulables. La base local ya tiene perfiles y no existe ningún origen de
-- nombres reales, así que imponer NOT NULL en la misma migración obligaría a
-- inventar los valores. Primero se cargan los nombres reales, después se aplica esto.
--
-- Es un borrador y no una migración en prisma/migrations/ a propósito: `prisma
-- migrate deploy` aplica todas las migraciones pendientes de una vez, y esta
-- fallaría mientras queden perfiles sin nombre, dejando el historial a medias.
--
-- Qué hace, además de NOT NULL: reemplaza las restricciones de la fase 1 por su
-- forma definitiva. Las de la fase 1 son `"nombre" IS NULL OR "nombre" ~ ...`,
-- válidas mientras la columna es anulable. Una vez que la columna es NOT NULL esa
-- parte es redundante y confunde a quien audite las restricciones
-- (`pg_get_constraintdef` mostraría una definición que admite NULL). Se recrean
-- sin el `IS NULL OR`. El conjunto de valores que rechazan no cambia.

-- ---------------------------------------------------------------------------
-- ANTES DE APLICAR: las cuatro consultas deben devolver 0.
-- ---------------------------------------------------------------------------
--   SELECT count(*) AS sin_datos FROM public."Perfil"
--    WHERE "nombre" IS NULL OR "apellido" IS NULL;
--
--   SELECT count(*) AS vacios FROM public."Perfil"
--    WHERE "nombre" !~ '[^[:space:]]' OR "apellido" !~ '[^[:space:]]';
--
--   SELECT count(*) AS incoherentes_detalle FROM public."DetalleVenta"
--    WHERE ("nombreProducto" IS NULL) <> ("skuProducto" IS NULL);
--
--   SELECT count(*) AS restos_de_prueba FROM public."Perfil"
--    WHERE "nombre" ~* 'prueba|test|sin nombre';

-- Si devuelven más de 0, cargar los nombres reales que declare cada persona.
-- Valores reales, escritos por la persona: no derivados del correo, sin valores
-- de relleno. Ejemplo:
--   UPDATE public."Perfil"
--      SET "nombre" = '<nombre real>', "apellido" = '<apellido real>'
--    WHERE id = '<uuid del perfil>';

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public."Perfil"
  ALTER COLUMN "nombre"   SET NOT NULL,
  ALTER COLUMN "apellido" SET NOT NULL;

ALTER TABLE public."Perfil"
  DROP CONSTRAINT "Perfil_nombre_no_vacio",
  DROP CONSTRAINT "Perfil_apellido_no_vacio";

ALTER TABLE public."Perfil"
  ADD CONSTRAINT "Perfil_nombre_no_vacio"   CHECK ("nombre" ~ '[^[:space:]]'),
  ADD CONSTRAINT "Perfil_apellido_no_vacio" CHECK ("apellido" ~ '[^[:space:]]');

COMMIT;

-- ---------------------------------------------------------------------------
-- Después de aplicar: en el mismo commit hay que tocar el esquema y el alta
-- ---------------------------------------------------------------------------
-- 1. prisma/schema.prisma: `nombre String?` y `apellido String?` vuelven a
--    `String`. Hasta que se edite, el modelo y la base quedan desacomodados.
-- 2. Recién entonces `npx prisma generate` (antes de la fase 1 rompería el
--    detalle de venta: ver el documento de la etapa 10).
-- 3. `scripts/seed-local.mjs` crea el Perfil: tiene que escribir "nombre" y
--    "apellido", o el INSERT falla contra NOT NULL. Los usuarios de Auth deben
--    declarar los nombres en la metadata (lo hace el formulario de registro) o
--    pasarlos explícitamente. Ver el documento de la etapa 10, §9.
--
-- Nota sobre DetalleVenta: sus columnas siguen siendo anulables a propósito
-- (ventas anteriores a la etapa 10), así que sus restricciones y la de coherencia
-- se quedan como están. La fase 2 no las toca.

-- ---------------------------------------------------------------------------
-- Consultas de control después de aplicar
-- ---------------------------------------------------------------------------
--   SELECT count(*) FROM public."Perfil" WHERE "nombre" IS NULL OR "apellido" IS NULL;
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('Perfil_nombre_no_vacio', 'Perfil_apellido_no_vacio');

-- ---------------------------------------------------------------------------
-- Reversión de la fase 2 (vuelve al estado de la fase 1)
-- ---------------------------------------------------------------------------
--   ALTER TABLE public."Perfil"
--     ALTER COLUMN "apellido" DROP NOT NULL,
--     ALTER COLUMN "nombre"   DROP NOT NULL;
--   ALTER TABLE public."Perfil"
--     DROP CONSTRAINT "Perfil_apellido_no_vacio",
--     DROP CONSTRAINT "Perfil_nombre_no_vacio",
--     ADD CONSTRAINT "Perfil_nombre_no_vacio"
--       CHECK ("nombre" IS NULL OR "nombre" ~ '[^[:space:]]'),
--     ADD CONSTRAINT "Perfil_apellido_no_vacio"
--       CHECK ("apellido" IS NULL OR "apellido" ~ '[^[:space:]]');
