import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { crearAutorizacion } from "../lib/auth/policy.ts";
import { evaluarPerfilConPrisma } from "../lib/auth/perfil.ts";
import { crearServicioInventario } from "../lib/inventario/service.ts";
import { milesimas } from "../lib/inventario/cantidades.ts";
import { crearServicioVentas } from "../lib/ventas/service.ts";
import { crearServicioDashboard } from "../lib/dashboard/service.ts";
import { rangoDelDiaAr, ZONA_HORARIA } from "../lib/fechas.ts";
import { formatearImporte } from "../lib/importes.ts";
import { localTarget, localClient } from "./supabase-local.mjs";
import { dockerLocalTarget } from "./docker-local-target.mjs";
import { seedLocalOrganization } from "./seed-local.mjs";

const target = process.argv.includes("--docker") ? dockerLocalTarget() : localTarget();
const identity = await localClient(target); await identity.end();
console.log("Pruebas exclusivamente locales:", JSON.stringify(target.safe));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, max: 15 }) });
const admin = createClient(target.api, target.adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [], orgs = [];
// Etapa 10: usuarios ficticios con nombre y apellido explicitos. No se derivan del
// correo ni son placeholders de personas reales.
const PERSONA = { nombre: "Prueba", apellido: "Dashboard" };
let passed = 0;
const pass = message => { passed++; console.log("OK:", message); };
const MINUTO = 60 * 1000, DIA = 24 * 60 * MINUTO;

async function fixture() {
  const email = `dashboard-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null); users.push(data.user.id);
  const seed = await seedLocalOrganization(target, email, `dashboard-${randomUUID()}`, undefined, PERSONA); orgs.push(seed.organizationId);
  const cookies = new Map();
  const client = createServerClient(target.api, target.publicKey, { cookies: { getAll: () => [...cookies].map(([name,value])=>({ name,value })), setAll: entries => entries.forEach(({name,value})=>cookies.set(name,value)) } });
  assert.equal((await client.auth.signInWithPassword({ email,password })).error,null);
  const auth = crearAutorizacion({ async getUser() { const { data,error } = await client.auth.getUser(); return error ? null : data.user; },
    findMemberships: usuarioId => db.miembroOrganizacion.findMany({ where: { usuarioId }, include: { organizacion: true } }),
    evaluarPerfil: usuarioId => evaluarPerfilConPrisma(db, usuarioId) });
  return { org: seed.organizationId, user: data.user.id, email, auth, cookies,
    ventas: crearServicioVentas(db,auth.exigirOrganizacion), inventario: crearServicioInventario(db,auth.exigirOrganizacion),
    dashboard: crearServicioDashboard(db,auth.exigirOrganizacion) };
}
// El stock se crea por el servicio (o con saldo cero) para no romper el invariante saldo = historial.
async function producto(a, { cantidad = "10", stockMinimo = "0", precioVenta = "2.50", activo = true } = {}) {
  const p = await db.producto.create({ data: { organizacionId: a.org, sku: randomUUID(), nombre: "Producto ficticio dashboard", precioVenta, stockMinimo, activo } });
  if (!activo) return p;
  if (milesimas(cantidad) > BigInt(0)) await a.inventario.registrar(a.org, { productoId: p.id, tipo: "INICIAL", cantidad, nota: "", claveIdempotencia: randomUUID() });
  else await db.saldoStock.create({ data: { organizacionId: a.org, productoId: p.id, cantidad: "0" } });
  return p;
}
const item = (p,cantidad="1") => ({productoId:p.id,cantidad});
async function solicitud(a,items) { const quote=await a.ventas.cotizar(a.org,items); return {items,revisionPrecios:quote.revisionPrecios,claveIdempotencia:randomUUID()}; }
const venta = (org, usuario, creadaEn, estado, total) => db.venta.create({ data: { organizacionId: org, creadaPor: usuario, estado, total,
  claveIdempotencia: randomUUID(), huellaSolicitud: randomUUID().replace(/-/g,"").padEnd(64,"0").slice(0,64), creadaEn, confirmadaEn: estado === "BORRADOR" ? null : creadaEn } });
// Los ajustes exigen motivo e idempotencia propia por CHECK de la base.
const movimiento = (org, usuario, p, creadoEn, tipo = "AJUSTE", variacion = "1") => db.movimientoStock.create({ data: { organizacionId: org, productoId: p.id, usuarioId: usuario, tipo, variacion, creadoEn, nota: "Ajuste ficticio",
  claveIdempotencia: randomUUID(), huellaSolicitud: randomUUID().replace(/-/g,"").repeat(2) } });
const cookie = a => [...a.cookies].map(([k,v])=>`${k}=${v}`).join("; ");
async function page(path,a) { const response=await fetch(`http://127.0.0.1:3000${path}`,{redirect:"manual",headers:a?{Cookie:cookie(a)}:{},signal:AbortSignal.timeout(120000)}); return {response,body:await response.text()}; }
const desc = (lista, etiqueta, campo = "creadaEn") => {
  const tiempos = lista.map(v => v[campo].getTime());
  for (let i = 1; i < tiempos.length; i++) assert.ok(tiempos[i-1] >= tiempos[i],
    `${etiqueta}: se esperaba orden descendente y llego ${new Date(tiempos[i-1]).toISOString()} antes de ${new Date(tiempos[i]).toISOString()}`);
};

try {
  const a = await fixture(), b = await fixture();
  const pa = await producto(a), pb = await producto(b);
  await a.ventas.registrar(a.org, await solicitud(a, [item(pa, "2")]));
  await b.ventas.registrar(b.org, await solicitud(b, [item(pb, "1")]));

  // --- Aislamiento por organizacion -------------------------------------------------
  const ra = await a.dashboard.resumen(a.org), rb = await b.dashboard.resumen(b.org);
  assert.equal(ra.context.organizacion.id, a.org); assert.equal(ra.context.user.id, a.user);
  assert.equal(ra.ventasDelDia.cantidad, 1); assert.equal(ra.ventasDelDia.total, "5.00");
  assert.equal(rb.ventasDelDia.cantidad, 1); assert.equal(rb.ventasDelDia.total, "2.50");
  const ventaB = await db.venta.findFirstOrThrow({ where: { organizacionId: b.org } });
  assert.ok(!ra.ultimasVentas.some(v => v.id === ventaB.id));
  assert.ok(!ra.movimientos.some(m => m.producto.sku === pb.sku));
  assert.ok(!ra.ultimasVentas.some(v => v.creadaPor === b.user));
  pass("Indicadores limitados a la organizacion autorizada; datos de otra empresa ausentes");

  // --- Corte del dia en horario argentino -------------------------------------------
  const ahora = new Date(), { inicio, fin } = rangoDelDiaAr(ahora);
  assert.equal(inicio.getUTCHours(), 3); assert.equal(inicio.getUTCMinutes(), 0);
  assert.equal(fin.getTime() - inicio.getTime(), DIA); assert.ok(inicio <= ahora && ahora < fin);
  const base = await a.dashboard.resumen(a.org, { ahora });
  const ayerTarde = await venta(a.org, a.user, new Date(inicio.getTime() - 1), "CONFIRMADA", "1.11");
  const hoyCero = await venta(a.org, a.user, inicio, "CONFIRMADA", "2.22");
  const desdeHoy = await a.dashboard.resumen(a.org, { ahora });
  assert.equal(desdeHoy.ventasDelDia.cantidad, base.ventasDelDia.cantidad + 1);
  assert.equal(desdeHoy.ventasDelDia.total, (Number(base.ventasDelDia.total) + 2.22).toFixed(2));
  assert.equal(hoyCero.creadaEn.getTime(), inicio.getTime()); assert.equal(ayerTarde.creadaEn.getTime(), inicio.getTime() - 1);
  assert.ok(desdeHoy.ultimasVentas.some(v => v.id === ayerTarde.id));
  pass("00:00 argentino entra al dia y 23:59:59.999 queda afuera; el historial no se recorta por fecha");

  // --- El dia del servicio coincide con la ventana argentina ------------------------
  const ahoraActual = new Date(), { inicio: inicioHoy, fin: finHoy } = rangoDelDiaAr(ahoraActual);
  const esperado = await db.venta.aggregate({ where: { organizacionId: a.org, estado: "CONFIRMADA", creadaEn: { gte: inicioHoy, lt: finHoy } }, _sum: { total: true }, _count: { _all: true } });
  const actual = await a.dashboard.resumen(a.org, { ahora: ahoraActual });
  assert.equal(actual.ventasDelDia.cantidad, esperado._count._all);
  assert.equal(actual.ventasDelDia.total, esperado._sum.total.toFixed(2));
  assert.equal(ZONA_HORARIA, "America/Argentina/Buenos_Aires");
  pass("Ventas del dia coinciden con la agregacion independiente sobre la ventana argentina");

  // --- Desplazar el reloj mueve la ventana sin tocar filas --------------------------
  const confirmada = actual.ultimasVentas.find(v => v.estado === "CONFIRMADA");
  const manana = await a.dashboard.resumen(a.org, { ahora: new Date(confirmada.creadaEn.getTime() + DIA) });
  const ayer = await a.dashboard.resumen(a.org, { ahora: new Date(confirmada.creadaEn.getTime() - DIA) });
  assert.equal(manana.ventasDelDia.cantidad, 0); assert.equal(manana.ventasDelDia.total, "0.00");
  assert.equal(ayer.ventasDelDia.cantidad, 1); assert.equal(ayer.ventasDelDia.total, "1.11");
  assert.ok(manana.ultimasVentas.some(v => v.id === confirmada.id));
  pass("Reloj inyectable: la ventana se corre un dia exacto y la venta de las 23:59 aparece en el dia anterior");

  // --- Solo ventas confirmadas ------------------------------------------------------
  const antesDeEstados = await a.dashboard.resumen(a.org, { ahora });
  const borrador = await venta(a.org, a.user, new Date(ahora.getTime() - MINUTO), "BORRADOR", "9.99");
  const cancelada = await venta(a.org, a.user, new Date(ahora.getTime() - MINUTO), "CANCELADA", "8.88");
  const conEstados = await a.dashboard.resumen(a.org, { ahora });
  assert.deepEqual(conEstados.ventasDelDia, antesDeEstados.ventasDelDia);
  assert.ok(conEstados.ultimasVentas.some(v => v.id === borrador.id));
  assert.equal(conEstados.ultimasVentas.find(v => v.id === cancelada.id).estado, "CANCELADA");
  pass("Ventas brutas del dia cuentan solo CONFIRMADA; el historial conserva todos los estados");

  // --- Stock bajo con la misma semantica que Inventario -----------------------------
  const antesStock = (await a.dashboard.resumen(a.org)).stockBajo;
  const conStock = await producto(a, { cantidad: "5", stockMinimo: "3" });
  const bajo = await producto(a, { cantidad: "2", stockMinimo: "3" });
  const sinMinimo = await producto(a, { cantidad: "0", stockMinimo: "0" });
  const inactivo = await producto(a, { cantidad: "7", stockMinimo: "50", activo: false });
  const sinFila = await db.producto.create({ data: { organizacionId: a.org, sku: randomUUID(), nombre: "Sin fila de saldo", precioVenta: "1", stockMinimo: "1" } });
  assert.equal(conStock.activo, true); assert.equal(sinMinimo.stockMinimo.toFixed(3), "0.000"); assert.equal(inactivo.activo, false);
  const despuesStock = (await a.dashboard.resumen(a.org)).stockBajo;
  assert.equal(despuesStock - antesStock, 2);
  const listado = await a.inventario.listar(a.org, { estado: "activos", stock: "bajo", pagina: 1 });
  const inventarioBajo = listado.total;
  assert.equal(despuesStock, inventarioBajo); assert.ok(inventarioBajo >= 2);
  const idsBajos = listado.productos.map(p => p.id);
  assert.ok(idsBajos.includes(sinFila.id), "Un producto sin fila de saldo y con minimo cuenta como bajo");
  assert.ok(!idsBajos.includes(inactivo.id), "Un producto inactivo no cuenta aunque este bajo el minimo");
  assert.ok(!idsBajos.includes(sinMinimo.id), "Un producto con minimo cero no debe figurar como bajo");
  pass("Stock bajo: activos en cero o bajo el minimo cuentan; inactivos y minimo cero no; coincide con Inventario");

  // --- Ultimas cinco ventas y ultimos cinco movimientos -----------------------------
  const extra = [];
  for (let i = 1; i <= 6; i++) extra.push(await venta(a.org, a.user, new Date(ahora.getTime() - i * MINUTO), "CONFIRMADA", `${i}.00`));
  const rul = await a.dashboard.resumen(a.org, { ahora });
  assert.ok((await db.venta.count({ where: { organizacionId: a.org } })) > 5);
  assert.equal(rul.ultimasVentas.length, 5);
  assert.ok(rul.ultimasVentas.some(v => v.id === extra[0].id));
  assert.ok(!rul.ultimasVentas.some(v => v.id === extra[5].id));
  desc(rul.ultimasVentas, "ultimasVentas");
  const compra = await a.inventario.registrar(a.org, { productoId: bajo.id, tipo: "COMPRA", cantidad: "7", nota: "Compra ficticia", claveIdempotencia: randomUUID() });
  assert.ok(compra.id);
  const viejos = [];
  for (let i = 1; i <= 6; i++) viejos.push(await movimiento(a.org, a.user, bajo, new Date(ahora.getTime() - i * DIA), "AJUSTE", "1"));
  const rmov = await a.dashboard.resumen(a.org, { ahora });
  assert.equal(rmov.movimientos.length, 5);
  assert.ok(!rmov.movimientos.some(m => m.id === viejos[5].id));
  assert.equal(rmov.movimientos[0].tipo, "COMPRA");
  assert.equal(rmov.movimientos[0].producto.nombre, bajo.nombre); assert.equal(rmov.movimientos[0].producto.sku, bajo.sku);
  assert.equal(rmov.movimientos[0].producto.unidad, bajo.unidad);
  assert.equal(rmov.movimientos[0].variacion.toFixed(3), "7.000");
  assert.equal(rmov.movimientos[0].usuarioId, a.user);
  assert.equal(rmov.movimientos[0].autor.perfil.nombre, PERSONA.nombre); assert.equal(rmov.movimientos[0].autor.perfil.apellido, PERSONA.apellido);
  assert.equal(rmov.ultimasVentas[0].creador.perfil.nombre, PERSONA.nombre); assert.equal(rmov.ultimasVentas[0].creador.perfil.apellido, PERSONA.apellido);
  desc(rmov.movimientos, "movimientos", "creadoEn");
  pass("Ultimas cinco ventas y ultimos cinco movimientos: limite, orden descendente y producto asociado");

  // --- Autorizacion -----------------------------------------------------------------
  await assert.rejects(a.dashboard.resumen(b.org), e => e.code === "ACCESO_DENEGADO");
  await assert.rejects(a.dashboard.resumen("no-es-uuid"), e => e.code === "ACCESO_DENEGADO");
  const anon = crearServicioDashboard(db, crearAutorizacion({ getUser: async () => null,
    findMemberships: async () => { throw Error("No consultar sin sesion"); }, evaluarPerfil: async () => "COMPLETO" }).exigirOrganizacion);
  await assert.rejects(anon.resumen(a.org), e => e.code === "NO_AUTENTICADO");
  await assert.rejects(anon.resumen(undefined), e => e.code === "NO_AUTENTICADO");
  pass("Sin sesion rechazado antes de consultar membresias; organizacion ajena e id invalido denegados");

  // --- HTTP -------------------------------------------------------------------------
  if (process.argv.includes("--http")) {
    const anonima = await page("/dashboard"); assert.ok([303,307,308].includes(anonima.response.status), "Sin sesión el panel debe redirigir al login");
    const propia = await page(`/dashboard?organizacion=${a.org}`, a);
    assert.equal(propia.response.status, 200);
    for (const texto of ["Ventas del día", "Cantidad de ventas", "Productos con stock bajo", "Últimas ventas", "Movimientos recientes"]) assert.ok(propia.body.includes(texto), `Falta "${texto}"`);
    const reciente = (await a.dashboard.resumen(a.org)).ultimasVentas[0];
    assert.ok(propia.body.includes(`/ventas/${reciente.id}?organizacion=${a.org}`), "El dashboard debe enlazar al detalle de la venta");
    const ultimoMovimiento = (await a.dashboard.resumen(a.org)).movimientos[0];
    assert.ok(propia.body.includes(`/inventario?organizacion=${a.org}&amp;producto=${ultimoMovimiento.productoId}#historial`), "El dashboard debe enlazar al historial del producto");
    assert.ok(propia.body.includes(`/productos?organizacion=${a.org}`) && propia.body.includes(`/ventas?organizacion=${a.org}`) && propia.body.includes(`/inventario?organizacion=${a.org}`), "La navegación debe enlazar las cuatro secciones con la organización autorizada");
    assert.ok(propia.body.includes(ultimoMovimiento.producto.sku), "Los movimientos recientes muestran el SKU del producto propio");
    assert.ok(!propia.body.includes(pb.sku), "No debe aparecer el SKU de la otra organización");
    const fresca = await a.dashboard.resumen(a.org);
    assert.ok(propia.body.includes(`${PERSONA.nombre} ${PERSONA.apellido} (vos)`), "El panel debe mostrar nombre y apellido del autor");
    assert.ok(!propia.body.includes(a.user), "El panel no debe exponer el UUID del autor");
    assert.ok(propia.body.includes(formatearImporte(fresca.ventasDelDia.total)), "Ventas del día formateado en es-AR/ARS");
    assert.ok(propia.body.includes(formatearImporte(fresca.ultimasVentas[0].total.toFixed(2))), "El total de la última venta va formateado");
    assert.ok(!propia.body.includes(target.adminKey) && !propia.body.includes(target.url), "No deben filtrarse secretos ni la cadena de conexión");
    const ajena = await page(`/dashboard?organizacion=${a.org}`, b);
    assert.ok(ajena.response.status === 404 || ajena.body.includes("NEXT_HTTP_ERROR_FALLBACK;404") || ajena.body.includes("This page could not be found"),
      `Pedir el panel ajeno debe resolverse como no encontrado y llegó ${ajena.response.status}`);
    assert.ok(!ajena.body.includes("Productos con stock bajo") && !ajena.body.includes(bajo.sku), "El panel ajeno no debe renderizarse ni filtrar datos");
    const nombrada = await page(`/dashboard?organizacion=${b.org}`, b);
    assert.ok(!nombrada.body.includes(bajo.sku) && !nombrada.body.includes(`/ventas/${reciente.id}`), "El panel propio no debe incluir datos de la otra organización");
    assert.equal(nombrada.response.status, 200);
    pass("HTTP: dashboard protegido, indicadores y enlaces presentes, sin secretos ni datos ajenos");
  }

  // --- Baja de membresia ------------------------------------------------------------
  const memberKey = { organizacionId_usuarioId: { organizacionId: a.org, usuarioId: a.user } };
  const antesBaja = await a.dashboard.resumen(a.org, { ahora });
  await db.miembroOrganizacion.update({ where: memberKey, data: { activa: false, bajaEn: new Date() } });
  await assert.rejects(a.dashboard.resumen(a.org), e => e.code === "ACCESO_DENEGADO");
  pass("Baja de membresia bloquea el dashboard");
  await db.miembroOrganizacion.update({ where: memberKey, data: { activa: true, bajaEn: null } });
  const reactivada = await a.dashboard.resumen(a.org, { ahora });
  assert.deepEqual(reactivada.ventasDelDia, antesBaja.ventasDelDia);
  assert.equal(reactivada.stockBajo, antesBaja.stockBajo);
  assert.deepEqual(reactivada.ultimasVentas.map(v => v.id), antesBaja.ultimasVentas.map(v => v.id));
  assert.deepEqual(reactivada.movimientos.map(m => m.id), antesBaja.movimientos.map(m => m.id));
  pass("Reactivar la membresia devuelve exactamente el mismo resumen, sin cambios de datos");

  console.log(`RESULTADO: ${passed} comprobaciones de dashboard aprobadas`);
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
