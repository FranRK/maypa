-- BORRADOR VERSIONADO: listo para revision, NO verificado en PostgreSQL.
-- Generado con Prisma 7.10.0: migrate diff --from-empty --to-schema
-- prisma/schema.prisma --script; complementado con FK, CHECK y seguridad.
-- No es una migracion aplicable por Prisma hasta su revision y prueba local.
-- Requiere Supabase Auth y sus roles existentes; solo crea objetos propios.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

-- Comprobaciones de catalogo; no crean ni modifican objetos de Auth.
DO $preflight$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Se requiere auth.users existente; este borrador no instala Supabase Auth';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_constraint c
      ON c.conrelid = a.attrelid AND c.contype = 'p'
    WHERE a.attrelid = 'auth.users'::regclass AND a.attname = 'id'
      AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
      AND c.conkey = ARRAY[a.attnum]::smallint[]
  ) THEN
    RAISE EXCEPTION 'auth.users.id debe ser UUID y su clave primaria simple';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) <> 3 THEN
    RAISE EXCEPTION 'Se requieren los roles Supabase anon, authenticated y service_role';
  END IF;
END;
$preflight$;

-- INICIO: DDL derivado del esquema Prisma, con nombres calificados en public.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE public."RolMiembro" AS ENUM ('PROPIETARIO', 'ADMINISTRADOR', 'EMPLEADO');

-- CreateEnum
CREATE TYPE public."EstadoVenta" AS ENUM ('BORRADOR', 'CONFIRMADA', 'CANCELADA', 'DEVOLUCION_PARCIAL', 'DEVUELTA');

-- CreateEnum
CREATE TYPE public."TipoMovimiento" AS ENUM ('INICIAL', 'COMPRA', 'VENTA', 'AJUSTE', 'ANULACION_VENTA', 'DEVOLUCION');

-- CreateTable
CREATE TABLE public."Perfil" (
    "id" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE public."Organizacion" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE public."MiembroOrganizacion" (
    "organizacionId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "rol" public."RolMiembro" NOT NULL DEFAULT 'EMPLEADO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "bajaEn" TIMESTAMP(3),

    CONSTRAINT "MiembroOrganizacion_pkey" PRIMARY KEY ("organizacionId","usuarioId")
);

-- CreateTable
CREATE TABLE public."Producto" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL DEFAULT 'unidad',
    "precioVenta" DECIMAL(14,2) NOT NULL,
    "stockMinimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE public."SaldoStock" (
    "organizacionId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaldoStock_pkey" PRIMARY KEY ("organizacionId","productoId")
);

-- CreateTable
CREATE TABLE public."Venta" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "creadaPor" UUID NOT NULL,
    "estado" public."EstadoVenta" NOT NULL DEFAULT 'BORRADOR',
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "claveIdempotencia" TEXT NOT NULL,
    "huellaSolicitud" CHAR(64) NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadaEn" TIMESTAMP(3),

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE public."DetalleVenta" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precioUnitario" DECIMAL(14,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "DetalleVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE public."MovimientoStock" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tipo" public."TipoMovimiento" NOT NULL,
    "variacion" DECIMAL(14,3) NOT NULL,
    "nota" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detalleVentaId" UUID,
    "detalleDevolucionId" UUID,
    "movimientoCompensadoId" UUID,

    CONSTRAINT "MovimientoStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE public."DevolucionVenta" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "creadaPor" UUID NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "huellaSolicitud" CHAR(64) NOT NULL,
    "motivo" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevolucionVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE public."DetalleDevolucion" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "devolucionVentaId" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "detalleVentaId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "DetalleDevolucion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organizacion_slug_key" ON public."Organizacion"("slug");

-- CreateIndex
CREATE INDEX "MiembroOrganizacion_usuarioId_idx" ON public."MiembroOrganizacion"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_organizacionId_sku_key" ON public."Producto"("organizacionId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_organizacionId_id_key" ON public."Producto"("organizacionId", "id");

-- CreateIndex
CREATE INDEX "Venta_organizacionId_creadaEn_idx" ON public."Venta"("organizacionId", "creadaEn");

-- CreateIndex
CREATE INDEX "Venta_organizacionId_creadaPor_idx" ON public."Venta"("organizacionId", "creadaPor");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_organizacionId_id_key" ON public."Venta"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_organizacionId_claveIdempotencia_key" ON public."Venta"("organizacionId", "claveIdempotencia");

-- CreateIndex
CREATE INDEX "DetalleVenta_organizacionId_ventaId_idx" ON public."DetalleVenta"("organizacionId", "ventaId");

-- CreateIndex
CREATE INDEX "DetalleVenta_organizacionId_productoId_idx" ON public."DetalleVenta"("organizacionId", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "DetalleVenta_organizacionId_id_key" ON public."DetalleVenta"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DetalleVenta_organizacionId_id_productoId_key" ON public."DetalleVenta"("organizacionId", "id", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "DetalleVenta_organizacionId_ventaId_id_productoId_key" ON public."DetalleVenta"("organizacionId", "ventaId", "id", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "DetalleVenta_organizacionId_ventaId_productoId_key" ON public."DetalleVenta"("organizacionId", "ventaId", "productoId");

-- CreateIndex
CREATE INDEX "MovimientoStock_organizacionId_creadoEn_idx" ON public."MovimientoStock"("organizacionId", "creadoEn");

-- CreateIndex
CREATE INDEX "MovimientoStock_organizacionId_productoId_creadoEn_idx" ON public."MovimientoStock"("organizacionId", "productoId", "creadoEn");

-- CreateIndex
CREATE INDEX "MovimientoStock_organizacionId_usuarioId_creadoEn_idx" ON public."MovimientoStock"("organizacionId", "usuarioId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoStock_organizacionId_productoId_id_key" ON public."MovimientoStock"("organizacionId", "productoId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoStock_organizacionId_detalleVentaId_tipo_key" ON public."MovimientoStock"("organizacionId", "detalleVentaId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoStock_organizacionId_detalleDevolucionId_key" ON public."MovimientoStock"("organizacionId", "detalleDevolucionId");

-- CreateIndex
CREATE INDEX "DevolucionVenta_organizacionId_ventaId_creadaEn_idx" ON public."DevolucionVenta"("organizacionId", "ventaId", "creadaEn");

-- CreateIndex
CREATE INDEX "DevolucionVenta_organizacionId_creadaPor_idx" ON public."DevolucionVenta"("organizacionId", "creadaPor");

-- CreateIndex
CREATE UNIQUE INDEX "DevolucionVenta_organizacionId_id_key" ON public."DevolucionVenta"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DevolucionVenta_organizacionId_id_ventaId_key" ON public."DevolucionVenta"("organizacionId", "id", "ventaId");

-- CreateIndex
CREATE UNIQUE INDEX "DevolucionVenta_organizacionId_claveIdempotencia_key" ON public."DevolucionVenta"("organizacionId", "claveIdempotencia");

-- CreateIndex
CREATE INDEX "DetalleDevolucion_organizacionId_detalleVentaId_idx" ON public."DetalleDevolucion"("organizacionId", "detalleVentaId");

-- CreateIndex
CREATE UNIQUE INDEX "DetalleDevolucion_organizacionId_id_key" ON public."DetalleDevolucion"("organizacionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DetalleDevolucion_organizacionId_id_productoId_key" ON public."DetalleDevolucion"("organizacionId", "id", "productoId");

-- CreateIndex
CREATE UNIQUE INDEX "DetalleDevolucion_organizacionId_devolucionVentaId_detalleV_key" ON public."DetalleDevolucion"("organizacionId", "devolucionVentaId", "detalleVentaId");

-- AddForeignKey
ALTER TABLE public."MiembroOrganizacion" ADD CONSTRAINT "MiembroOrganizacion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES public."Organizacion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."MiembroOrganizacion" ADD CONSTRAINT "MiembroOrganizacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES public."Perfil"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."Producto" ADD CONSTRAINT "Producto_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES public."Organizacion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."SaldoStock" ADD CONSTRAINT "SaldoStock_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES public."Organizacion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."SaldoStock" ADD CONSTRAINT "SaldoStock_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES public."Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."Venta" ADD CONSTRAINT "Venta_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES public."Organizacion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."Venta" ADD CONSTRAINT "Venta_organizacionId_creadaPor_fkey" FOREIGN KEY ("organizacionId", "creadaPor") REFERENCES public."MiembroOrganizacion"("organizacionId", "usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DetalleVenta" ADD CONSTRAINT "DetalleVenta_organizacionId_ventaId_fkey" FOREIGN KEY ("organizacionId", "ventaId") REFERENCES public."Venta"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DetalleVenta" ADD CONSTRAINT "DetalleVenta_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES public."Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES public."Organizacion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES public."Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_usuarioId_fkey" FOREIGN KEY ("organizacionId", "usuarioId") REFERENCES public."MiembroOrganizacion"("organizacionId", "usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_detalleVentaId_productoId_fkey" FOREIGN KEY ("organizacionId", "detalleVentaId", "productoId") REFERENCES public."DetalleVenta"("organizacionId", "id", "productoId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_detalleDevolucionId_product_fkey" FOREIGN KEY ("organizacionId", "detalleDevolucionId", "productoId") REFERENCES public."DetalleDevolucion"("organizacionId", "id", "productoId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."MovimientoStock" ADD CONSTRAINT "MovimientoStock_organizacionId_productoId_movimientoCompen_fkey" FOREIGN KEY ("organizacionId", "productoId", "movimientoCompensadoId") REFERENCES public."MovimientoStock"("organizacionId", "productoId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DevolucionVenta" ADD CONSTRAINT "DevolucionVenta_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES public."Organizacion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DevolucionVenta" ADD CONSTRAINT "DevolucionVenta_organizacionId_ventaId_fkey" FOREIGN KEY ("organizacionId", "ventaId") REFERENCES public."Venta"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DevolucionVenta" ADD CONSTRAINT "DevolucionVenta_organizacionId_creadaPor_fkey" FOREIGN KEY ("organizacionId", "creadaPor") REFERENCES public."MiembroOrganizacion"("organizacionId", "usuarioId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DetalleDevolucion" ADD CONSTRAINT "DetalleDevolucion_organizacionId_devolucionVentaId_ventaId_fkey" FOREIGN KEY ("organizacionId", "devolucionVentaId", "ventaId") REFERENCES public."DevolucionVenta"("organizacionId", "id", "ventaId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DetalleDevolucion" ADD CONSTRAINT "DetalleDevolucion_organizacionId_ventaId_detalleVentaId_pr_fkey" FOREIGN KEY ("organizacionId", "ventaId", "detalleVentaId", "productoId") REFERENCES public."DetalleVenta"("organizacionId", "ventaId", "id", "productoId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE public."DetalleDevolucion" ADD CONSTRAINT "DetalleDevolucion_organizacionId_productoId_fkey" FOREIGN KEY ("organizacionId", "productoId") REFERENCES public."Producto"("organizacionId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FIN DDL Prisma. INICIO SQL personalizado.
-- BORRADOR PARA REVISION; NO EJECUTAR DIRECTAMENTE.
-- Incorporar y revisar en la futura migracion inicial, despues de que Prisma
-- cree las tablas y tipos indicados. Este archivo no modifica ninguna base.

-- Valores no negativos y cantidades de linea positivas.
ALTER TABLE public."Producto"
  ADD CONSTRAINT "Producto_precios_y_stock_minimo_no_negativos"
  CHECK ("precioVenta" >= 0 AND "stockMinimo" >= 0);

ALTER TABLE public."SaldoStock"
  ADD CONSTRAINT "SaldoStock_cantidad_no_negativa"
  CHECK ("cantidad" >= 0);

ALTER TABLE public."Venta"
  ADD CONSTRAINT "Venta_total_no_negativo"
  CHECK ("total" >= 0);

ALTER TABLE public."DetalleVenta"
  ADD CONSTRAINT "DetalleVenta_cantidad_y_precio_validos"
  CHECK (
    "cantidad" > 0
    AND "precioUnitario" >= 0
    AND "subtotal" >= 0
    AND "subtotal" = round("cantidad" * "precioUnitario", 2)
  );

ALTER TABLE public."DetalleDevolucion"
  ADD CONSTRAINT "DetalleDevolucion_cantidad_positiva"
  CHECK ("cantidad" > 0);

ALTER TABLE public."MovimientoStock"
  ADD CONSTRAINT "MovimientoStock_variacion_segun_tipo"
  CHECK (
    ("tipo" IN ('INICIAL', 'COMPRA', 'ANULACION_VENTA', 'DEVOLUCION') AND "variacion" > 0)
    OR ("tipo" = 'VENTA' AND "variacion" < 0)
    OR ("tipo" = 'AJUSTE' AND "variacion" <> 0)
  );

ALTER TABLE public."MovimientoStock"
  ADD CONSTRAINT "MovimientoStock_referencia_segun_tipo"
  CHECK (
    ("tipo" = 'VENTA'
      AND "detalleVentaId" IS NOT NULL
      AND "detalleDevolucionId" IS NULL
      AND "movimientoCompensadoId" IS NULL)
    OR ("tipo" = 'ANULACION_VENTA'
      AND "detalleVentaId" IS NOT NULL
      AND "detalleDevolucionId" IS NULL
      AND "movimientoCompensadoId" IS NOT NULL)
    OR ("tipo" = 'DEVOLUCION'
      AND "detalleVentaId" IS NULL
      AND "detalleDevolucionId" IS NOT NULL
      AND "movimientoCompensadoId" IS NOT NULL)
    OR ("tipo" IN ('INICIAL', 'COMPRA', 'AJUSTE')
      AND "detalleVentaId" IS NULL
      AND "detalleDevolucionId" IS NULL
      AND "movimientoCompensadoId" IS NULL)
  );


-- Complemento del borrador inicial; NO ejecutado. Solo objetos propios.
-- auth.users debe existir: se agrega una FK en Perfil, no se altera Auth.
ALTER TABLE public."Perfil"
  ADD CONSTRAINT "Perfil_auth_users_fkey"
  FOREIGN KEY ("id") REFERENCES auth.users(id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE public."MiembroOrganizacion"
  ADD CONSTRAINT "MiembroOrganizacion_baja_coherente"
  CHECK (("activa" AND "bajaEn" IS NULL)
    OR (NOT "activa" AND "bajaEn" IS NOT NULL AND "bajaEn" >= "creadoEn"));

ALTER TABLE public."Venta"
  ADD CONSTRAINT "Venta_idempotencia_valida"
  CHECK (btrim("claveIdempotencia") <> '' AND "huellaSolicitud"::text ~ '^[0-9a-f]{64}$');

ALTER TABLE public."DevolucionVenta"
  ADD CONSTRAINT "DevolucionVenta_idempotencia_valida"
  CHECK (btrim("claveIdempotencia") <> '' AND "huellaSolicitud"::text ~ '^[0-9a-f]{64}$');

-- PostgreSQL numeric acepta NaN incluso con precision acotada: >= 0 no lo excluye.
ALTER TABLE public."Producto"
  ADD CONSTRAINT "Producto_valores_finitos"
  CHECK ("precioVenta" <> 'NaN'::numeric AND "stockMinimo" <> 'NaN'::numeric);
ALTER TABLE public."SaldoStock"
  ADD CONSTRAINT "SaldoStock_valor_finito" CHECK ("cantidad" <> 'NaN'::numeric);
ALTER TABLE public."Venta"
  ADD CONSTRAINT "Venta_total_finito" CHECK ("total" <> 'NaN'::numeric);
ALTER TABLE public."DetalleVenta"
  ADD CONSTRAINT "DetalleVenta_valores_finitos"
  CHECK ("cantidad" <> 'NaN'::numeric AND "precioUnitario" <> 'NaN'::numeric
    AND "subtotal" <> 'NaN'::numeric);
ALTER TABLE public."DetalleDevolucion"
  ADD CONSTRAINT "DetalleDevolucion_valor_finito" CHECK ("cantidad" <> 'NaN'::numeric);
ALTER TABLE public."MovimientoStock"
  ADD CONSTRAINT "MovimientoStock_valor_finito" CHECK ("variacion" <> 'NaN'::numeric),
  ADD CONSTRAINT "MovimientoStock_no_autocompensacion"
  CHECK ("movimientoCompensadoId" IS NULL OR "movimientoCompensadoId" <> "id");

-- API directa cerrada en esta etapa. RLS no protege a roles BYPASSRLS.
-- Revocar grants evita la herencia de permisos predeterminados de Supabase.
-- No se otorgan permisos a un rol Prisma: debe definirse y probarse por separado.

ALTER TABLE public."Perfil" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."Perfil" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."Perfil"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."Organizacion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."Organizacion" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."Organizacion"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."MiembroOrganizacion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."MiembroOrganizacion" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."MiembroOrganizacion"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."Producto" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."Producto" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."Producto"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."SaldoStock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."SaldoStock" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."SaldoStock"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."Venta" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."Venta" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."Venta"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."DetalleVenta" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."DetalleVenta" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."DetalleVenta"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."MovimientoStock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."MovimientoStock" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."MovimientoStock"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."DevolucionVenta" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."DevolucionVenta" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."DevolucionVenta"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public."DetalleDevolucion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."DetalleDevolucion" FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "api_sin_acceso" ON public."DetalleDevolucion"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMIT;
