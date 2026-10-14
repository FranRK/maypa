import { z } from "zod";
import type { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import type { exigirOrganizacion } from "../auth/server";

// Strings decimales: conservar precisión y rechazar redondeos implícitos de PostgreSQL.
function decimal(enteros: number, escala: number) {
  return z.string().trim().transform(v => v.replace(",", ".")).refine(
    v => new RegExp(`^\\d{1,${enteros}}(?:\\.\\d{1,${escala}})?$`).test(v),
    `Ingresá un valor no negativo, con hasta ${enteros} enteros y ${escala} decimales.`,
  );
}
export const productoSchema = z.object({
  sku: z.string().trim().min(1, "El SKU es obligatorio.").max(100),
  nombre: z.string().trim().min(1, "El nombre es obligatorio.").max(200),
  unidad: z.string().trim().min(1, "La unidad es obligatoria.").max(50),
  precioVenta: decimal(12, 2),
  stockMinimo: decimal(11, 3),
});
export const filtrosSchema = z.object({
  buscar: z.string().trim().max(100).default(""),
  estado: z.enum(["todos", "activos", "inactivos"]).default("activos"),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
});
const idSchema = z.uuid();
export class ProductoError extends Error {}

export function crearServicioProductos(db: PrismaClient, autorizar: typeof exigirOrganizacion) {
  async function escribir<T>(organizacionId: string, operation: (tx: Prisma.TransactionClient, org: string) => Promise<T>) {
    const context = await autorizar(organizacionId, "ADMINISTRAR_PRODUCTOS");
    return db.$transaction(async tx => {
      // Bloquear la membresía durante la escritura: una baja/cambio de rol no
      // puede intercalarse entre la comprobación de permisos y la modificación.
      const membresias = await tx.$queryRaw<{ rol: string; activa: boolean }[]>`
        SELECT rol, activa FROM public."MiembroOrganizacion"
        WHERE "organizacionId" = ${context.organizacion.id}::uuid
          AND "usuarioId" = ${context.user.id}::uuid FOR SHARE`;
      if (!membresias[0]?.activa || !["PROPIETARIO", "ADMINISTRADOR"].includes(membresias[0].rol)) {
        throw new ProductoError("Tu membresía ya no permite modificar productos.");
      }
      return operation(tx, context.organizacion.id);
    });
  }
  return {
    async listar(organizacionId: string | undefined, input: unknown) {
      const context = await autorizar(organizacionId, "VER_PRODUCTOS");
      const filtros = filtrosSchema.parse(input);
      const where: Prisma.ProductoWhereInput = {
        organizacionId: context.organizacion.id,
        ...(filtros.estado === "todos" ? {} : { activo: filtros.estado === "activos" }),
        ...(filtros.buscar ? { OR: [
          { nombre: { contains: filtros.buscar, mode: "insensitive" } },
          { sku: { contains: filtros.buscar, mode: "insensitive" } },
        ] } : {}),
      };
      const total = await db.producto.count({ where });
      const paginas = Math.max(1, Math.ceil(total / 10));
      const pagina = Math.min(filtros.pagina, paginas);
      const productos = await db.producto.findMany({ where, orderBy: [{ nombre: "asc" }, { id: "asc" }], skip: (pagina - 1) * 10, take: 10 });
      return { context, productos, total, paginas, filtros: { ...filtros, pagina } };
    },
    async guardar(organizacionId: string, id: string | undefined, input: unknown) {
      // Autorizar incluso cuando la entrada es inválida.
      return escribir(organizacionId, async (tx, org) => {
        const data = productoSchema.parse(input);
        if (!id) return tx.producto.create({ data: { ...data, organizacionId: org } });
        idSchema.parse(id);
        const result = await tx.producto.updateMany({ where: { organizacionId: org, id }, data });
        if (!result.count) throw new ProductoError("Producto no disponible en esta organización.");
        return tx.producto.findUniqueOrThrow({ where: { organizacionId_id: { organizacionId: org, id } } });
      });
    },
    async cambiarEstado(organizacionId: string, id: string, activo: boolean) {
      return escribir(organizacionId, async (tx, org) => {
        idSchema.parse(id);
        z.boolean().parse(activo);
        const result = await tx.producto.updateMany({ where: { organizacionId: org, id }, data: { activo } });
        if (!result.count) throw new ProductoError("Producto no disponible en esta organización.");
      });
    },
  };
}
