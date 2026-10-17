"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { inventario } from "@/lib/inventario/server";
import { InventarioError } from "@/lib/inventario/service";
import { AutorizacionError } from "@/lib/auth/policy";
export type EstadoMovimiento = { ok?: boolean; mensaje?: string; errores?: Record<string, string[]> };
export async function registrarMovimiento(org: string, _prev: EstadoMovimiento, form: FormData): Promise<EstadoMovimiento> {
  void _prev;
  let result;
  try {
    result = await inventario.registrar(org, Object.fromEntries(["productoId", "tipo", "cantidad", "nota", "claveIdempotencia"].map(k => [k, form.get(k)])));
  } catch (error) {
    if (error instanceof z.ZodError) return { mensaje: "Revisá los campos indicados.", errores: z.flattenError(error).fieldErrors };
    if (error instanceof AutorizacionError && error.code === "PERFIL_INCOMPLETO") return { mensaje: "Tu perfil no tiene nombre y apellido cargados: completalos para poder operar." };
    if (error instanceof AutorizacionError) return { mensaje: "No tenés una sesión o membresía con permisos para registrar movimientos." };
    if (error instanceof InventarioError) return { mensaje: error.message };
    return { mensaje: "No se pudo confirmar el movimiento. Reintentá con la misma clave y los mismos datos; no se duplicará si ya fue registrado." };
  }
  refresh();
  return { ok: true, mensaje: result.repetido ? "Este movimiento ya estaba registrado. No se duplicó." : "Movimiento registrado y saldo actualizado." };
}
