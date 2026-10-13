import { localTarget, localClient, inspectEmpty, runLocal } from "./supabase-local.mjs";

const target = localTarget();
console.log("Destino de migracion:", JSON.stringify(target.safe));
const client = await localClient(target);
try {
  await inspectEmpty(client);
} finally {
  await client.end();
}
runLocal("npx prisma migrate deploy --config prisma.local.config.ts", target);
