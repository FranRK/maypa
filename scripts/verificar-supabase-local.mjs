import { localTarget, localClient, inspectEmpty } from "./supabase-local.mjs";

const target = localTarget();
console.log("Destino verificado:", JSON.stringify(target.safe));
const client = await localClient(target);
try {
  console.log("Servidor:", (await client.query("SELECT version() AS version")).rows[0].version);
  await inspectEmpty(client);
  console.log("PASS: destino exclusivamente local y sin datos propios");
} finally {
  await client.end();
}
