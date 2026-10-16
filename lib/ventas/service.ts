import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { exigirOrganizacion } from "../auth/server";
import { decimalStock, milesimas } from "../inventario/cantidades";
import { bloquearMembresia, bloquearClave, bloquearProducto, saldoConsistente, actualizarSaldo } from "../inventario/transacciones";
import { DecimalVenta, subtotalVenta } from "./importes";

export class VentaError extends Error {}
const uuid = z.uuid().transform(v => v.toLowerCase());
const itemSchema = z.object({ productoId: uuid, cantidad: z.string().trim().transform(v => v.replace(",", "."))
  .refine(v => /^\d{1,11}(?:\.\d{1,3})?$/.test(v) && milesimas(v) > BigInt(0), "La cantidad debe ser positiva, con hasta tres decimales.") });
export const itemsVentaSchema = z.array(itemSchema).min(1, "Agregá un producto.").max(100, "Máximo 100 productos por venta.")
  .superRefine((items, ctx) => { if (new Set(items.map(i => i.productoId)).size !== items.length) ctx.addIssue({ code: "custom", message: "Un producto no puede aparecer dos veces." }); })
  .transform(items => items.map(i => ({ ...i, cantidad: decimalStock(milesimas(i.cantidad)) })).sort((a,b) => a.productoId.localeCompare(b.productoId)));
export const ventaSchema = z.object({ claveIdempotencia: uuid, items: itemsVentaSchema, revisionPrecios: z.string().regex(/^[0-9a-f]{64}$/) });
const filtrosSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1) });
const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
const revision = (org: string, items: { productoId: string; precioUnitario: string }[]) => hash([org, items.map(i => [i.productoId, i.precioUnitario])]);
const maxImporte = new DecimalVenta("999999999999.99");

export function crearServicioVentas(db: PrismaClient, autorizar: typeof exigirOrganizacion) {
  return {
    async buscarProductos(organizacionId: string, input: unknown) {
      const { organizacion } = await autorizar(organizacionId, "REGISTRAR_VENTAS");
      const filtros = z.object({ buscar: z.string().trim().max(100).default(""), pagina: z.coerce.number().int().min(1).max(100000).default(1) }).parse(input);
      const productos = await db.producto.findMany({ where: { organizacionId: organizacion.id, activo: true,
        OR: [{ nombre: { contains: filtros.buscar, mode: "insensitive" } }, { sku: { contains: filtros.buscar, mode: "insensitive" } }] },
        orderBy: [{ nombre: "asc" }, { id: "asc" }], take: 21, skip: (filtros.pagina - 1) * 20,
        select: { id: true, nombre: true, sku: true, unidad: true, precioVenta: true, saldos: { select: { cantidad: true } } } });
      return { hayMas: productos.length > 20, productos: productos.slice(0,20).map(p => ({ id: p.id, nombre: p.nombre, sku: p.sku, unidad: p.unidad,
        precio: p.precioVenta.toFixed(2), stock: p.saldos[0]?.cantidad.toFixed(3) ?? "0.000" })) };
    },
    async cotizar(organizacionId: string, input: unknown) {
      const { organizacion } = await autorizar(organizacionId, "REGISTRAR_VENTAS");
      const items = itemsVentaSchema.parse(input);
      const productos = await db.producto.findMany({ where: { organizacionId: organizacion.id, id: { in: items.map(i => i.productoId) }, activo: true }, include: { saldos: true } });
      let total = new DecimalVenta(0);
      const detalles = items.map(i => {
        const p = productos.find(p => p.id === i.productoId);
        if (!p) throw new VentaError("Producto inactivo o no disponible en esta organización. Revisá el carrito.");
        const stock = p.saldos[0]?.cantidad.toFixed(3) ?? "0.000";
        if (milesimas(stock) < milesimas(i.cantidad)) throw new VentaError(`Stock insuficiente para ${p.sku}. Disponible: ${stock}.`);
        const subtotal = subtotalVenta(i.cantidad, p.precioVenta.toString());
        total = total.add(subtotal);
        return { ...i, nombre: p.nombre, sku: p.sku, stock, precioUnitario: p.precioVenta.toFixed(2), subtotal: subtotal.toFixed(2) };
      });
      if (total.gt(maxImporte)) throw new VentaError("El total supera el importe máximo permitido.");
      return { detalles, total: total.toFixed(2), revisionPrecios: revision(organizacion.id, detalles) };
    },
    async registrar(organizacionId: string, input: unknown) {
      const context = await autorizar(organizacionId, "REGISTRAR_VENTAS");
      const data = ventaSchema.parse(input), org = context.organizacion.id;
      const huella = hash([org, context.user.id, data.items, data.revisionPrecios]);
      return db.$transaction(async tx => {
        await bloquearMembresia(tx, org, context.user.id, "REGISTRAR_VENTAS");
        await bloquearClave(tx, `venta:${org}:${data.claveIdempotencia}`);
        const anterior = await tx.venta.findUnique({ where: { organizacionId_claveIdempotencia: { organizacionId: org, claveIdempotencia: data.claveIdempotencia } } });
        if (anterior) {
          if (anterior.huellaSolicitud !== huella) throw new VentaError("La clave de reintento ya fue utilizada para otra solicitud.");
          return { id: anterior.id, repetido: true };
        }
        // Adquirir TODOS los bloqueos de producto ordenados antes de bloquear saldos.
        const productos: Awaited<ReturnType<typeof bloquearProducto>>[] = [];
        for (const item of data.items) productos.push(await bloquearProducto(tx, org, item.productoId));
        const precios = data.items.map((i,index) => ({ productoId: i.productoId, precioUnitario: productos[index].precioVenta.toFixed(2) }));
        if (revision(org, precios) !== data.revisionPrecios) throw new VentaError("Cambiaron los precios. Revisá nuevamente el total antes de confirmar.");
        let total = new DecimalVenta(0);
        const detalles = data.items.map((i,index) => {
          const subtotal = subtotalVenta(i.cantidad, precios[index].precioUnitario);
          total = total.add(subtotal);
          return { ...i, precioUnitario: precios[index].precioUnitario, subtotal: subtotal.toFixed(2) };
        });
        if (total.gt(maxImporte)) throw new VentaError("El total supera el importe máximo permitido.");
        const venta = await tx.venta.create({ data: { organizacionId: org, creadaPor: context.user.id, estado: "CONFIRMADA", confirmadaEn: new Date(),
          total: total.toFixed(2), claveIdempotencia: data.claveIdempotencia, huellaSolicitud: huella } });
        for (const detalle of detalles) {
          const saldo = await saldoConsistente(tx, org, detalle.productoId);
          await actualizarSaldo(tx, org, detalle.productoId, saldo - milesimas(detalle.cantidad));
          const linea = await tx.detalleVenta.create({ data: { ...detalle, organizacionId: org, ventaId: venta.id } });
          await tx.movimientoStock.create({ data: { organizacionId: org, productoId: detalle.productoId, usuarioId: context.user.id,
            tipo: "VENTA", variacion: decimalStock(-milesimas(detalle.cantidad)), detalleVentaId: linea.id } });
        }
        return { id: venta.id, repetido: false };
      }, { timeout: 15000, maxWait: 15000 });
    },
    async listar(organizacionId: string | undefined, input: unknown) {
      const context = await autorizar(organizacionId, "VER_VENTAS");
      const filtros = filtrosSchema.parse(input), where = { organizacionId: context.organizacion.id };
      const total = await db.venta.count({ where }), paginas = Math.max(1, Math.ceil(total / 20)), pagina = Math.min(filtros.pagina, paginas);
      const ventas = await db.venta.findMany({ where, orderBy: [{ creadaEn: "desc" }, { id: "desc" }], take: 20, skip: (pagina-1)*20,
        select: { id: true, total: true, estado: true, creadaEn: true, creadaPor: true } });
      return { context, ventas, total, paginas, pagina };
    },
    async detalle(organizacionId: string | undefined, id: string) {
      const context = await autorizar(organizacionId, "VER_VENTAS");
      const venta = await db.venta.findFirst({ where: { organizacionId: context.organizacion.id, id: uuid.parse(id) },
        include: { detalles: { orderBy: { productoId: "asc" }, include: { producto: { select: { nombre: true, sku: true, unidad: true } }, movimientos: { select: { id: true, tipo: true, variacion: true } } } } } });
      if (!venta) throw new VentaError("Venta no disponible en esta organización.");
      return { context, venta };
    },
  };
}
