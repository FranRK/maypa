import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { localTarget, localClient } from "./supabase-local.mjs";
import { seedLocalOrganization } from "./seed-local.mjs";
import { crearAutorizacion, AutorizacionError } from "../lib/auth/policy.ts";

const target = localTarget();
const base = "http://127.0.0.1:3000";
console.log("Pruebas Auth/Next exclusivamente locales:", JSON.stringify(target.safe));
const admin = createClient(target.api,target.adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
const db = await localClient(target);
const users = [], organizations = [];
let passed = 0;
function pass(name) { console.log(`PASS ${++passed}: ${name}`); }

async function createUser() {
  const email = `etapa5-${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(32).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({email,password,email_confirm:true});
  if (error) throw new Error("No se pudo crear la cuenta ficticia en Auth local");
  users.push(data.user.id);
  return { id:data.user.id,email,password };
}

async function signIn(user) {
  const jar = new Map();
  const client = createServerClient(target.api,target.publicKey,{
    cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>{
      for(const cookie of values) { if(cookie.value) jar.set(cookie.name,cookie.value); else jar.delete(cookie.name); }
    }},
  });
  const { error } = await client.auth.signInWithPassword({email:user.email,password:user.password});
  if(error) throw new Error("Login Auth local fallo");
  return { client, jar };
}

async function page(path, session) {
  const cookie = session ? [...session.jar].map(([k,v])=>`${k}=${v}`).join("; ") : "";
  const response = await fetch(base+path,{headers:{Cookie:cookie},redirect:"manual"});
  const html = await response.text();
  assert.ok(!html.includes(target.url),"La URI PostgreSQL no debe llegar al HTML");
  assert.ok(!html.includes(target.adminKey),"La clave admin no debe llegar al HTML");
  assert.notEqual(response.status,500,"Next devolvio error interno");
  return {response,html};
}

try {
  const anonymous = await page("/dashboard");
  assert.ok([303,307,308].includes(anonymous.response.status));
  assert.equal(new URL(anonymous.response.headers.get("location"),base).pathname,"/auth/login");
  pass("Sin sesion, /dashboard redirige al login");
  const login = await page("/auth/login");
  assert.equal(login.response.status,200);
  assert.match(login.html,/type="password"/);
  pass("Formulario existente de email y contrasena disponible");

  const userA = await createUser(), userB = await createUser(), noOrg = await createUser();
  const slugA = `prueba-auth-a-${randomBytes(8).toString("hex")}`;
  const slugB = `prueba-auth-b-${randomBytes(8).toString("hex")}`;
  const seedA = await seedLocalOrganization(target,userA.email,slugA,"Empresa ficticia A");
  organizations.push(seedA.organizationId);
  const seedB = await seedLocalOrganization(target,userB.email,slugB,"Empresa ficticia B");
  organizations.push(seedB.organizationId);
  const again = await seedLocalOrganization(target,userA.email,slugA,"Empresa ficticia A");
  assert.equal(again.organizationId,seedA.organizationId);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public."MiembroOrganizacion" WHERE "organizacionId"=$1 AND "usuarioId"=$2',[seedA.organizationId,userA.id])).rows[0].count,1);
  pass("Seed repetible: misma organizacion, perfil y membresia sin duplicados");

  const sessionA = await signIn(userA), sessionB = await signIn(userB), sessionNone = await signIn(noOrg);
  const withoutOrg = await page("/dashboard",sessionNone);
  assert.match(withoutOrg.html,/Acceso restringido/);
  assert.ok(!withoutOrg.html.includes("Empresa ficticia A"));
  pass("Usuario autenticado sin organizacion queda restringido");
  const owner = await page("/dashboard",sessionA);
  assert.match(owner.html,/Empresa ficticia A/);
  assert.match(owner.html,/PROPIETARIO/);
  assert.ok(owner.html.includes(userA.email));
  assert.ok(!owner.html.includes("Empresa ficticia B"));
  pass("Login real + cookies SSR + Prisma: miembro activo ve su organizacion y rol");

  const foreign = await page(`/dashboard?organizacion=${seedB.organizationId}`,sessionA);
  assert.ok(foreign.response.status===404 || foreign.html.includes("NEXT_HTTP_ERROR_FALLBACK;404") || foreign.html.includes("This page could not be found"));
  assert.ok(!foreign.html.includes("Empresa ficticia B"));
  pass("Usuario A no puede ver la organizacion B");
  const ownB = await page(`/dashboard?organizacion=${seedB.organizationId}`,sessionB);
  assert.match(ownB.html,/Empresa ficticia B/);
  pass("Usuario B accede solo a su contexto autorizado");

  await db.query('UPDATE public."MiembroOrganizacion" SET activa=false,"bajaEn"=now() WHERE "organizacionId"=$1 AND "usuarioId"=$2',[seedA.organizationId,userA.id]);
  const inactive = await page("/dashboard",sessionA);
  assert.match(inactive.html,/Acceso restringido/);
  assert.ok(!inactive.html.includes("Empresa ficticia A"));
  const inactiveExplicit = await page(`/dashboard?organizacion=${seedA.organizationId}`,sessionA);
  assert.ok(!inactiveExplicit.html.includes("Empresa ficticia A"));
  pass("Baja de miembro se aplica en la siguiente peticion, aun con sesion valida");
  await db.query('UPDATE public."MiembroOrganizacion" SET activa=true,"bajaEn"=NULL,rol=\'EMPLEADO\' WHERE "organizacionId"=$1 AND "usuarioId"=$2',[seedA.organizationId,userA.id]);
  const employee = await page("/dashboard",sessionA);
  assert.match(employee.html,/EMPLEADO/);
  const authorization = crearAutorizacion({
    getUser:async()=>{const {data,error}=await sessionA.client.auth.getUser();return error?null:data.user;},
    findMemberships:async id=>(await db.query(`SELECT m."organizacionId",m."usuarioId",m.activa,m.rol,
      json_build_object('id',o.id,'nombre',o.nombre,'slug',o.slug) AS organizacion
      FROM public."MiembroOrganizacion" m JOIN public."Organizacion" o ON o.id=m."organizacionId"
      WHERE m."usuarioId"=$1 AND m.activa`,[id])).rows,
  });
  await assert.rejects(authorization.exigirOrganizacion(seedA.organizationId,"ADMINISTRAR_ORGANIZACION"),e=>e instanceof AutorizacionError&&e.code==="ROL_INSUFICIENTE");
  pass("Empleado ve dashboard pero no obtiene permiso exclusivo de PROPIETARIO");
  const privileges = (await db.query("SELECT current_user AS role, r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE rolname=current_user")).rows[0];
  console.log("Privilegios PostgreSQL locales:", JSON.stringify(privileges));
  pass("Privilegios reales del rol Prisma inspeccionados");
  const { error } = await sessionA.client.auth.signOut({scope:"local"});
  assert.equal(error,null);
  const loggedOut = await page("/dashboard",sessionA);
  assert.ok([303,307,308].includes(loggedOut.response.status));
  pass("Logout limpia cookies y rechaza el siguiente acceso privado");
  console.log(`RESULTADO: ${passed} comprobaciones de integracion aprobadas`);
} finally {
  // Limpiar solo fixtures identificadas de esta ejecucion, sin resetear la base.
  if(users.length) {
    await db.query("BEGIN");
    try {
      await db.query('DELETE FROM public."MiembroOrganizacion" WHERE "usuarioId"=ANY($1::uuid[])',[users]);
      await db.query('DELETE FROM public."Perfil" WHERE id=ANY($1::uuid[])',[users]);
      if(organizations.length) await db.query('DELETE FROM public."Organizacion" WHERE id=ANY($1::uuid[])',[organizations]);
      await db.query("COMMIT");
    } catch(error) { await db.query("ROLLBACK");throw error; }
    for(const id of users) {
      const {error}=await admin.auth.admin.deleteUser(id);
      if(error) throw new Error("No se pudo limpiar un usuario ficticio local");
    }
    console.log("Fixtures Auth/organizaciones de la prueba eliminadas; datos previos conservados");
  }
  await db.end();
}
