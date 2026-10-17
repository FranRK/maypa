import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { crearAutorizacion } from "../lib/auth/policy.ts";
import { evaluarPerfilConPrisma } from "../lib/auth/perfil.ts";
import { crearServicioInventario, movimientoSchema, milesimas } from "../lib/inventario/service.ts";
import { localTarget, localClient } from "./supabase-local.mjs";
import { dockerLocalTarget } from "./docker-local-target.mjs";
import { seedLocalOrganization } from "./seed-local.mjs";

const target = process.argv.includes("--docker") ? dockerLocalTarget() : localTarget();
const identity = await localClient(target);
await identity.end();
console.log("Pruebas exclusivamente locales:", JSON.stringify(target.safe));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, max: 15 }) });
const admin = createClient(target.api, target.adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [], orgs = [];
// Etapa 10: usuarios ficticios con nombre y apellido explicitos. No se derivan del
// correo ni son placeholders de personas reales.
const PERSONA = { nombre: "Prueba", apellido: "Inventario" };
const http = process.argv.includes("--http");
let passed = 0;
function pass(text) { console.log("OK:", text); passed++; }
async function fixture() {
  const email = `inventario-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null); users.push(data.user.id);
  const seed = await seedLocalOrganization(target, email, `inventario-${randomUUID()}`, undefined, PERSONA); orgs.push(seed.organizationId);
  const cookies = new Map();
  const client = createServerClient(target.api, target.publicKey, { cookies: {
    getAll: () => [...cookies].map(([name,value]) => ({ name,value })),
    setAll: entries => entries.forEach(({ name,value }) => cookies.set(name,value)),
  } });
  assert.equal((await client.auth.signInWithPassword({ email,password })).error, null);
  const authorization = crearAutorizacion({
    async getUser() { const { data,error } = await client.auth.getUser(); return error ? null : data.user; },
    findMemberships: usuarioId => db.miembroOrganizacion.findMany({ where: { usuarioId }, include: { organizacion: true } }),
    evaluarPerfil: usuarioId => evaluarPerfilConPrisma(db, usuarioId),
  });
  return { org: seed.organizationId, user: data.user.id, cookies, service: crearServicioInventario(db, authorization.exigirOrganizacion) };
}
async function producto(a, sku = randomUUID()) { return db.producto.create({ data: { organizacionId: a.org, sku, nombre: "Producto ficticio", unidad: "unidad", precioVenta: "1", stockMinimo: "20" } }); }
function input(p, tipo, cantidad, extra = {}) { return { productoId: p.id, tipo, cantidad, nota: tipo === "AJUSTE" ? "Conteo físico" : "", claveIdempotencia: randomUUID(), ...extra }; }
async function saldo(a,p) { return (await db.saldoStock.findUnique({ where: { organizacionId_productoId: { organizacionId: a.org, productoId: p.id } } }))?.cantidad.toString() ?? "0"; }
async function integridad(a,p) {
  const sum = await db.movimientoStock.aggregate({ where: { organizacionId: a.org, productoId: p.id }, _sum: { variacion: true } });
  assert.equal(milesimas(await saldo(a,p)), milesimas(sum._sum.variacion?.toString() ?? "0"));
}
const cookie = session => [...session.cookies].map(([k,v]) => `${k}=${v}`).join("; ");
async function page(path, session) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, { redirect: "manual", signal: AbortSignal.timeout(120000), headers: session ? { Cookie: cookie(session) } : {} });
  assert.ok(response.status < 500); return { response, body: await response.text() };
}
function decodeHtml(v) { return v.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#x27;", "'"); }
async function action(html,a,fields) {
  const formHtml = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(m => m[0]).find(f => f.includes('name="cantidad"'));
  assert.ok(formHtml);
  let id;
  for (const tag of formHtml.matchAll(/<input\b[^>]*>/g)) {
    if (tag[0].match(/\bname="([^"]*)"/)?.[1].match(/^\$ACTION_\d+:0$/)) id = JSON.parse(decodeHtml(tag[0].match(/\bvalue="([^"]*)"/)?.[1] ?? "{}")).id;
  }
  assert.ok(id);
  const form = new FormData();
  for (const [k,v] of Object.entries(fields)) form.set(`_1_${k}`,v);
  form.set("0",JSON.stringify([a.org,{},"$K1"]));
  const response = await fetch(`http://127.0.0.1:3000/inventario?organizacion=${a.org}`, { method: "POST", body: form, signal: AbortSignal.timeout(120000),
    headers: { "Next-Action": id, Accept: "text/x-component", Origin: "http://127.0.0.1:3000", Cookie: cookie(a) } });
  assert.ok(response.status < 500); return response.text();
}
try {
  const a = await fixture(), b = await fixture(), p = await producto(a), foreign = await producto(b);
  let data = input(p,"INICIAL","10.125");
  const first = await a.service.registrar(a.org,data); assert.equal(first.repetido,false); assert.equal(await saldo(a,p),"10.125"); pass("Stock inicial y saldo atómico");
  const repeat = await a.service.registrar(a.org,data); assert.equal(repeat.id,first.id); assert.equal(repeat.repetido,true); pass("Reintento inicial retorna el mismo movimiento");
  await assert.rejects(a.service.registrar(a.org,input(p,"INICIAL","1"))); assert.equal(await saldo(a,p),"10.125"); pass("Segundo stock inicial rechazado");
  await a.service.registrar(a.org,input(p,"COMPRA","2.500")); assert.equal(await saldo(a,p),"12.625"); pass("Ingreso de mercadería");
  await a.service.registrar(a.org,input(p,"AJUSTE","1.125")); await a.service.registrar(a.org,input(p,"AJUSTE","-0.750")); assert.equal(await saldo(a,p),"13"); pass("Ajustes positivo y negativo con precisión exacta");
  let count = await db.movimientoStock.count({ where: { productoId: p.id } });
  await assert.rejects(a.service.registrar(a.org,input(p,"AJUSTE","-14"))); assert.equal(await saldo(a,p),"13"); assert.equal(await db.movimientoStock.count({ where: { productoId: p.id } }),count); pass("Stock negativo revierte saldo y movimiento");
  for (const cantidad of ["0","-0.000","0.0000","1.0001","NaN","Infinity","1e3","100000000000",""]) assert.equal(movimientoSchema.safeParse(input(p,"AJUSTE",cantidad)).success,false);
  assert.equal(movimientoSchema.safeParse(input(p,"COMPRA","-1")).success,false);
  assert.equal(movimientoSchema.safeParse(input(p,"AJUSTE","1",{nota:" "})).success,false);
  await assert.rejects(a.service.registrar(a.org,input(p,"AJUSTE","0"))); pass("Cero, negativos de ingreso, precisión y motivo inválidos rechazados");
  data = input(p,"COMPRA","2,000");
  const [r1,r2] = await Promise.all([a.service.registrar(a.org,data),a.service.registrar(a.org,{...data,cantidad:"02.000"})]);
  assert.equal(r1.id,r2.id); assert.equal(Number(r1.repetido)+Number(r2.repetido),1); assert.equal(await saldo(a,p),"15"); pass("Reintentos simultáneos con decimal canónico no duplican");
  await assert.rejects(a.service.registrar(a.org,{...data,cantidad:"3"})); pass("Reutilizar clave con otra solicitud se rechaza");
  await Promise.all(Array.from({length:8},()=>a.service.registrar(a.org,input(p,"COMPRA","0.125")))); assert.equal(await saldo(a,p),"16"); pass("Ocho ingresos simultáneos sin pérdidas de actualización");
  const attempts = await Promise.allSettled([a.service.registrar(a.org,input(p,"AJUSTE","-10")),a.service.registrar(a.org,input(p,"AJUSTE","-10"))]);
  assert.equal(attempts.filter(v=>v.status==="fulfilled").length,1); assert.equal(await saldo(a,p),"6"); pass("Egresos simultáneos impiden saldo negativo");
  await integridad(a,p); pass("Saldo coincide con la suma del historial");
  const fresh = await producto(a);
  const initialResults = await Promise.allSettled([a.service.registrar(a.org,input(fresh,"INICIAL","1")),a.service.registrar(a.org,input(fresh,"INICIAL","1"))]);
  assert.equal(initialResults.filter(v=>v.status==="fulfilled").length,1); await integridad(a,fresh); pass("Stock inicial simultáneo se registra una sola vez");
  const empty = await producto(a);
  await assert.rejects(a.service.registrar(a.org,input(empty,"AJUSTE","-1")));
  assert.equal(await db.saldoStock.count({ where:{productoId:empty.id} }),0); pass("Fallo del primer movimiento revierte también la creación del saldo");
  const noInitial = await producto(a); await a.service.registrar(a.org,input(noInitial,"COMPRA","1"));
  await assert.rejects(a.service.registrar(a.org,input(noInitial,"INICIAL","1"))); pass("Inicial posterior a cualquier movimiento rechazado");
  const maximum = await producto(a); await a.service.registrar(a.org,input(maximum,"INICIAL","99999999999.999"));
  await assert.rejects(a.service.registrar(a.org,input(maximum,"COMPRA","0.001"))); await integridad(a,maximum); pass("Desbordamiento de saldo rechazado sin redondeo");
  await assert.rejects(a.service.registrar(a.org,input(foreign,"COMPRA","1"))); await assert.rejects(a.service.registrar(b.org,input(foreign,"COMPRA","1")));
  await assert.rejects(a.service.listar(b.org,{})); await assert.rejects(a.service.listar(a.org,{producto:foreign.id})); pass("Acceso y escrituras entre organizaciones rechazados");
  const listado = await a.service.listar(a.org,{stock:"bajo",producto:p.id,tipo:"AJUSTE"});
  assert.ok(listado.productos.some(x=>x.id===p.id && x.bajo)); assert.ok(listado.historial.every(x=>x.tipo==="AJUSTE" && x.usuarioId===a.user));
  assert.ok(listado.historial.every(x=>x.autor.perfil.nombre===PERSONA.nombre && x.autor.perfil.apellido===PERSONA.apellido), "El historial trae el nombre del autor desde la membresía autorizada");
  assert.ok((await a.service.listar(a.org,{buscar:p.sku})).total===1); pass("Filtros de stock bajo, búsqueda e historial por producto/tipo y autor");
  if(http) {
    const anon=await page("/inventario"); assert.ok([303,307,308].includes(anon.response.status));
    const own=await page(`/inventario?organizacion=${a.org}`,a);
    assert.ok(own.body.includes("Registrar movimiento") && own.body.includes(p.sku) && own.body.includes("Historial de movimientos"));
    assert.ok(own.body.includes(`${PERSONA.nombre} ${PERSONA.apellido} (vos)`), "El historial muestra nombre y apellido del autor");
    assert.ok(!own.body.includes(a.user), "El historial no expone el UUID del autor");
    assert.ok(!own.body.includes(target.adminKey) && !own.body.includes(target.url));
    const denied=await page(`/inventario?organizacion=${b.org}`,a); assert.ok(!denied.body.includes(foreign.sku)); pass("HTTP: existencias, historial, rechazo anónimo y empresa ajena");
    const command=input(p,"COMPRA","1");
    assert.ok((await action(own.body,a,command)).includes("Movimiento registrado y saldo actualizado."));
    assert.ok((await action(own.body,a,command)).includes("No se duplicó."));
    assert.equal(await saldo(a,p),"7"); pass("HTTP: Server Action registra y el reintento no duplica");
  }
  const memberKey={organizacionId_usuarioId:{organizacionId:a.org,usuarioId:a.user}};
  await db.miembroOrganizacion.update({where:memberKey,data:{rol:"EMPLEADO"}});
  assert.ok((await a.service.listar(a.org,{})).total>0); await assert.rejects(a.service.registrar(a.org,input(p,"COMPRA","1")),e=>e.code==="ROL_INSUFICIENTE"); pass("Empleado consulta existencias e historial sin modificar");
  if(http) { const employee=await page(`/inventario?organizacion=${a.org}`,a); assert.ok(employee.body.includes(p.sku) && !employee.body.includes("Registrar movimiento")); pass("HTTP: empleado sin formulario de escritura"); }
  await db.miembroOrganizacion.update({where:memberKey,data:{rol:"ADMINISTRADOR"}}); await a.service.registrar(a.org,input(p,"COMPRA","1")); pass("Administrador autorizado");
  await db.producto.update({where:{id:p.id},data:{activo:false}}); await assert.rejects(a.service.registrar(a.org,input(p,"COMPRA","1"))); await integridad(a,p); pass("Producto inactivo conserva historial y rechaza movimientos nuevos");
  await db.miembroOrganizacion.update({where:memberKey,data:{activa:false,bajaEn:new Date()}}); await assert.rejects(a.service.listar(a.org,{})); await assert.rejects(a.service.registrar(a.org,input(p,"COMPRA","1"))); pass("Membresía inactiva rechazada");
  const anonymous=crearServicioInventario(db,crearAutorizacion({getUser:async()=>null,findMemberships:async()=>{throw Error("No consultar sin sesión");},evaluarPerfil:async()=>"COMPLETO"}).exigirOrganizacion);
  await assert.rejects(anonymous.registrar(a.org,input(p,"COMPRA","1")),e=>e.code==="NO_AUTENTICADO"); pass("Sin sesión no se registra ningún movimiento");
  // Las restricciones reales siguen protegiendo a escritores que eluden el servicio.
  await assert.rejects(db.movimientoStock.create({data:{organizacionId:b.org,productoId:foreign.id,usuarioId:b.user,tipo:"COMPRA",variacion:"1"}}));
  await assert.rejects(db.movimientoStock.create({data:{organizacionId:b.org,productoId:foreign.id,usuarioId:b.user,tipo:"AJUSTE",variacion:"1",claveIdempotencia:randomUUID(),huellaSolicitud:"a".repeat(64)}})); pass("CHECK reales exigen idempotencia y motivo");
  console.log(`RESULTADO: ${passed} comprobaciones de inventario aprobadas`);
} finally {
  // Borrar exclusivamente fixtures de esta ejecución, nunca historial real.
  await db.$transaction(async tx => {
    await tx.movimientoStock.deleteMany({where:{organizacionId:{in:orgs}}});
    await tx.saldoStock.deleteMany({where:{organizacionId:{in:orgs}}});
    await tx.producto.deleteMany({where:{organizacionId:{in:orgs}}});
    await tx.miembroOrganizacion.deleteMany({where:{usuarioId:{in:users}}});
    await tx.perfil.deleteMany({where:{id:{in:users}}});
    await tx.organizacion.deleteMany({where:{id:{in:orgs}}});
  });
  for(const id of users){ const {error}=await admin.auth.admin.deleteUser(id); if(error)throw error; }
  await db.$disconnect();
}
