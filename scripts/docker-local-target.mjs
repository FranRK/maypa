// Alternativa explícita para pruebas cuando Supabase CLI status está bloqueado.
// Inspeccionar Docker no imprime variables de entorno ni claves.
import { spawnSync } from "node:child_process";
export function dockerLocalTarget() {
  const result = spawnSync("docker", ["inspect", "supabase_db_stock-manager", "supabase_kong_stock-manager", "supabase_studio_stock-manager"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status !== 0) throw Error("No se pudieron verificar los contenedores locales; no continuar.");
  const [db,kong,studio] = JSON.parse(result.stdout);
  if (db.Name !== "/supabase_db_stock-manager" || kong.Name !== "/supabase_kong_stock-manager" || studio.Name !== "/supabase_studio_stock-manager" || !db.State.Running || !kong.State.Running || !studio.State.Running ||
      !db.NetworkSettings.Ports["5432/tcp"]?.some(p=>p.HostPort==="54322") || !kong.NetworkSettings.Ports["8000/tcp"]?.some(p=>p.HostPort==="54321")) throw Error("Docker no coincide con el proyecto local esperado.");
  const env = container => Object.fromEntries(container.Config.Env.map(v=>{const i=v.indexOf("=");return [v.slice(0,i),v.slice(i+1)];}));
  const dbEnv=env(db), apiEnv=env(studio);
  const publicKey=apiEnv.SUPABASE_PUBLISHABLE_KEY || apiEnv.SUPABASE_ANON_KEY;
  const adminKey=apiEnv.SUPABASE_SECRET_KEY || apiEnv.SUPABASE_SERVICE_KEY;
  if (dbEnv.POSTGRES_DB!=="postgres" || !dbEnv.POSTGRES_PASSWORD || !publicKey || !adminKey) throw Error("Configuración Docker local incompleta; no continuar.");
  return { url:`postgresql://postgres:${encodeURIComponent(dbEnv.POSTGRES_PASSWORD)}@127.0.0.1:54322/postgres`, api:"http://127.0.0.1:54321",
    publicKey, adminKey,
    safe:{host:"127.0.0.1",port:"54322",database:"postgres",user:"postgres",container:"supabase_db_stock-manager",verificacion:"Docker directo"} };
}
