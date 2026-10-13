import { spawnSync } from "node:child_process";
import pg from "pg";

export function localTarget() {
  // Comando constante, sin interpolar entradas ni imprimir secretos de status.
  const status = spawnSync("npx supabase status -o json", {
    shell: true,
    encoding: "utf8",
    windowsHide: true,
  });
  if (status.status !== 0) throw new Error("Supabase status local fallo; secretos omitidos");
  let data;
  try {
    data = JSON.parse(status.stdout.slice(status.stdout.indexOf("{")));
  } catch {
    throw new Error("Supabase status no devolvio JSON valido");
  }
  const url = new URL(data.DB_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "54322" || url.pathname !== "/postgres" ||
    [...url.searchParams.keys()].some((key) => key !== "schema")
  ) throw new Error("Destino rechazado; solo loopback:54322/postgres");
  const docker = spawnSync("docker inspect supabase_db_stock-manager", {
    shell: true, encoding: "utf8", windowsHide: true,
  });
  if (docker.status !== 0) throw new Error("No se pudo verificar el contenedor PostgreSQL local");
  const container = JSON.parse(docker.stdout)[0];
  if (!container.State.Running ||
    !container.NetworkSettings.Ports["5432/tcp"]?.some((port) => port.HostPort === "54322")
  ) throw new Error("El contenedor local no publica el puerto esperado");
  const api = new URL(data.API_URL);
  if (api.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(api.hostname) || api.port !== "54321") {
    throw new Error("La API Auth debe ser exclusivamente local");
  }
  return { url: data.DB_URL, api: data.API_URL,
    publicKey: data.PUBLISHABLE_KEY || data.ANON_KEY,
    adminKey: data.SECRET_KEY || data.SERVICE_ROLE_KEY,
    safe: {
    host: url.hostname, port: url.port, database: "postgres", user: url.username,
    container: "supabase_db_stock-manager",
  }};
}

export async function localClient(target) {
  const client = new pg.Client({ connectionString: target.url, connectionTimeoutMillis: 5000 });
  await client.connect();
  const { rows: [identity] } = await client.query(
    "SELECT current_database() AS database, current_user AS role, inet_server_port() AS server_port, version() AS version"
  );
  if (identity.database !== "postgres" || identity.server_port !== 5432) {
    await client.end();
    throw new Error("Identidad del servidor local inesperada");
  }
  return client;
}

export function runLocal(command, target) {
  const result = spawnSync(command, {
    shell: true, encoding: "utf8", windowsHide: true,
    env: { ...process.env, LOCAL_DATABASE_URL: target.url },
  });
  // Ocultar cualquier URI incluso si una herramienta la incluye en un error.
  const redact = (value) => (value || "").replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[conexion oculta]");
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
  console.log(`exit=${result.status}`);
  if (result.status !== 0) throw new Error("Comando local fallo");
}

export async function inspectEmpty(client) {
  const result = await client.query(`
    SELECT n.nspname AS schema, c.relname AS table
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname NOT IN ('information_schema','auth','storage','extensions',
        'realtime','_realtime','supabase_functions','supabase_migrations','graphql',
        'graphql_public','vault','net','pgbouncer','cron')
    ORDER BY 1,2
  `);
  console.log("Tablas propias previas:", JSON.stringify(result.rows));
  if (result.rowCount !== 0) throw new Error("Hay tablas propias previas; detener escrituras");
  for (const table of ["auth.users", "storage.buckets", "storage.objects", "vault.secrets", "cron.job"]) {
    const { rows: [exists] } = await client.query("SELECT to_regclass($1) AS relation", [table]);
    if (!exists.relation && table === "auth.users") throw new Error("Falta auth.users");
    if (exists.relation) {
      const { rows: [count] } = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
      console.log(`${table}: ${count.count} filas`);
      if (count.count !== 0) throw new Error("Se encontraron datos o configuraciones locales; detener escrituras");
    }
  }
  const { rows } = await client.query("SELECT datname FROM pg_database ORDER BY datname");
  console.log("Bases locales:", JSON.stringify(rows));
}
