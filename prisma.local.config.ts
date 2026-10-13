import { defineConfig, env } from "prisma/config";

// Sin dotenv ni fallback a DIRECT_URL/DATABASE_URL de Supabase Cloud.
const localUrl = env("LOCAL_DATABASE_URL");
const target = new URL(localUrl);
if (
  target.protocol !== "postgresql:" && target.protocol !== "postgres:"
) {
  throw new Error("LOCAL_DATABASE_URL debe ser PostgreSQL local");
}
if (
  !["127.0.0.1", "localhost"].includes(target.hostname) ||
  target.port !== "54322" ||
  target.pathname !== "/postgres" ||
  [...target.searchParams.keys()].some((key) => key !== "schema")
) {
  throw new Error("Destino rechazado: se requiere loopback:54322/postgres");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: localUrl },
});
