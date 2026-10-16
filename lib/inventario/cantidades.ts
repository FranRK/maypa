export function milesimas(valor: string): bigint {
  const negativo = valor.startsWith("-");
  const [entero, fraccion = ""] = valor.replace(/^-/, "").split(".");
  const cantidad = BigInt(entero) * BigInt(1000) + BigInt(fraccion.padEnd(3, "0"));
  return negativo ? -cantidad : cantidad;
}
export function decimalStock(valor: bigint): string {
  const absoluto = valor < 0 ? -valor : valor;
  return `${valor < 0 ? "-" : ""}${absoluto / BigInt(1000)}.${String(absoluto % BigInt(1000)).padStart(3, "0")}`;
}
