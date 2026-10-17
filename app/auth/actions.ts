"use server";
import { completarPerfilDeSesion } from "@/lib/auth/server";
import type { EvaluacionPerfil } from "@/lib/auth/policy";

export type ResultadoPerfilDeRegistro = { estado: EvaluacionPerfil | "SIN_SESION" };

// Etapa 10: la llama el formulario de alta cuando `signUp` ya dejo la sesion abierta.
// Los nombres declarados viajaron en la metadata de Auth y aca terminan escritos en
// public."Perfil", que es lo unico que mira la autorizacion. Si todavia no hay sesion
// (alta pendiente de confirmar por correo) devuelve SIN_SESION y la persona los
// completa en /perfil/completar, precargados desde la misma metadata.
export async function completarPerfilDeRegistro(): Promise<ResultadoPerfilDeRegistro> {
  return { estado: await completarPerfilDeSesion() };
}
