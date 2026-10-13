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
