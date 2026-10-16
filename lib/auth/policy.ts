import type { RolMiembro } from "../../src/generated/prisma/enums";

export type UsuarioAutenticado = { id: string; email?: string };
export type Membresia = {
  organizacionId: string;
  usuarioId: string;
  activa: boolean;
  rol: RolMiembro;
  organizacion: { id: string; nombre: string; slug: string };
};
export type Permiso = "VER_DASHBOARD" | "ADMINISTRAR_ORGANIZACION" | "VER_PRODUCTOS" | "ADMINISTRAR_PRODUCTOS" | "VER_INVENTARIO" | "ADMINISTRAR_INVENTARIO" | "VER_VENTAS" | "REGISTRAR_VENTAS";
export type CodigoAutorizacion = "NO_AUTENTICADO" | "SIN_ORGANIZACION" | "ACCESO_DENEGADO" | "ROL_INSUFICIENTE";

export class AutorizacionError extends Error {
  code: CodigoAutorizacion;
  constructor(code: CodigoAutorizacion) {
    super(code);
    this.code = code;
    this.name = "AutorizacionError";
  }
}

export function permiteOperacion(rol: RolMiembro, permiso: Permiso) {
  if (permiso === "ADMINISTRAR_ORGANIZACION") return rol === "PROPIETARIO";
  if (["ADMINISTRAR_PRODUCTOS", "ADMINISTRAR_INVENTARIO"].includes(permiso)) return ["PROPIETARIO", "ADMINISTRADOR"].includes(rol);
  return ["VER_DASHBOARD", "VER_PRODUCTOS", "VER_INVENTARIO", "VER_VENTAS", "REGISTRAR_VENTAS"].includes(permiso) && ["PROPIETARIO", "ADMINISTRADOR", "EMPLEADO"].includes(rol);
}

// Las dependencias se vinculan exclusivamente en el modulo server-only.
// No recibe identidad ni rol desde parametros de una peticion.
export function crearAutorizacion(deps: {
  getUser: () => Promise<UsuarioAutenticado | null>;
  findMemberships: (userId: string) => Promise<Membresia[]>;
}) {
  async function obtenerUsuario() {
    const user = await deps.getUser();
    if (!user) throw new AutorizacionError("NO_AUTENTICADO");
    return user;
  }
  async function membresiasDe(user: UsuarioAutenticado) {
    const memberships = await deps.findMemberships(user.id);
    return memberships.filter(m => m.activa && m.usuarioId === user.id);
  }
  return {
    obtenerUsuario,
    async obtenerMembresiasActivas() {
      return membresiasDe(await obtenerUsuario());
    },
    async exigirOrganizacion(organizacionId?: string, permiso: Permiso = "VER_DASHBOARD") {
      const user = await obtenerUsuario();
      if (organizacionId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(organizacionId)) {
        throw new AutorizacionError("ACCESO_DENEGADO");
      }
      const memberships = await membresiasDe(user);
      const membership = organizacionId === undefined ? memberships[0] : memberships.find(m => m.organizacionId === organizacionId);
      if (!membership) throw new AutorizacionError(organizacionId === undefined ? "SIN_ORGANIZACION" : "ACCESO_DENEGADO");
      if (!permiteOperacion(membership.rol, permiso)) throw new AutorizacionError("ROL_INSUFICIENTE");
      return { user, membership, organizacion: membership.organizacion };
    },
  };
}
