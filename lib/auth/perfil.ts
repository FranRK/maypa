import type { PrismaClient } from "../../src/generated/prisma/client";
import { evaluarPerfilDesdeFila, type EvaluacionPerfil } from "./policy";
import { perfilSchema, nombresDeMetadata, type DatosPerfil } from "./perfil-reglas";

// Las reglas viven en un modulo puro (solo Zod) para poder usarlas tambien desde el
// formulario del cliente; aca se reexportan para quien ya importa este modulo.
export { PERFIL_CAMPO_MAX, perfilSchema, nombresDeMetadata, type DatosPerfil } from "./perfil-reglas";

// Lee el perfil con el cliente Prisma disponible (servidor o scripts locales).
// `findUnique` sin `select` devuelve todas las columnas que el cliente generado
// conoce: mientras ese cliente todavia no incluya "nombre"/"apellido" la evaluacion
// es NO_EVALUABLE y la regla de la etapa 10 no bloquea. Se vuelve efectiva al
// regenerar el cliente despues de aplicar la fase 1.
export async function evaluarPerfilConPrisma(prisma: PrismaClient, userId: string): Promise<EvaluacionPerfil> {
  return evaluarPerfilDesdeFila(await prisma.perfil.findUnique({ where: { id: userId } }));
}

// Escribe el nombre y el apellido en la fila `usuarioId` (una sola fila: la clave es el
// propio usuario). Valida antes de tocar la base, asi un valor vacio no llega nunca al
// INSERT/UPDATE. Si la fila no existe la crea; si existe la actualiza sin duplicarla.
export async function guardarPerfil(prisma: PrismaClient, usuarioId: string, datos: unknown): Promise<DatosPerfil> {
  const limpio = perfilSchema.parse(datos);
  await prisma.perfil.upsert({
    where: { id: usuarioId },
    create: { id: usuarioId, nombre: limpio.nombre, apellido: limpio.apellido },
    update: { nombre: limpio.nombre, apellido: limpio.apellido },
  });
  return limpio;
}

// Etapa 10, registro: los nombres que la persona declaro al crear la cuenta viven en la
// metadata de Auth. Esta funcion los lleva a public."Perfil" cuando el perfil todavia
// esta incompleto, por ejemplo si el alta se confirmo por correo y la sesion no estaba
// disponible al registrarse. Es idempotente y nunca pisa un perfil ya completo: si la
// persona cargo sus datos despues, esos mandan. Devuelve el estado con el que queda.
export async function completarPerfilDesdeMetadata(prisma: PrismaClient, usuarioId: string, metadata: unknown): Promise<EvaluacionPerfil> {
  const actual = await evaluarPerfilConPrisma(prisma, usuarioId);
  if (actual !== "INCOMPLETO") return actual;
  const nombres = nombresDeMetadata(metadata);
  if (!nombres) return actual;
  await guardarPerfil(prisma, usuarioId, nombres);
  return "COMPLETO";
}
