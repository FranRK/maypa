import "server-only";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { crearAutorizacion, evaluarPerfilDesdeFila, type EvaluacionPerfil } from "./policy";
import { completarPerfilDesdeMetadata, evaluarPerfilConPrisma, guardarPerfil, nombresDeMetadata, type DatosPerfil } from "./perfil";

const authorization = crearAutorizacion({
  async getUser() {
    const supabase = await createClient();
    // Verificacion contra Auth, incluyendo estado actual del usuario/sesion.
    // Nunca autorizar con el user no verificado de getSession().
    const { data, error } = await supabase.auth.getUser();
    return error || !data.user ? null : { id: data.user.id, email: data.user.email };
  },
  async findMemberships(userId) {
    return prisma.miembroOrganizacion.findMany({
      where: { usuarioId: userId, activa: true },
      select: {
        organizacionId: true, usuarioId: true, activa: true, rol: true,
        organizacion: { select: { id: true, nombre: true, slug: true } },
      },
      orderBy: [{ organizacion: { nombre: "asc" } }, { organizacionId: "asc" }],
    });
  },
  // Etapa 10: sin nombre y apellido completos no se autorizan operaciones
  // comerciales. Mientras la fase 1 no este aplicada (o el cliente generado no
  // incluya las columnas) devuelve NO_EVALUABLE y no bloquea.
  evaluarPerfil: (userId) => evaluarPerfilConPrisma(prisma, userId),
});

export const obtenerUsuarioAutenticado = authorization.obtenerUsuario;
export const obtenerMembresiasActivas = authorization.obtenerMembresiasActivas;
// Invocar tambien al inicio de cada futura Action/endpoint sensible.
export const exigirOrganizacion = authorization.exigirOrganizacion;

// Etapa 10: estado del perfil de un usuario ya autorizado en la peticion. Sirve para el
// aviso de la interfaz; no vuelve a consultar Supabase Auth.
export async function estadoPerfilDeUsuario(usuarioId: string): Promise<EvaluacionPerfil> {
  return evaluarPerfilConPrisma(prisma, usuarioId);
}

// Etapa 10: guarda el nombre y el apellido del usuario autenticado. La identidad sale
// exclusivamente de la sesion verificada: el formulario no envia ningun id, y el que
// mande se ignora.
export async function guardarPerfilDeSesion(datos: unknown): Promise<DatosPerfil> {
  const usuario = await obtenerUsuarioAutenticado();
  return guardarPerfil(prisma, usuario.id, datos);
}

// Datos de la sesion para /perfil/completar. Si la fila todavia no existe o le falta
// algun dato, se ofrecen los nombres que la persona declaro al registrarse (metadata de
// Auth). Nunca se derivan del correo ni se inventan valores.
export async function perfilDeSesion() {
  const usuario = await usuarioDeAuth();
  if (!usuario) return null;
  const fila = await prisma.perfil.findUnique({ where: { id: usuario.id } });
  const actual = { nombre: fila?.nombre ?? "", apellido: fila?.apellido ?? "" };
  return {
    email: usuario.email,
    estado: evaluarPerfilDesdeFila(fila),
    inicial: actual.nombre && actual.apellido ? actual : (nombresDeMetadata(usuario.user_metadata) ?? actual),
  };
}

// Etapa 10, registro: lleva a public."Perfil" los nombres que la persona declaro al
// crear la cuenta. Recibe un usuario ya verificado en esta peticion; nunca un id que
// venga del formulario. Devuelve SIN_SESION cuando el alta todavia no tiene sesion
// (confirmacion por correo): esos nombres quedan en la metadata y se escriben al
// confirmar.
export async function completarPerfilDeUsuario(usuario: UsuarioAuth | null | undefined): Promise<EvaluacionPerfil | "SIN_SESION"> {
  if (!usuario?.id) return "SIN_SESION";
  return completarPerfilDesdeMetadata(prisma, usuario.id, usuario.user_metadata);
}

// Igual que la anterior, resolviendo la sesion de esta peticion. La usa la Server Action
// que el formulario de alta invoca cuando `signUp` ya dejo la sesion abierta.
export async function completarPerfilDeSesion(): Promise<EvaluacionPerfil | "SIN_SESION"> {
  return completarPerfilDeUsuario(await usuarioDeAuth());
}

type UsuarioAuth = { id: string; email?: string | null; user_metadata?: unknown };

async function usuarioDeAuth(): Promise<UsuarioAuth | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : { id: data.user.id, email: data.user.email, user_metadata: data.user.user_metadata };
}
