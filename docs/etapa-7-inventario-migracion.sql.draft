-- PROPUESTA: nueva migración, no modifica la inicial. NO ejecutada.
-- Ejecutar con Prisma Migrate solo tras revisión y verificación de destino local.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public."MovimientoStock"
  ADD COLUMN "claveIdempotencia" UUID,
  ADD COLUMN "huellaSolicitud" CHAR(64);

CREATE UNIQUE INDEX "MovimientoStock_organizacionId_claveIdempotencia_key"
  ON public."MovimientoStock" ("organizacionId", "claveIdempotencia");

-- Los NULL de movimientos comerciales futuros no colisionan.
-- No inventar claves para movimientos independientes históricos: si existen,
-- revisar un plan explícito de transición antes de aplicar estos CHECK.
ALTER TABLE public."MovimientoStock"
  ADD CONSTRAINT "MovimientoStock_idempotencia_coherente" CHECK (
    ("claveIdempotencia" IS NULL AND "huellaSolicitud" IS NULL)
    OR ("claveIdempotencia" IS NOT NULL AND "huellaSolicitud" IS NOT NULL
      AND "huellaSolicitud"::text ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "MovimientoStock_independiente_idempotente" CHECK (
    "tipo" NOT IN ('INICIAL', 'COMPRA', 'AJUSTE')
    OR ("claveIdempotencia" IS NOT NULL AND "huellaSolicitud" IS NOT NULL)
  ),
  ADD CONSTRAINT "MovimientoStock_ajuste_con_motivo" CHECK (
    "tipo" <> 'AJUSTE' OR ("nota" IS NOT NULL AND btrim("nota") <> '')
  );

CREATE UNIQUE INDEX "MovimientoStock_inicial_unico"
  ON public."MovimientoStock" ("organizacionId", "productoId")
  WHERE "tipo" = 'INICIAL';

COMMIT;
