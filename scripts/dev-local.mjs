import { spawn } from "node:child_process";
import { localTarget } from "./supabase-local.mjs";
import { dockerLocalTarget } from "./docker-local-target.mjs";

const target = process.argv.includes("--docker") ? dockerLocalTarget() : localTarget();
if (!target.publicKey) throw new Error("Supabase local no devolvio una clave publica");
console.log("Next.js local:", JSON.stringify(target.safe));
const child = spawn("npx next dev --hostname 127.0.0.1 --port 3000", {
  shell: true, windowsHide: true, stdio: "inherit",
  env: {
    ...process.env,
    LOCAL_DATABASE_URL: target.url,
    NEXT_PUBLIC_SUPABASE_URL: target.api,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: target.publicKey,
  },
});
child.on("exit", code => { process.exitCode = code ?? 1; });
