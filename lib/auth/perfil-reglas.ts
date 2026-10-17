import { z } from "zod";

// Etapa 10: validación del nombre y el apellido de public."Perfil".
// Módulo puro (solo Zod): lo usan la acción del servidor, los scripts de prueba y el
// formulario del cliente, sin arrastrar acceso a datos.
export const PERFIL_CAMPO_MAX = 80;

// Mismo criterio que los CHECK de PostgreSQL: se recorta y tiene que quedar al menos un
// carácter que no sea espacio en blanco. '\S' también excluye el espacio duro U+00A0, y
// la comparación se hace sobre el valor ya recortado: una cadena de solo espacios no
// pasa.
const campoPerfil = (etiqueta: string) => z
  .string()
  .trim()
  .min(1, `Ingresá ${etiqueta}.`)
  .max(PERFIL_CAMPO_MAX, `Usá ${PERFIL_CAMPO_MAX} caracteres o menos.`)
  .refine(valor => /\S/.test(valor), `Ingresá ${etiqueta} sin dejar solo espacios.`);

export const perfilSchema = z.object({
  nombre: campoPerfil("tu nombre"),
  apellido: campoPerfil("tu apellido"),
});

export type DatosPerfil = z.infer<typeof perfilSchema>;

// Nombres que la persona declaró al registrarse (metadata de Auth). Es una entrada no
// confiable: se valida con el mismo esquema y, si falta algo o no sirve, devuelve null
// para no escribir nada. Nunca se derivan del correo ni se inventan valores.
export function nombresDeMetadata(metadata: unknown): DatosPerfil | null {
  if (!metadata || typeof metadata !== "object") return null;
  const { nombre, apellido } = metadata as { nombre?: unknown; apellido?: unknown };
  const resultado = perfilSchema.safeParse({ nombre, apellido });
  return resultado.success ? resultado.data : null;
}
