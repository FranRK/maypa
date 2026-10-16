import type { Prisma } from "../../src/generated/prisma/client";
import type { RolMiembro } from "../../src/generated/prisma/enums";
import { permiteOperacion, type Permiso } from "../auth/policy";
import { decimalStock, milesimas } from "./cantidades";

export class InventarioError extends Error {}
type Tx = Prisma.TransactionClient;
export async function bloquearMembresia(tx: Tx, org: string, usuario: string, permiso: Permiso) {
  const [miembro] = await tx.$queryRaw<{ activa: boolean; rol: RolMiembro }[]>`
    SELECT activa,rol FROM public."MiembroOrganizacion"
    WHERE "organizacionId"=${org}::uuid AND "usuarioId"=${usuario}::uuid FOR SHARE`;
  if (!miembro?.activa || !permiteOperacion(miembro.rol, permiso)) throw new InventarioError("Tu membresía no permite realizar esta operación.");
}
export async function bloquearClave(tx: Tx, clave: string) {
  await tx.$queryRaw`SELECT 1 AS bloqueado FROM pg_advisory_xact_lock(hashtextextended(${clave},0))`;
}
// Todos los escritores bloquean producto antes que saldo. Varios productos: ordenar por UUID.
export async function bloquearProducto(tx: Tx, org: string, producto: string) {
  const [fila] = await tx.$queryRaw<{ activo: boolean; precioVenta: Prisma.Decimal }[]>`
    SELECT activo,"precioVenta" FROM public."Producto" WHERE "organizacionId"=${org}::uuid AND id=${producto}::uuid FOR UPDATE`;
  if (!fila?.activo) throw new InventarioError("Producto inactivo o no disponible en esta organización.");
  return fila;
}
export async function saldoConsistente(tx: Tx, org: string, producto: string) {
  const key = { organizacionId: org, productoId: producto };
  await tx.saldoStock.upsert({ where: { organizacionId_productoId: key }, create: { ...key, cantidad: "0" }, update: {} });
  const [saldo] = await tx.$queryRaw<{ cantidad: Prisma.Decimal }[]>`
    SELECT cantidad FROM public."SaldoStock" WHERE "organizacionId"=${org}::uuid AND "productoId"=${producto}::uuid FOR UPDATE`;
  const historial = await tx.movimientoStock.aggregate({ where: key, _sum: { variacion: true } });
  const cantidad = milesimas(saldo.cantidad.toString());
  if (cantidad !== milesimas(historial._sum.variacion?.toString() ?? "0")) throw new InventarioError("El saldo no coincide con el historial. Requiere revisión antes de registrar movimientos.");
  return cantidad;
}
export async function actualizarSaldo(tx: Tx, org: string, producto: string, cantidad: bigint) {
  if (cantidad < BigInt(0)) throw new InventarioError("Stock insuficiente: la operación dejaría stock negativo.");
  if (cantidad > BigInt("99999999999999")) throw new InventarioError("El saldo supera la precisión permitida.");
  await tx.saldoStock.update({ where: { organizacionId_productoId: { organizacionId: org, productoId: producto } }, data: { cantidad: decimalStock(cantidad) } });
}
