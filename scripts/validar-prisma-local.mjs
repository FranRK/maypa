import { localTarget, runLocal } from "./supabase-local.mjs";

const target = localTarget();
console.log("Prisma local:", JSON.stringify(target.safe));
for (const command of [
  "npx prisma validate --config prisma.local.config.ts",
  "npx prisma format --check --config prisma.local.config.ts",
  "npx prisma generate --config prisma.local.config.ts",
  "npx prisma migrate status --config prisma.local.config.ts",
]) {
  console.log(command);
  runLocal(command, target);
}
