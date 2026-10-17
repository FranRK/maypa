// Etiquetas en espanol para los valores tecnicos que ya persisten en la base.
// No traducen datos: solo presentacion. Los `Record` completos obligan a que un
// valor nuevo del enum falle en TypeScript hasta definirse su etiqueta.
import type { EstadoVenta, RolMiembro, TipoMovimiento } from "../src/generated/prisma/enums";

export const ETIQUETAS_ESTADO_VENTA: Record<EstadoVenta, string> = {
  BORRADOR: "Borrador",
  CONFIRMADA: "Confirmada",
  CANCELADA: "Cancelada",
  DEVOLUCION_PARCIAL: "Devolución parcial",
  DEVUELTA: "Devuelta",
};

export const ETIQUETAS_ROL: Record<RolMiembro, string> = {
  PROPIETARIO: "Propietario",
  ADMINISTRADOR: "Administrador",
  EMPLEADO: "Empleado",
};

export const ETIQUETAS_TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  INICIAL: "Stock inicial",
  COMPRA: "Ingreso de mercadería",
  VENTA: "Venta",
  AJUSTE: "Ajuste",
  ANULACION_VENTA: "Anulación de venta",
  DEVOLUCION: "Devolución",
};

// Datos de nombre del perfil de un integrante. La relacion ya viene acotada a la
// organizacion autorizada por el servicio que la consulta.
export type NombrePerfil = { nombre?: string | null; apellido?: string | null } | null;

// Texto legible del autor de una operacion. Nunca expone el UUID tecnico: si no hay
// nombre de perfil ni correo de la sesion propia, cae en un texto neutro. El
// identificador sigue disponible en el dato para enlaces internos, nunca en la pantalla.
export function etiquetaAutor(
  usuarioId: string,
  opciones: { perfil?: NombrePerfil; sesion?: { id: string; email?: string | null } } = {},
): { texto: string } {
  const propia = opciones.sesion?.id === usuarioId;
  const nombre = [opciones.perfil?.nombre?.trim(), opciones.perfil?.apellido?.trim()].filter(Boolean).join(" ");
  if (nombre) return { texto: propia ? `${nombre} (vos)` : nombre };
  const correo = opciones.sesion?.email?.trim();
  if (propia && correo) return { texto: `${correo} (vos)` };
  return { texto: "Sin nombre cargado" };
}
