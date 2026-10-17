-- Migración incremental de la etapa 10, FASE 1. CREADA Y NO APLICADA.
-- No modifica ninguna migración anterior ni toca Supabase Cloud.
--
-- Aplicar solo en PostgreSQL local, con:
--   LOCAL_DATABASE_URL=... npx prisma migrate deploy --config prisma.local.config.ts
-- (No usar scripts/aplicar-migracion-local.mjs: ese script exige base vacía.)
--
-- Alcance, dos cambios independientes:
--
--   1. DetalleVenta.nombreProducto y DetalleVenta.skuProducto, anulables, para
--      conservar el nombre y el SKU del producto al momento de la venta.
--      Las ventas anteriores quedan en NULL a propósito: no se rellena nada desde
--      el catálogo actual porque eso afirmaría un hecho del pasado que no se puede
--      verificar (el producto pudo cambiar de nombre o de SKU después de la venta).
--
--   2. Perfil.nombre y Perfil.apellido.
--      En esta fase se crean ANULABLES, igual que lo declara prisma/schema.prisma
--      en este momento, para que el esquema y la estructura real de PostgreSQL
--      queden sincronizados después de aplicarla.
--      La obligatoriedad no se puede imponer todavía: la base ya tiene perfiles y
--      no existe ningún origen de nombres reales (auth.users solo guarda email,
--      email_verified, phone_verified y sub; no hay nombre en columnas ni en
--      metadata). Imponer NOT NULL hoy exigiría inventar los nombres, que es
--      justamente lo que no se quiere.
--      Los nombres reales se cargan con un procedimiento controlado y después se
--      aplica la FASE 2: docs/etapa-10-perfil-nombre-obligatorio.sql.draft
--
-- Restricciones de contenido: rechazan cadena vacía y cadena compuesta solo por
-- espacios. '[^[:space:]]' exige al menos un carácter que no sea espacio en blanco
-- (incluye espacio, tabulación, salto de línea, retorno de carro, \v y \f).
-- Están escritas como "IS NULL OR ..." para que sigan siendo válidas mientras las
-- columnas de Perfil son anulables. La fase 2 las reemplaza por su forma definitiva
-- junto con NOT NULL.
--
-- Coherencia histórica: nombreProducto y skuProducto son ambos NULL o ambos con
-- contenido. Evita detalles de venta a medio completar.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1. DetalleVenta: nombre y SKU del producto al momento de la venta
-- ---------------------------------------------------------------------

ALTER TABLE public."DetalleVenta"
  ADD COLUMN "nombreProducto" TEXT,
  ADD COLUMN "skuProducto" TEXT;

ALTER TABLE public."DetalleVenta"
  ADD CONSTRAINT "DetalleVenta_historico_coherente"
    CHECK (("nombreProducto" IS NULL) = ("skuProducto" IS NULL)),
  ADD CONSTRAINT "DetalleVenta_nombreProducto_no_vacio"
    CHECK ("nombreProducto" IS NULL OR "nombreProducto" ~ '[^[:space:]]'),
  ADD CONSTRAINT "DetalleVenta_skuProducto_no_vacio"
    CHECK ("skuProducto" IS NULL OR "skuProducto" ~ '[^[:space:]]');

-- ---------------------------------------------------------------------
-- 2. Perfil: nombre y apellido
-- ---------------------------------------------------------------------

ALTER TABLE public."Perfil"
  ADD COLUMN "nombre" TEXT,
  ADD COLUMN "apellido" TEXT;

ALTER TABLE public."Perfil"
  ADD CONSTRAINT "Perfil_nombre_no_vacio"
    CHECK ("nombre" IS NULL OR "nombre" ~ '[^[:space:]]'),
  ADD CONSTRAINT "Perfil_apellido_no_vacio"
    CHECK ("apellido" IS NULL OR "apellido" ~ '[^[:space:]]');

-- Sin DEFAULT en ninguna de las cuatro columnas: los valores los aporta la
-- aplicación y las personas, no la base. Ninguna restricción de longitud: no se
-- pidió y un límite arbitrario podría rechazar nombres legítimos.

COMMIT;

-- =====================================================================
-- Consultas de control
-- =====================================================================

-- ANTES de aplicar (solo lectura, con las columnas todavía inexistentes):
--   SELECT count(*) AS perfiles  FROM public."Perfil";
--   SELECT count(*) AS detalles  FROM public."DetalleVenta";

-- DESPUÉS de aplicar: las columnas existen y no se rompió ninguna fila.
--   SELECT count(*) FROM public."DetalleVenta" WHERE "nombreProducto" IS NULL;
--   SELECT count(*) FROM public."Perfil" WHERE "nombre" IS NULL;
--   SELECT count(*) FROM public."DetalleVenta"          -- debe dar 0
--    WHERE ("nombreProducto" IS NULL) <> ("skuProducto" IS NULL);
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'DetalleVenta_historico%'
--      OR conname LIKE 'Perfil_%_no_vacio';

-- Reversión de la fase 1 (pérdida de los nombres de producto capturados después):
--   ALTER TABLE public."DetalleVenta"
--     DROP CONSTRAINT "DetalleVenta_skuProducto_no_vacio",
--     DROP CONSTRAINT "DetalleVenta_nombreProducto_no_vacio",
--     DROP CONSTRAINT "DetalleVenta_historico_coherente",
--     DROP COLUMN "skuProducto", DROP COLUMN "nombreProducto";
--   ALTER TABLE public."Perfil"
--     DROP CONSTRAINT "Perfil_apellido_no_vacio",
--     DROP CONSTRAINT "Perfil_nombre_no_vacio",
--     DROP COLUMN "apellido", DROP COLUMN "nombre";
