import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { localTarget, localClient } from "./supabase-local.mjs";

export async function seedLocalOrganization(target, email, slug = "organizacion-prueba", name = "Organización de prueba") {
  if (process.env.NODE_ENV === "production") throw new Error("Seed solo para desarrollo local");
  if (!email || !target.adminKey) throw new Error("Se requiere email y Auth admin local");
  const admin = createClient(target.api, target.adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let user;
  for (let page = 1; !user; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error("No se pudo consultar Auth local");
    user = data.users.find(candidate => candidate.email?.toLowerCase() === email.trim().toLowerCase());
    if (data.users.length < 100) break;
  }
  if (!user?.email_confirmed_at) throw new Error("Registra y confirma primero tu cuenta en /auth/sign-up local");
  const client = await localClient(target);
  try {
    await client.query("BEGIN");
    await client.query('INSERT INTO public."Perfil"(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [user.id]);
    const { rows: [organization] } = await client.query(`INSERT INTO public."Organizacion"(id,nombre,slug)
      VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id,nombre`, [randomUUID(),name,slug]);
    await client.query(`INSERT INTO public."MiembroOrganizacion"("organizacionId","usuarioId",rol,activa)
      VALUES ($1,$2,'PROPIETARIO',true) ON CONFLICT ("organizacionId","usuarioId")
      DO UPDATE SET rol='PROPIETARIO',activa=true,"bajaEn"=NULL`, [organization.id,user.id]);
    await client.query("COMMIT");
    return { userId: user.id, organizationId: organization.id, name: organization.nombre };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--email");
  const email = index >= 0 ? process.argv[index + 1] : undefined;
  if (!email) throw new Error("Uso: npm run seed:local -- --email <tu-email-local>");
  const target = localTarget();
  console.log("Seed exclusivamente local:", JSON.stringify(target.safe));
  const result = await seedLocalOrganization(target,email);
  console.log("Perfil y membresia PROPIETARIO preparados; organizacion:", result.name);
}
