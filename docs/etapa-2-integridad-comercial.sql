-- BORRADOR PARA REVISION; NO EJECUTAR DIRECTAMENTE.
-- CHECK incorporados al consolidado de etapa 3; las reglas siguientes
-- permanecen propuestas, sin triggers implementados.
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

-- Verificacion transaccional de las reglas que involucran varias filas:
--
-- 1. Al pasar una venta de BORRADOR a CONFIRMADA, exigir al menos un detalle,
--    total = suma de subtotales, y un movimiento VENTA por cada detalle con
--    variacion = -cantidad. La unique compuesta de Prisma impide duplicar ese
--    movimiento para el mismo detalle.
-- 2. Al insertar DetalleDevolucion, bloquear su DetalleVenta original, exigir
--    una venta CONFIRMADA o DEVOLUCION_PARCIAL y comprobar que la suma devuelta
--    (incluyendo el nuevo detalle) no exceda la cantidad vendida.
-- 3. Al insertar ANULACION_VENTA, exigir que compense el movimiento VENTA del
--    mismo detalle y producto, con variacion exactamente opuesta.
-- 4. Al insertar DEVOLUCION, exigir que compense un movimiento VENTA de la
--    misma linea y que su variacion positiva coincida con la cantidad del
--    DetalleDevolucion correspondiente. La regla 2 limita el acumulado.
-- 5. La transaccion debe exigir un movimiento DEVOLUCION por
--    cada DetalleDevolucion antes del commit. Actualizar Venta.estado a
--    DEVOLUCION_PARCIAL o DEVUELTA en la misma transaccion.
-- 6. Solo cancelar con reposicion total ventas confirmadas SIN devoluciones.
--    Para una venta parcial, devolver el remanente; nunca reponer todo otra vez.
--    Al cancelar una venta confirmada, insertar una ANULACION_VENTA para cada
--    movimiento VENTA y actualizar el estado dentro de la misma transaccion.
-- 7. Tras cada INSERT de MovimientoStock, aplicar variacion a SaldoStock con
--    INSERT ... ON CONFLICT ("organizacionId", "productoId") DO UPDATE
--    SET "cantidad" = "SaldoStock"."cantidad" + EXCLUDED."cantidad" y
--    actualizar "actualizadoEn". El CHECK de saldo rechaza una salida que lo
--    deje negativo; el movimiento y el saldo se revierten juntos.
-- 8. Rechazar UPDATE y DELETE de MovimientoStock y de detalles de una venta
--    confirmada o una devolucion. Corregir operaciones solo con movimientos
--    compensatorios; nunca editando o eliminando el historial.
--
-- Resolver estas reglas en operaciones transaccionales de una etapa futura;
-- evaluar triggers solo si son necesarios. Ver la politica de anulacion tras
-- devoluciones en etapa-2-modelo-multiempresa.md. PSL no expresa estas reglas.
