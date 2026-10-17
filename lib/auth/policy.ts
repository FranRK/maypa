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
export type CodigoAutorizacion = "NO_AUTENTICADO" | "SIN_ORGANIZACION" | "ACCESO_DENEGADO" | "ROL_INSUFICIENTE" | "PERFIL_INCOMPLETO";

// Etapa 10: estado de public."Perfil"."nombre"/"apellido" para autorizar.
//   COMPLETO     nombre y apellido tienen contenido.
//   INCOMPLETO   falta alguno, esta vacio o solo tiene espacios; tampoco cuenta una
//                fila ausente.
//   NO_EVALUABLE la estructura desplegada todavia no tiene esas columnas. Se
//                distingue por la ausencia de la clave en la fila, nunca por
//                interpretar un error. Tras la fase 2 no deberia ocurrir; por las
//                dudas, las operaciones comerciales lo tratan como bloqueado (solo
//                COMPLETO autoriza escrituras) y las de consulta siguen permitidas.
export type EvaluacionPerfil = "COMPLETO" | "INCOMPLETO" | "NO_EVALUABLE";

// Operaciones comerciales: quedan registradas a nombre de la persona (autora de la
// venta o del movimiento) o cambian el catalogo. Sin nombre completo no se autorizan.
// Consultar (VER_*) sigue permitido: asi la persona puede ver que le falta cargar sus
// datos.
const PERMISOS_COMERCIALES: readonly Permiso[] = [
  "ADMINISTRAR_ORGANIZACION",
  "ADMINISTRAR_PRODUCTOS",
  "ADMINISTRAR_INVENTARIO",
  "REGISTRAR_VENTAS",
];

export function exigePerfilCompleto(permiso: Permiso) {
  return PERMISOS_COMERCIALES.includes(permiso);
}

// Mismo criterio que los CHECK de la base: al menos un caracter que no sea espacio en
// blanco. '\S' en JavaScript tambien excluye el espacio duro U+00A0, igual que
// '[^[:space:]]' en PostgreSQL.
const tieneContenido = (valor: unknown) => typeof valor === "string" && /\S/.test(valor);

// Traduce una fila de public."Perfil" leida con todas sus columnas (SELECT * o el
// modelo completo). La ausencia de la clave "nombre"/"apellido" distingue "la columna
// todavia no existe" de "la columna existe y esta en NULL": lo segundo es un perfil
// incompleto de verdad.
export function evaluarPerfilDesdeFila(fila: object | null | undefined): EvaluacionPerfil {
  if (!fila) return "INCOMPLETO";
  if (!Object.hasOwn(fila, "nombre") || !Object.hasOwn(fila, "apellido")) return "NO_EVALUABLE";
  const datos = fila as { nombre?: unknown; apellido?: unknown };
  return tieneContenido(datos.nombre) && tieneContenido(datos.apellido) ? "COMPLETO" : "INCOMPLETO";
}

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
  // Etapa 10. Se consulta solo para operaciones comerciales y despues de validar la
  // sesion y el rol, para no gastar una consulta en cada lectura.
  evaluarPerfil: (userId: string) => Promise<EvaluacionPerfil>;
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
      if (exigePerfilCompleto(permiso) && (await deps.evaluarPerfil(user.id)) !== "COMPLETO") {
        // Fallar cerrado: solo un perfil evaluable como COMPLETO autoriza escrituras.
        // Cubre INCOMPLETO y tambien NO_EVALUABLE (estructura o cliente Prisma en
        // desacuerdo), que despues de la fase 2 no deberia ocurrir.
        throw new AutorizacionError("PERFIL_INCOMPLETO");
      }
      return { user, membership, organizacion: membership.organizacion };
    },
  };
}
