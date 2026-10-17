import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { localTarget, localClient } from "./supabase-local.mjs";

// Mismo criterio que los CHECK de public."Perfil": al menos un caracter que no sea
// espacio en blanco ('\S' tambien excluye el espacio duro U+00A0).
const tieneContenido = valor => typeof valor === "string" && /\S/.test(valor);

// Etapa 10: la fase 1 agrega "nombre" y "apellido" a public."Perfil" y la fase 2 los
// vuelve obligatorios. Este script funciona antes y despues de la fase 1: consulta el
// catalogo (nunca interpreta un mensaje de error) y escribe los nombres solo cuando
// las columnas existen.
async function columnasDeNombre(client) {
  const { rows } = await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Perfil' AND column_name = ANY($1::text[])`,
    [["nombre", "apellido"]]);
  const encontradas = new Set(rows.map(row => row.column_name));
  return encontradas.has("nombre") && encontradas.has("apellido");
}

// `persona` son los datos reales que declara la persona. Son obligatorios para crear o
// actualizar un perfil: no se derivan del correo ni se rellenan con valores de fantasia.
export async function seedLocalOrganization(target, email, slug = "organizacion-prueba", name = "Organización de prueba", persona) {
  if (process.env.NODE_ENV === "production") throw new Error("Seed solo para desarrollo local");
  if (!email || !target.adminKey) throw new Error("Se requiere email y Auth admin local");
  const nombre = typeof persona?.nombre === "string" ? persona.nombre.trim() : undefined;
  const apellido = typeof persona?.apellido === "string" ? persona.apellido.trim() : undefined;
  if (!tieneContenido(nombre) || !tieneContenido(apellido)) {
    throw new Error('Perfil sin nombre ni apellido: pasalos como { nombre, apellido }. Los declara la persona; no se derivan del correo. Si ya se registró en /auth/sign-up, los valores que declaró están en su metadata: SELECT raw_user_meta_data FROM auth.users WHERE email = \'<email>\'.');
  }
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
    const conColumnas = await columnasDeNombre(client);
    if (!conColumnas) {
      console.log('AVISO: public."Perfil" todavia no tiene "nombre"/"apellido" (fase 1 de la etapa 10 sin aplicar); el perfil se crea sin ellos y los nombres quedan solo en la metadata de Auth.');
    }
    await client.query("BEGIN");
    if (conColumnas) {
      await client.query(`INSERT INTO public."Perfil"(id,"nombre","apellido") VALUES ($1,$2,$3)
        ON CONFLICT (id) DO UPDATE SET "nombre"=EXCLUDED."nombre","apellido"=EXCLUDED."apellido"`,
        [user.id, nombre, apellido]);
    } else {
      await client.query('INSERT INTO public."Perfil"(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [user.id]);
    }
    const { rows: [organization] } = await client.query(`INSERT INTO public."Organizacion"(id,nombre,slug)
      VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id,nombre`, [randomUUID(),name,slug]);
    await client.query(`INSERT INTO public."MiembroOrganizacion"("organizacionId","usuarioId",rol,activa)
      VALUES ($1,$2,'PROPIETARIO',true) ON CONFLICT ("organizacionId","usuarioId")
      DO UPDATE SET rol='PROPIETARIO',activa=true,"bajaEn"=NULL`, [organization.id,user.id]);
    await client.query("COMMIT");
    return { userId: user.id, organizationId: organization.id, name: organization.nombre, perfilConNombre: conColumnas };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argumento = flag => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const email = argumento("--email");
  const nombre = argumento("--nombre");
  const apellido = argumento("--apellido");
  if (!email || !nombre || !apellido) throw new Error("Uso: npm run seed:local -- --email <tu-email-local> --nombre <nombre> --apellido <apellido>");
  const target = localTarget();
  console.log("Seed exclusivamente local:", JSON.stringify(target.safe));
  const result = await seedLocalOrganization(target, email, "organizacion-prueba", "Organización de prueba", { nombre, apellido });
  console.log("Perfil y membresia PROPIETARIO preparados; organizacion:", result.name,
    result.perfilConNombre ? "(con nombre y apellido)" : "(columnas de la etapa 10 pendientes)");
}
