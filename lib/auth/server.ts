import "server-only";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { crearAutorizacion } from "./policy";

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
});

export const obtenerUsuarioAutenticado = authorization.obtenerUsuario;
export const obtenerMembresiasActivas = authorization.obtenerMembresiasActivas;
// Invocar tambien al inicio de cada futura Action/endpoint sensible.
export const exigirOrganizacion = authorization.exigirOrganizacion;
