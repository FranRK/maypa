import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { crearAutorizacion } from "../lib/auth/policy.ts";
import { crearServicioInventario } from "../lib/inventario/service.ts";
import { milesimas } from "../lib/inventario/cantidades.ts";
import { crearServicioVentas, itemsVentaSchema } from "../lib/ventas/service.ts";
import { localTarget, localClient } from "./supabase-local.mjs";
import { dockerLocalTarget } from "./docker-local-target.mjs";
import { seedLocalOrganization } from "./seed-local.mjs";

const target = process.argv.includes("--docker") ? dockerLocalTarget() : localTarget();
const identity = await localClient(target); await identity.end();
console.log("Pruebas exclusivamente locales:", JSON.stringify(target.safe));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, max: 15 }) });
const admin = createClient(target.api, target.adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [], orgs = [];
let passed = 0;
const pass = message => { passed++; console.log("OK:", message); };
async function fixture() {
  const email = `ventas-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null); users.push(data.user.id);
  const seed = await seedLocalOrganization(target, email, `ventas-${randomUUID()}`); orgs.push(seed.organizationId);
  const cookies = new Map();
  const client = createServerClient(target.api, target.publicKey, { cookies: { getAll: () => [...cookies].map(([name,value])=>({ name,value })), setAll: entries => entries.forEach(({name,value})=>cookies.set(name,value)) } });
  assert.equal((await client.auth.signInWithPassword({ email,password })).error,null);
  const auth = crearAutorizacion({ async getUser() { const { data,error } = await client.auth.getUser(); return error ? null : data.user; },
    findMemberships: usuarioId => db.miembroOrganizacion.findMany({ where: { usuarioId }, include: { organizacion: true } }) });
  return { org: seed.organizationId, user: data.user.id, auth, cookies,
    ventas: crearServicioVentas(db,auth.exigirOrganizacion), inventario: crearServicioInventario(db,auth.exigirOrganizacion) };
}
async function producto(a, cantidad = "10", precioVenta = "2.50") {
  const p = await db.producto.create({ data: { organizacionId: a.org, sku: randomUUID(), nombre: "Producto ficticio ventas", precioVenta, stockMinimo: "0" } });
  await a.inventario.registrar(a.org,{ productoId:p.id,tipo:"INICIAL",cantidad,nota:"",claveIdempotencia:randomUUID() }); return p;
}
const item = (p,cantidad="1") => ({productoId:p.id,cantidad});
async function solicitud(a,items) { const quote=await a.ventas.cotizar(a.org,items); return {items,revisionPrecios:quote.revisionPrecios,claveIdempotencia:randomUUID()}; }
async function saldo(a,p) { return (await db.saldoStock.findUnique({where:{organizacionId_productoId:{organizacionId:a.org,productoId:p.id}}})).cantidad.toString(); }
async function integridad(a,p) { const sum=await db.movimientoStock.aggregate({where:{organizacionId:a.org,productoId:p.id},_sum:{variacion:true}}); assert.equal(milesimas(await saldo(a,p)),milesimas(sum._sum.variacion.toString())); }
async function conteos(a) { return Promise.all([db.venta.count({where:{organizacionId:a.org}}),db.detalleVenta.count({where:{organizacionId:a.org}}),db.movimientoStock.count({where:{organizacionId:a.org,tipo:"VENTA"}})]); }
const cookie = a => [...a.cookies].map(([k,v])=>`${k}=${v}`).join("; ");
async function page(path,a) { const response=await fetch(`http://127.0.0.1:3000${path}`,{redirect:"manual",headers:a?{Cookie:cookie(a)}:{},signal:AbortSignal.timeout(120000)}); return {response,body:await response.text()}; }
async function actionIds() {
  // Referencias públicas del cliente de desarrollo, nunca leer claves del manifiesto del servidor.
  const ids = {};
  for (const file of await readdir(".next/dev/static/chunks")) {
    if (!file.endsWith(".js")) continue;
    const source = await readFile(`.next/dev/static/chunks/${file}`,"utf8");
    if (!source.includes("app/ventas/actions.ts")) continue;
    for (const match of source.matchAll(/\{"([a-f0-9]{40,64})":\{"name":"([^"]+)"\}\}/g)) ids[match[2]]=match[1];
  }
  assert.ok(ids.confirmarVenta && ids.cotizarVenta && ids.buscarProductosVenta);
  return ids;
}
async function action(id,a,args,command) {
  let body;
  if (command) { body=new FormData(); body.set("_1_solicitud",JSON.stringify(command)); body.set("0",JSON.stringify([a.org,{},"$K1"])); }
  else body=JSON.stringify(args);
  const response=await fetch(`http://127.0.0.1:3000/ventas?organizacion=${a.org}`,{method:"POST",body,signal:AbortSignal.timeout(120000),
    headers:{"Next-Action":id,Accept:"text/x-component",Origin:"http://127.0.0.1:3000",Cookie:cookie(a),...(command?{}:{"Content-Type":"text/plain;charset=UTF-8"})}});
  assert.ok(response.status<500);return response.text();
}
try {
  const a=await fixture(), b=await fixture(), p=await producto(a), q=await producto(a,"10","1.00"), foreign=await producto(b);
  const command=await solicitud(a,[item(p,"2")]);
  // Precios/totales proporcionados por un atacante se ignoran.
  const first=await a.ventas.registrar(a.org,{...command,total:"0",precioUnitario:"0",creadaPor:b.user});
  const {venta}=await a.ventas.detalle(a.org,first.id);
  assert.equal(venta.total.toFixed(2),"5.00"); assert.equal(venta.creadaPor,a.user); assert.equal(venta.estado,"CONFIRMADA"); assert.ok(venta.confirmadaEn);
  assert.equal(await saldo(a,p),"8"); pass("Venta válida: precio servidor, autor verificado, confirmación y descuento");
  assert.equal(venta.detalles[0].movimientos.length,1); assert.equal(venta.detalles[0].movimientos[0].variacion.toString(),"-2"); assert.equal(venta.detalles[0].movimientos[0].tipo,"VENTA"); await integridad(a,p); pass("Movimientos VENTA vinculados al detalle y saldo igual al historial");
  const multi=await a.ventas.registrar(a.org,await solicitud(a,[item(p),item(q,"0.005")]));
  const md=await a.ventas.detalle(a.org,multi.id); assert.equal(md.venta.total.toFixed(2),"2.51"); assert.equal(md.venta.detalles.length,2); assert.equal(await saldo(a,q),"9.995"); pass("Varios productos y redondeo HALF_UP por renglón, cantidades exactas");
  const before=await conteos(a);
  await assert.rejects(a.ventas.cotizar(a.org,[item(p,"999")]));
  await assert.rejects(a.ventas.registrar(a.org,{...command,claveIdempotencia:randomUUID(),items:[item(p,"999")]}));
  assert.deepEqual(await conteos(a),before); pass("Stock insuficiente rechaza y revierte la cabecera de venta");
  for(const cantidad of ["0","-1","1.0001","NaN","Infinity","1e2",""]) assert.equal(itemsVentaSchema.safeParse([item(p,cantidad)]).success,false);
  assert.equal(itemsVentaSchema.safeParse([item(p),item(p)]).success,false);
  assert.equal(itemsVentaSchema.safeParse([item(p),{productoId:p.id.toUpperCase(),cantidad:"1"}]).success,false); pass("Cantidades inválidas y productos repetidos rechazados antes de escribir");
  const inactive=await solicitud(a,[item(q)]); await db.producto.update({where:{id:q.id},data:{activo:false}});
  await assert.rejects(a.ventas.registrar(a.org,inactive)); await assert.rejects(a.ventas.cotizar(a.org,[item(q)]));
  await db.producto.update({where:{id:q.id},data:{activo:true}}); pass("Producto inactivo rechazado incluso después de cotizar");
  await db.producto.update({where:{id:p.id},data:{precioVenta:"9.99"}});
  assert.equal((await a.ventas.detalle(a.org,first.id)).venta.detalles[0].precioUnitario.toFixed(2),"2.50");
  const repeat=await a.ventas.registrar(a.org,command); assert.equal(repeat.id,first.id); assert.equal(repeat.repetido,true); pass("Precio histórico y reintento conservados después de cambiar el catálogo");
  await assert.rejects(a.ventas.registrar(a.org,{...command,items:[item(p,"3")]})); pass("Misma clave con contenido diferente rechazada");
  const repriced=await solicitud(a,[item(q)]); await db.producto.update({where:{id:q.id},data:{precioVenta:"2"}});
  await assert.rejects(a.ventas.registrar(a.org,repriced),/Cambiaron los precios/); pass("Cambio de precio requiere nueva revisión antes de confirmar");
  const duplicate=await solicitud(a,[item(q,"0.500")]);
  const duplicates=await Promise.all(Array.from({length:4},()=>a.ventas.registrar(a.org,duplicate)));
  assert.equal(new Set(duplicates.map(v=>v.id)).size,1); assert.equal(duplicates.filter(v=>!v.repetido).length,1); pass("Cuatro reintentos simultáneos registran una sola venta");
  const scarce=await producto(a,"1"); const c1=await solicitud(a,[item(scarce)]),c2=await solicitud(a,[item(scarce)]);
  const concurrent=await Promise.allSettled([a.ventas.registrar(a.org,c1),a.ventas.registrar(a.org,c2)]);
  assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1); assert.equal(await saldo(a,scarce),"0"); await integridad(a,scarce); pass("Ventas simultáneas no consumen las mismas existencias");
  const x=await producto(a,"4"),y=await producto(a,"4"); const xy=await solicitud(a,[item(x),item(y)]),yx=await solicitud(a,[item(y,"3"),item(x,"3")]);
  await Promise.all([a.ventas.registrar(a.org,xy),a.ventas.registrar(a.org,yx)]); assert.equal(await saldo(a,x),"0"); assert.equal(await saldo(a,y),"0"); pass("Varios productos en orden inverso: bloqueos ordenados evitan interbloqueos");
  const shared=await producto(a,"1"), sharedSale=await solicitud(a,[item(shared)]);
  const mixed=await Promise.allSettled([a.ventas.registrar(a.org,sharedSale),a.inventario.registrar(a.org,{productoId:shared.id,tipo:"AJUSTE",cantidad:"-1",nota:"Conteo ficticio",claveIdempotencia:randomUUID()})]);
  assert.equal(mixed.filter(r=>r.status==="fulfilled").length,1); await integridad(a,shared); pass("Inventario y ventas comparten bloqueos: sin pérdidas de actualización");
  await assert.rejects(a.ventas.cotizar(a.org,[item(foreign)])); await assert.rejects(a.ventas.registrar(a.org,{...command,claveIdempotencia:randomUUID(),items:[item(foreign)]}));
  await assert.rejects(a.ventas.listar(b.org,{})); await assert.rejects(b.ventas.detalle(b.org,first.id)); pass("Productos, ventas y consultas entre empresas rechazados");
  await assert.rejects(a.ventas.registrar(a.org,{...command,claveIdempotencia:randomUUID(),items:[{productoId:randomUUID(),cantidad:"1"}]})); pass("Producto inexistente rechazado");
  assert.ok((await a.ventas.buscarProductos(a.org,{buscar:p.sku})).productos.some(v=>v.id===p.id)); assert.equal((await a.ventas.buscarProductos(a.org,{buscar:foreign.sku})).productos.length,0); pass("Búsqueda por SKU limitada a la empresa");
  const memberKey={organizacionId_usuarioId:{organizacionId:a.org,usuarioId:a.user}};
  for(const rol of ["EMPLEADO","ADMINISTRADOR"]) {
    await db.miembroOrganizacion.update({where:memberKey,data:{rol}});
    await a.ventas.registrar(a.org,await solicitud(a,[item(q,"0.001")])); assert.ok((await a.ventas.listar(a.org,{})).total>0);
  } pass("Empleado y administrador pueden consultar y registrar ventas");
  await db.miembroOrganizacion.update({where:memberKey,data:{rol:"PROPIETARIO"}});
  const anon=crearServicioVentas(db,crearAutorizacion({getUser:async()=>null,findMemberships:async()=>{throw Error("No consultar sin sesión");}}).exigirOrganizacion);
  for(const op of [()=>anon.registrar(a.org,command),()=>anon.listar(a.org,{}),()=>anon.detalle(a.org,first.id),()=>anon.cotizar(a.org,[item(p)]),()=>anon.buscarProductos(a.org,{})]) await assert.rejects(op,e=>e.code==="NO_AUTENTICADO"); pass("Sin sesión: todas las operaciones rechazadas antes de consultar membresías");
  const r=await producto(a),s=await producto(a); const rollbackCommand=await solicitud(a,[item(r),item(s)]); const counts=await conteos(a); let writes=0;
  const failing=db.$extends({query:{movimientoStock:{async create({args,query}){if(args.data.tipo==="VENTA" && ++writes===2)throw Error("Fallo ficticio en segundo movimiento");return query(args);}}}});
  await assert.rejects(crearServicioVentas(failing,a.auth.exigirOrganizacion).registrar(a.org,rollbackCommand),/Fallo ficticio/);
  assert.equal(writes,2); assert.deepEqual(await conteos(a),counts); assert.equal(await saldo(a,r),"10"); assert.equal(await saldo(a,s),"10"); await integridad(a,r); await integridad(a,s);
  assert.equal(await db.venta.count({where:{claveIdempotencia:rollbackCommand.claveIdempotencia}}),0); pass("Fallo tras la primera salida revierte venta, detalles, movimientos, saldos y clave");
  await a.ventas.registrar(a.org,rollbackCommand); pass("Reintento posterior a rollback completo confirma una única venta");
  const big=await producto(a,"3","999999999999.99"); await assert.rejects(a.ventas.cotizar(a.org,[item(big,"2")])); pass("Importes que exceden DECIMAL(14,2) rechazados");
  if(process.argv.includes("--http")) {
    const unauth=await page("/ventas"); assert.ok([303,307,308].includes(unauth.response.status));
    const own=await page(`/ventas?organizacion=${a.org}`,a); assert.equal(own.response.status,200); assert.ok(own.body.includes("Nueva venta") && own.body.includes("Historial de ventas"));
    assert.ok(!own.body.includes(target.adminKey) && !own.body.includes(target.url));
    const detail=await page(`/ventas/${first.id}?organizacion=${a.org}`,a); assert.ok(detail.body.includes("5.00") && detail.body.includes("2.50"));
    const denied=await page(`/ventas/${first.id}?organizacion=${b.org}`,b); assert.ok(!denied.body.includes(p.sku)); pass("HTTP: página y detalle protegidos, aislamiento y ausencia de secretos");
    const ids=await actionIds();
    assert.ok((await action(ids.buscarProductosVenta,a,[a.org,p.sku,1])).includes(p.sku));
    assert.ok((await action(ids.cotizarVenta,a,[a.org,[item(q)]])).includes("revisionPrecios")); pass("HTTP: búsqueda y cotización por Server Actions verificadas");
    const httpCommand=await solicitud(a,[item(q,"0.010")]), previous=await conteos(a), stock=milesimas(await saldo(a,q));
    assert.ok((await action(ids.confirmarVenta,a,undefined,httpCommand)).includes("Venta confirmada y stock actualizado."));
    assert.ok((await action(ids.confirmarVenta,a,undefined,httpCommand)).includes("No se duplicó."));
    assert.equal(milesimas(await saldo(a,q)),stock-BigInt(10)); assert.deepEqual(await conteos(a),previous.map(n=>n+1)); pass("HTTP: confirmar y reintentar registra una sola venta y salida");
    const deniedCounts=await conteos(b);
    assert.ok((await action(ids.confirmarVenta,a,undefined,{...httpCommand,claveIdempotencia:randomUUID(),items:[item(foreign)]})).includes("no disponible"));
    assert.deepEqual(await conteos(b),deniedCounts); pass("HTTP: manipular el producto no permite vender stock ajeno");
  }
  await db.miembroOrganizacion.update({where:memberKey,data:{activa:false,bajaEn:new Date()}});
  await assert.rejects(a.ventas.registrar(a.org,command)); await assert.rejects(a.ventas.listar(a.org,{})); pass("Baja de membresía bloquea nuevas operaciones y reintentos");
  console.log(`RESULTADO: ${passed} comprobaciones de ventas aprobadas`);
} finally {
  await db.$transaction(async tx=>{
    await tx.movimientoStock.deleteMany({where:{organizacionId:{in:orgs}}});
    await tx.detalleVenta.deleteMany({where:{organizacionId:{in:orgs}}}); await tx.venta.deleteMany({where:{organizacionId:{in:orgs}}});
    await tx.saldoStock.deleteMany({where:{organizacionId:{in:orgs}}}); await tx.producto.deleteMany({where:{organizacionId:{in:orgs}}});
    await tx.miembroOrganizacion.deleteMany({where:{usuarioId:{in:users}}}); await tx.perfil.deleteMany({where:{id:{in:users}}}); await tx.organizacion.deleteMany({where:{id:{in:orgs}}});
  });
  for(const id of users) { const {error}=await admin.auth.admin.deleteUser(id); if(error)throw error; }
  await db.$disconnect();
}
