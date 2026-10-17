// Zona horaria y presentación de fechas. La base guarda `timestamp(3)` sin zona con
// valores UTC y Prisma los interpreta como UTC, por lo que la zona se fija explícitamente
// al calcular el día y al formatear. Este módulo no importa otros módulos del proyecto:
// así puede ejercitarse con `node --test` sin el resolvedor de TypeScript.
export const ZONA_HORARIA = "America/Argentina/Buenos_Aires";

const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  dateStyle: "short",
  timeStyle: "short",
});

// Se componen las partes a mano en lugar de confiar en el separador del locale.
function diaLocal(ahora: Date) {
  const partes = formatoDia.formatToParts(ahora);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find(parte => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

// Corte del día en horario de Buenos Aires. Argentina no aplica horario de verano
// desde 2009: el desfase es -03:00 fijo, por lo que el fin del día se obtiene
// sumando 24 horas exactas al inicio.
export function rangoDelDiaAr(ahora: Date): { inicio: Date; fin: Date } {
  if (Number.isNaN(ahora.getTime())) throw new Error("Fecha invalida para calcular el dia.");
  const inicio = new Date(`${diaLocal(ahora)}T00:00:00.000-03:00`);
  return { inicio, fin: new Date(inicio.getTime() + 24 * 60 * 60 * 1000) };
}

export function formatearFechaHora(fecha: Date): string {
  return formatoFechaHora.format(fecha);
}
