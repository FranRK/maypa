import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { exigirOrganizacion } from "../auth/server";

export class InventarioError extends Error {}
export function milesimas(valor: string): bigint {
  const negativo = valor.startsWith("-");
  const [entero, fraccion = ""] = valor.replace(/^-/, "").split(".");
  const cantidad = BigInt(entero) * BigInt(1000) + BigInt(fraccion.padEnd(3, "0"));
  return negativo ? -cantidad : cantidad;
}
export function decimalStock(valor: bigint): string {
  const absoluto = valor < 0 ? -valor : valor;
  return `${valor < 0 ? "-" : ""}${absoluto / BigInt(1000)}.${String(absoluto % BigInt(1000)).padStart(3, "0")}`;
}
const cantidadSchema = z.string().trim().transform(v => v.replace(",", ".")).refine(
  v => /^-?\d{1,11}(?:\.\d{1,3})?$/.test(v) && milesimas(v) !== BigInt(0),
  "Ingresá una cantidad distinta de cero, con hasta 11 enteros y 3 decimales.",
);
export const movimientoSchema = z.object({
  productoId: z.uuid(),
  tipo: z.enum(["INICIAL", "COMPRA", "AJUSTE"]),
  cantidad: cantidadSchema,
  nota: z.string().trim().max(500).default(""),
  claveIdempotencia: z.uuid(),
}).superRefine((v, ctx) => {
  if (/^-?\d{1,11}(?:\.\d{1,3})?$/.test(v.cantidad) && v.tipo !== "AJUSTE" && milesimas(v.cantidad) < BigInt(0)) {
    ctx.addIssue({ code: "custom", path: ["cantidad"], message: "El stock inicial y los ingresos deben ser positivos." });
  }
  if (v.tipo === "AJUSTE" && !v.nota) ctx.addIssue({ code: "custom", path: ["nota"], message: "El motivo del ajuste es obligatorio." });
});
export const filtrosInventarioSchema = z.object({
  buscar: z.string().trim().max(100).default(""),
  estado: z.enum(["todos", "activos", "inactivos"]).default("activos"),
  stock: z.enum(["todos", "bajo", "sin_stock"]).default("todos"),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  historialPagina: z.coerce.number().int().min(1).max(100000).default(1),
  producto: z.uuid().optional(),
  tipo: z.enum(["todos", "INICIAL", "COMPRA", "AJUSTE", "VENTA", "ANULACION_VENTA", "DEVOLUCION"]).default("todos"),
});
type Decimal = { toString(): string };
type FilaStock = { id: string; sku: string; nombre: string; unidad: string; activo: boolean; cantidad: Decimal; stockMinimo: Decimal; bajo: boolean };
const MAX_STOCK = BigInt("99999999999999");

export function crearServicioInventario(db: PrismaClient, autorizar: typeof exigirOrganizacion) {
  async function escrituraDisponible() {
    const [row] = await db.$queryRaw<{ disponible: boolean }[]>`
      SELECT (
        (SELECT count(*) FROM pg_attribute WHERE attrelid='public."MovimientoStock"'::regclass
          AND attname IN ('claveIdempotencia','huellaSolicitud') AND NOT attisdropped) = 2
        AND (SELECT count(*) FROM pg_constraint WHERE conrelid='public."MovimientoStock"'::regclass AND convalidated
          AND conname IN ('MovimientoStock_idempotencia_coherente','MovimientoStock_independiente_idempotente','MovimientoStock_ajuste_con_motivo')) = 3
        AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public."MovimientoStock_inicial_unico"') AND indisunique AND indisvalid)
        AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public."MovimientoStock_organizacionId_claveIdempotencia_key"') AND indisunique AND indisvalid)
      ) AS disponible`;
    return row.disponible;
  }
  return {
    async listar(organizacionId: string | undefined, input: unknown) {
      const context = await autorizar(organizacionId, "VER_INVENTARIO");
      const filtros = filtrosInventarioSchema.parse(input);
      const org = context.organizacion.id;
      if (filtros.producto && !await db.producto.findFirst({ where: { id: filtros.producto, organizacionId: org }, select: { id: true } })) {
        throw new InventarioError("Producto no disponible en esta organización.");
      }
      const pattern = `%${filtros.buscar.replace(/[\\%_]/g, "\\$&")}%`;
      const [conteo] = await db.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM public."Producto" p
        LEFT JOIN public."SaldoStock" s ON s."organizacionId"=p."organizacionId" AND s."productoId"=p.id
        WHERE p."organizacionId"=${org}::uuid AND (p.nombre ILIKE ${pattern} OR p.sku ILIKE ${pattern})
          AND (${filtros.estado}='todos' OR p.activo=(${filtros.estado}='activos'))
          AND (${filtros.stock}='todos' OR (${filtros.stock}='bajo' AND coalesce(s.cantidad,0)<p."stockMinimo")
            OR (${filtros.stock}='sin_stock' AND coalesce(s.cantidad,0)=0))`;
      const paginas = Math.max(1, Math.ceil(conteo.total / 10));
      const pagina = Math.min(filtros.pagina, paginas);
      const productos = await db.$queryRaw<FilaStock[]>`
        SELECT p.id,p.sku,p.nombre,p.unidad,p.activo,p."stockMinimo",coalesce(s.cantidad,0) AS cantidad,
          coalesce(s.cantidad,0)<p."stockMinimo" AS bajo
        FROM public."Producto" p LEFT JOIN public."SaldoStock" s ON s."organizacionId"=p."organizacionId" AND s."productoId"=p.id
        WHERE p."organizacionId"=${org}::uuid AND (p.nombre ILIKE ${pattern} OR p.sku ILIKE ${pattern})
          AND (${filtros.estado}='todos' OR p.activo=(${filtros.estado}='activos'))
          AND (${filtros.stock}='todos' OR (${filtros.stock}='bajo' AND coalesce(s.cantidad,0)<p."stockMinimo")
            OR (${filtros.stock}='sin_stock' AND coalesce(s.cantidad,0)=0))
        ORDER BY p.nombre,p.id LIMIT 10 OFFSET ${(pagina - 1) * 10}`;
      const where = { organizacionId: org, ...(filtros.producto ? { productoId: filtros.producto } : {}), ...(filtros.tipo === "todos" ? {} : { tipo: filtros.tipo }) };
      const historialTotal = await db.movimientoStock.count({ where });
      const historialPaginas = Math.max(1, Math.ceil(historialTotal / 20));
      const historialPagina = Math.min(filtros.historialPagina, historialPaginas);
      // Select explícito permite consultar mientras la migración adicional está pendiente.
      const historial = await db.movimientoStock.findMany({ where, orderBy: [{ creadoEn: "desc" }, { id: "desc" }], take: 20, skip: (historialPagina - 1) * 20,
        select: { id: true, creadoEn: true, usuarioId: true, tipo: true, variacion: true, nota: true, producto: { select: { nombre: true, sku: true, unidad: true } } },
      });
      return { context, productos, historial, total: conteo.total, paginas, historialTotal, historialPaginas,
        filtros: { ...filtros, pagina, historialPagina }, escrituraDisponible: await escrituraDisponible() };
    },
    async registrar(organizacionId: string, input: unknown) {
      const context = await autorizar(organizacionId, "ADMINISTRAR_INVENTARIO");
      const data = movimientoSchema.parse(input);
      if (!await escrituraDisponible()) throw new InventarioError("Falta aplicar la migración de idempotencia de inventario. No se registró ningún movimiento.");
      const org = context.organizacion.id;
      const variacion = decimalStock(milesimas(data.cantidad));
      const huella = createHash("sha256").update(JSON.stringify([org, context.user.id, data.productoId, data.tipo, variacion, data.nota])).digest("hex");
      return db.$transaction(async tx => {
        const miembros = await tx.$queryRaw<{ activa: boolean; rol: string }[]>`
          SELECT activa,rol FROM public."MiembroOrganizacion"
          WHERE "organizacionId"=${org}::uuid AND "usuarioId"=${context.user.id}::uuid FOR SHARE`;
        if (!miembros[0]?.activa || !["PROPIETARIO", "ADMINISTRADOR"].includes(miembros[0].rol)) throw new InventarioError("Tu membresía no permite registrar movimientos.");
        // Serializar la misma clave incluso cuando todavía no existe su fila.
        await tx.$queryRaw`SELECT 1 AS bloqueado FROM pg_advisory_xact_lock(hashtextextended(${`${org}:${data.claveIdempotencia}`},0))`;
        const anterior = await tx.movimientoStock.findUnique({ where: { organizacionId_claveIdempotencia: { organizacionId: org, claveIdempotencia: data.claveIdempotencia } } });
        if (anterior) {
          if (anterior.huellaSolicitud !== huella) throw new InventarioError("La clave de reintento ya fue utilizada para otra operación.");
          return { id: anterior.id, repetido: true };
        }
        // El producto siempre existe: bloquearlo resuelve también el caso sin saldo.
        const productos = await tx.$queryRaw<{ activo: boolean }[]>`
          SELECT activo FROM public."Producto" WHERE "organizacionId"=${org}::uuid AND id=${data.productoId}::uuid FOR UPDATE`;
        if (!productos[0]?.activo) throw new InventarioError("Producto inactivo o no disponible en esta organización.");
        const key = { organizacionId: org, productoId: data.productoId };
        if (data.tipo === "INICIAL" && await tx.movimientoStock.count({ where: key })) throw new InventarioError("El stock inicial solo puede ser el primer movimiento del producto.");
        await tx.saldoStock.upsert({ where: { organizacionId_productoId: key }, create: { ...key, cantidad: "0" }, update: {} });
        const [saldo] = await tx.$queryRaw<{ cantidad: Decimal }[]>`
          SELECT cantidad FROM public."SaldoStock" WHERE "organizacionId"=${org}::uuid AND "productoId"=${data.productoId}::uuid FOR UPDATE`;
        const historial = await tx.movimientoStock.aggregate({ where: key, _sum: { variacion: true } });
        if (milesimas(saldo.cantidad.toString()) !== milesimas(historial._sum.variacion?.toString() ?? "0")) {
          throw new InventarioError("El saldo no coincide con el historial. Requiere revisión antes de registrar movimientos.");
        }
        const siguiente = milesimas(saldo.cantidad.toString()) + milesimas(variacion);
        if (siguiente < BigInt(0)) throw new InventarioError("El movimiento dejaría stock negativo.");
        if (siguiente > MAX_STOCK) throw new InventarioError("El saldo supera la precisión permitida.");
        const movimiento = await tx.movimientoStock.create({ data: { ...key, usuarioId: context.user.id, tipo: data.tipo, variacion, nota: data.nota || null,
          claveIdempotencia: data.claveIdempotencia, huellaSolicitud: huella } });
        await tx.saldoStock.update({ where: { organizacionId_productoId: key }, data: { cantidad: decimalStock(siguiente) } });
        return { id: movimiento.id, repetido: false };
      }, { timeout: 15000, maxWait: 15000 });
    },
  };
}
