import { Prisma } from "../../src/generated/prisma/browser";

// Hasta 100 renglones: precisión suficiente incluso antes de controlar DECIMAL(14,2).
export const DecimalVenta = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
export function subtotalVenta(cantidad: string, precio: string) {
  return new DecimalVenta(cantidad).mul(precio).toDecimalPlaces(2, DecimalVenta.ROUND_HALF_UP);
}
