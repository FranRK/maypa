"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AutorizacionError } from "@/lib/auth/policy";
import { guardarPerfilDeSesion } from "@/lib/auth/server";

export type EstadoPerfil = { mensaje?: string; errores?: Record<string, string[]> };

// Etapa 10: guarda el nombre y el apellido de quien tiene la sesion. La identidad la
// resuelve `guardarPerfilDeSesion` desde la sesion verificada de Supabase Auth: los
// campos del formulario solo aportan nombre y apellido, nunca un id.
export async function guardarPerfil(_prev: EstadoPerfil, form: FormData): Promise<EstadoPerfil> {
  void _prev;
  try {
    await guardarPerfilDeSesion({ nombre: form.get("nombre"), apellido: form.get("apellido") });
  } catch (error) {
    if (error instanceof z.ZodError) return { mensaje: "Revisá los campos indicados.", errores: z.flattenError(error).fieldErrors };
    if (error instanceof AutorizacionError && error.code === "NO_AUTENTICADO") return { mensaje: "Tu sesión no está activa: volvé a iniciar sesión." };
    return { mensaje: "No se pudo guardar el perfil. Reintentá: no se cambió nada." };
  }
  redirect("/dashboard");
}
