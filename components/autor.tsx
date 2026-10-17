import { etiquetaAutor, type NombrePerfil } from "@/lib/etiquetas";

// Muestra el autor de una operación con el nombre y apellido de su perfil. Nunca
// expone el UUID: si el integrante no cargó su nombre, muestra un texto neutro. El
// `perfil` ya viene limitado a la organización autorizada por el servicio que consulta.
export function Autor({ usuarioId, perfil, sesion }: {
  usuarioId: string;
  perfil?: NombrePerfil;
  sesion: { id: string; email?: string | null };
}) {
  return <span>{etiquetaAutor(usuarioId, { perfil, sesion }).texto}</span>;
}
