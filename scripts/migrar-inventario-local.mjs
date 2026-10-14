// Ejecutar solo con autorización de la nueva migración local; nunca utiliza .env.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { localTarget, localClient, runLocal } from "./supabase-local.mjs";
if (!process.argv.includes("--aplicar")) throw Error("Requiere --aplicar y autorización explícita para Supabase local.");
const target = localTarget();
console.log("Destino local verificado:", JSON.stringify(target.safe));
const db = await localClient(target);
try {
  const inicial = "20261012000000_inicial_multiempresa";
  const nueva = "20261013000000_inventario_idempotente";
  const applied = (await db.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations')).rows;
  if (applied.some(r => !r.finished_at && !r.rolled_back_at)) throw Error("Hay migraciones fallidas; no continuar.");
  const checksum = createHash("sha256").update(readFileSync(`prisma/migrations/${inicial}/migration.sql`)).digest("hex");
  if (!applied.some(r => r.migration_name === inicial && r.finished_at && r.checksum === checksum)) throw Error("La migración inicial no coincide con el historial local.");
  const pending = readdirSync("prisma/migrations", { withFileTypes: true }).filter(d => d.isDirectory() && !applied.some(r => r.migration_name === d.name && r.finished_at)).map(d => d.name);
  if (pending.some(name => name !== nueva)) throw Error("Hay otras migraciones pendientes; no continuar.");
  if (pending.length && (await db.query('SELECT count(*)::int AS n FROM public."MovimientoStock"')).rows[0].n !== 0) throw Error("Hay movimientos históricos; revisar transición antes de aplicar.");
} finally { await db.end(); }
runLocal("npx prisma migrate deploy --config prisma.local.config.ts", target);
