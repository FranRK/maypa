// Presentación de importes monetarios en pesos argentinos. No interviene en ningún
// cálculo: los valores Decimal se siguen guardando, comparando y enviando al servidor
// crudos; acá solo se decide cómo se ven. Igual que `lib/fechas.ts`, este módulo no
// importa otros módulos del proyecto, para poder ejercitarse con `node --test` sin el
// resolvedor de TypeScript.
const formatoImporte = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatearImporte(valor: string | number): string {
  const numero = typeof valor === "number" ? valor : valor.trim() === "" ? Number.NaN : Number(valor);
  if (!Number.isFinite(numero)) throw new Error(`Importe invalido: ${String(valor)}`);
  return formatoImporte.format(numero);
}
