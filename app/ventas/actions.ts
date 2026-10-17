"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { ventas } from "@/lib/ventas/server";
import { VentaError } from "@/lib/ventas/service";
import { InventarioError } from "@/lib/inventario/transacciones";
import { AutorizacionError } from "@/lib/auth/policy";

export type Cotizacion = Awaited<ReturnType<typeof ventas.cotizar>>;
export type ProductoVenta = Awaited<ReturnType<typeof ventas.buscarProductos>>["productos"][number];
export type EstadoVenta = { id?: string; mensaje?: string; incierto?: boolean };
function errorSeguro(error: unknown): string | undefined {
  if (error instanceof z.ZodError) return error.issues.map(i => i.message).join(" ");
  if (error instanceof VentaError || error instanceof InventarioError) return error.message;
  if (error instanceof AutorizacionError && error.code === "PERFIL_INCOMPLETO") return "Tu perfil no tiene nombre y apellido cargados: completalos para poder operar.";
  if (error instanceof AutorizacionError) return "No tenés una sesión o membresía activa con permisos.";
}
export async function buscarProductosVenta(org: string, buscar: string, pagina: number) {
  try { return { ...await ventas.buscarProductos(org, { buscar, pagina }) }; }
  catch (error) { return { mensaje: errorSeguro(error) ?? "No se pudieron consultar los productos." }; }
}
export async function cotizarVenta(org: string, items: unknown): Promise<{ cotizacion?: Cotizacion; mensaje?: string }> {
  try { return { cotizacion: await ventas.cotizar(org, items) }; }
  catch (error) { return { mensaje: errorSeguro(error) ?? "No se pudo revisar la venta." }; }
}
export async function confirmarVenta(org: string, _prev: EstadoVenta, form: FormData): Promise<EstadoVenta> {
  void _prev;
  let result;
  try {
    const raw = form.get("solicitud");
    if (typeof raw !== "string" || raw.length > 30000) return { mensaje: "Solicitud inválida." };
    let input;
    try { input = JSON.parse(raw); } catch { return { mensaje: "Solicitud inválida." }; }
    result = await ventas.registrar(org, input);
  } catch (error) {
    const mensaje = errorSeguro(error);
    return mensaje ? { mensaje } : { incierto: true, mensaje: "No se pudo verificar el resultado. Reintentá esta misma solicitud para recuperar la venta sin duplicarla." };
  }
  refresh();
  return { id: result.id, mensaje: result.repetido ? "La venta ya estaba registrada. No se duplicó." : "Venta confirmada y stock actualizado." };
}
