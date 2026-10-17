"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { productos } from "@/lib/productos/server";
import { ProductoError } from "@/lib/productos/service";
import { AutorizacionError } from "@/lib/auth/policy";

export type EstadoFormulario = { mensaje?: string; ok?: boolean; errores?: Record<string, string[]> };
function errorFormulario(error: unknown): EstadoFormulario {
  if (error instanceof z.ZodError) return { mensaje: "Revisá los campos indicados.", errores: z.flattenError(error).fieldErrors };
  if (error instanceof AutorizacionError && error.code === "PERFIL_INCOMPLETO") return { mensaje: "Tu perfil no tiene nombre y apellido cargados: completalos para poder operar." };
  if (error instanceof AutorizacionError) return { mensaje: "No tenés una sesión o membresía con permisos para esta operación." };
  if (error instanceof ProductoError) return { mensaje: error.message };
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    return { mensaje: "Ya existe un producto con ese SKU en esta organización.", errores: { sku: ["El SKU ya está en uso."] } };
  }
  return { mensaje: "No se pudo guardar el cambio. Intentá nuevamente." };
}
export async function guardarProducto(org: string, id: string | undefined, _prev: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  void _prev;
  try {
    await productos.guardar(org, id, Object.fromEntries(["sku", "nombre", "unidad", "precioVenta", "stockMinimo"].map(k => [k, form.get(k)])));
  } catch (error) { return errorFormulario(error); }
  refresh();
  return { ok: true, mensaje: id ? "Producto actualizado." : "Producto creado." };
}
export async function cambiarEstadoProducto(org: string, id: string, activo: boolean, _prev: EstadoFormulario): Promise<EstadoFormulario> {
  void _prev;
  try { await productos.cambiarEstado(org, id, activo); }
  catch (error) { return errorFormulario(error); }
  refresh();
  return { ok: true, mensaje: activo ? "Producto reactivado." : "Producto desactivado. Se conserva su historial." };
}
