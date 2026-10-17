import type { PrismaClient } from "../../src/generated/prisma/client";
import type { exigirOrganizacion } from "../auth/server";
import { rangoDelDiaAr } from "../fechas";

// Decisión de la etapa 9: "ventas del día" son ventas brutas confirmadas.
// Las devoluciones y anulaciones todavía no existen como operación. Cuando existan,
// el neto se calculará restando DevolucionVenta, sin cambiar este filtro
// (ver docs/etapa-9-dashboard.md).
export const ESTADOS_VENTA_BRUTA = ["CONFIRMADA"] as const;
export const LIMITE_LIGERO = 5;

export type OpcionesResumen = {
  /** Punto de referencia para el corte del día. Solo para pruebas; por defecto, ahora. */
  ahora?: Date;
};

export function crearServicioDashboard(db: PrismaClient, autorizar: typeof exigirOrganizacion) {
  return {
    async resumen(organizacionId: string | undefined, opciones: OpcionesResumen = {}) {
      // La organización autorizada sale de la sesión, nunca de un identificador del cliente.
      const context = await autorizar(organizacionId, "VER_DASHBOARD");
      const org = context.organizacion.id;
      const { inicio, fin } = rangoDelDiaAr(opciones.ahora ?? new Date());
      const [delDia, stockBajo, ultimasVentas, movimientos] = await Promise.all([
        db.venta.aggregate({
          where: { organizacionId: org, estado: { in: [...ESTADOS_VENTA_BRUTA] }, creadaEn: { gte: inicio, lt: fin } },
          _sum: { total: true },
          _count: { _all: true },
        }),
        db.$queryRaw<{ total: number }[]>`
          SELECT count(*)::int AS total
          FROM public."Producto" p
          LEFT JOIN public."SaldoStock" s
            ON s."organizacionId" = p."organizacionId" AND s."productoId" = p.id
          WHERE p."organizacionId" = ${org}::uuid
            AND p.activo
            AND coalesce(s.cantidad, 0) < p."stockMinimo"`,
        db.venta.findMany({
          where: { organizacionId: org },
          orderBy: [{ creadaEn: "desc" }, { id: "desc" }],
          take: LIMITE_LIGERO,
          // El nombre del autor sale de la membresía de ESTA organización (relación
          // compuesta organizacionId+usuarioId): nunca de otra empresa.
          select: { id: true, total: true, estado: true, creadaEn: true, creadaPor: true,
            creador: { select: { perfil: { select: { nombre: true, apellido: true } } } } },
        }),
        db.movimientoStock.findMany({
          where: { organizacionId: org },
          orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
          take: LIMITE_LIGERO,
          select: { id: true, productoId: true, tipo: true, variacion: true, creadoEn: true, usuarioId: true, nota: true,
            producto: { select: { nombre: true, sku: true, unidad: true } },
            autor: { select: { perfil: { select: { nombre: true, apellido: true } } } } },
        }),
      ]);
      return {
        context,
        ventasDelDia: { cantidad: delDia._count._all, total: delDia._sum.total?.toFixed(2) ?? "0.00" },
        stockBajo: stockBajo[0]?.total ?? 0,
        ultimasVentas,
        movimientos,
      };
    },
  };
}
