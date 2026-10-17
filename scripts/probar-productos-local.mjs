import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { crearAutorizacion } from "../lib/auth/policy.ts";
import { evaluarPerfilConPrisma } from "../lib/auth/perfil.ts";
import { crearServicioProductos, productoSchema } from "../lib/productos/service.ts";
import { formatearImporte } from "../lib/importes.ts";
import { localTarget } from "./supabase-local.mjs";
import { seedLocalOrganization } from "./seed-local.mjs";

const target = localTarget();
console.log("Destino exclusivo local:", JSON.stringify(target.safe));
const admin = createClient(target.api, target.adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url }) });
const users = [], orgs = [];
// Etapa 10: usuarios ficticios con nombre y apellido explicitos. No se derivan del
// correo ni son placeholders de personas reales.
const PERSONA = { nombre: "Prueba", apellido: "Productos" };
let passed = 0;
function pass(message) { console.log("OK:", message); passed++; }
const data = { sku: "SKU-PRUEBA", nombre: "Producto de prueba", unidad: "unidad", precioVenta: "12.50", stockMinimo: "1.250" };
const http = process.argv.includes("--http");
let createForm;
function decodeHtml(value) { return value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"); }
async function submit(formHtml, session, fields) {
  const form = new FormData();
  let actionId;
  for (const tag of formHtml.matchAll(/<input\b[^>]*>/g)) {
    const name = tag[0].match(/\bname="([^"]*)"/)?.[1];
    if (name?.match(/^\$ACTION_\d+:0$/)) actionId = JSON.parse(decodeHtml(tag[0].match(/\bvalue="([^"]*)"/)?.[1] ?? "{}")).id;
  }
  assert.ok(actionId, "Formulario SSR debe incluir la Server Action");
  // Protocolo de envío hidratado de React: args y referencia a FormData.
  // Enviar org desde aquí también comprueba que el servidor debe validarlo.
  for (const [key, value] of Object.entries(fields)) form.set(`_1_${key}`, value);
  form.set("0", JSON.stringify([session.org, "$undefined", {}, "$K1"]));
  const response = await fetch(`http://127.0.0.1:3000/productos?organizacion=${session.org}`, {
    method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(120000),
    headers: { "Next-Action": actionId, Accept: "text/x-component", Origin: "http://127.0.0.1:3000", Cookie: [...session.cookies].map(([k,v]) => `${k}=${v}`).join("; ") },
  });
  assert.ok(response.status < 500);
  return response.text();
}
async function page(path, session) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, { signal: AbortSignal.timeout(120000), redirect: "manual", headers: session ? { Cookie: [...session.cookies].map(([k,v]) => `${k}=${v}`).join("; ") } : {} });
  const body = await response.text();
  assert.ok(response.status < 500, "La ruta no debe fallar");
  return { response, body };
}
async function fixture() {
  const email = `productos-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url");
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null); users.push(created.user.id);
  const seed = await seedLocalOrganization(target, email, `productos-${randomUUID()}`, undefined, PERSONA);
  orgs.push(seed.organizationId);
  const cookies = new Map();
  const client = createServerClient(target.api, target.publicKey, { cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)),
  } });
  const login = await client.auth.signInWithPassword({ email, password }); assert.equal(login.error, null);
  const authorization = crearAutorizacion({
    async getUser() { const { data, error } = await client.auth.getUser(); return error ? null : data.user; },
    findMemberships: userId => db.miembroOrganizacion.findMany({ where: { usuarioId: userId }, include: { organizacion: true } }),
    evaluarPerfil: userId => evaluarPerfilConPrisma(db, userId),
  });
  return { org: seed.organizationId, user: created.user.id, cookies, service: crearServicioProductos(db, authorization.exigirOrganizacion) };
}
try {
  const a = await fixture(), b = await fixture();
  const p = await a.service.guardar(a.org, undefined, data);
  assert.equal(p.precioVenta.toFixed(2), "12.50"); pass("Alta válida con Prisma y Auth local");
  await assert.rejects(a.service.guardar(a.org, undefined, data), e => e.code === "P2002"); pass("SKU duplicado en la misma organización rechazado");
  const other = await b.service.guardar(b.org, undefined, data); assert.notEqual(p.id, other.id); pass("Mismo SKU en organizaciones diferentes permitido");
  if (http) {
    const anon = await page("/productos"); assert.ok([303,307,308].includes(anon.response.status));
    const own = await page(`/productos?organizacion=${a.org}`, a);
    assert.ok(own.body.includes("SKU-PRUEBA") && own.body.includes("Crear producto") && own.body.includes("Editar producto") && own.body.includes(formatearImporte("12.50")));
    const foreign = await page(`/productos?organizacion=${b.org}`, a);
    assert.ok(!foreign.body.includes("SKU-PRUEBA"));
    assert.ok(!own.body.includes(target.adminKey) && !own.body.includes(target.url));
    pass("HTTP: página autenticada, formularios, rechazo anónimo y organización ajena, sin secretos");
    createForm = [...own.body.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(m => m[0]).find(f => f.includes('name="sku"'));
    assert.ok(createForm);
    const submitted = await submit(createForm, a, { ...data, sku: "HTTP-PRUEBA" });
    assert.ok(submitted.includes("Producto creado."), `Respuesta Action: ${submitted.match(/"mensaje":"([^"]+)"/)?.[1] ?? "sin mensaje de formulario"}; ${submitted.match(/"errores":(\{[^\n]+?\})/)?.[1] ?? "sin errores de campos"}`);
    assert.equal(await db.producto.count({ where: { organizacionId: a.org, sku: "HTTP-PRUEBA" } }), 1);
    const duplicate = await submit(createForm, a, { ...data, sku: "HTTP-PRUEBA" });
    assert.ok(duplicate.includes("El SKU ya está en uso."));
    await db.producto.deleteMany({ where: { organizacionId: a.org, sku: "HTTP-PRUEBA" } });
    pass("HTTP: Server Action crea producto y muestra error de SKU duplicado");
  }
  await a.service.guardar(a.org, p.id, { ...data, nombre: "Editado" });
  assert.equal((await db.producto.findUnique({ where: { id: p.id } })).nombre, "Editado"); pass("Edición persistida");
  await a.service.cambiarEstado(a.org, p.id, false);
  assert.equal((await db.producto.findUnique({ where: { id: p.id } })).activo, false); pass("Desactivación conserva el registro");
  await a.service.cambiarEstado(a.org, p.id, true); pass("Reactivación");
  await assert.rejects(a.service.guardar(a.org, undefined, { ...data, sku: "NEGATIVO", precioVenta: "-1" }));
  assert.equal(await db.producto.count({ where: { organizacionId: a.org, sku: "NEGATIVO" } }), 0); pass("Precio negativo rechazado sin escritura");
  for (const value of ["1.001", "1000000000000", "NaN", "Infinity", "", "1e2"]) assert.equal(productoSchema.safeParse({ ...data, precioVenta: value }).success, false);
  assert.equal(productoSchema.safeParse({ ...data, precioVenta: "12,50" }).success, true); pass("Precisión, límites y coma decimal validados");
  await assert.rejects(a.service.guardar(a.org, other.id, data));
  await assert.rejects(a.service.cambiarEstado(a.org, other.id, false));
  await assert.rejects(a.service.listar(b.org, {}));
  await assert.rejects(a.service.guardar(b.org, undefined, data));
  assert.equal((await db.producto.findUnique({ where: { id: other.id } })).activo, true); pass("IDs y organizaciones ajenas rechazados");
  await db.miembroOrganizacion.update({ where: { organizacionId_usuarioId: { organizacionId: a.org, usuarioId: a.user } }, data: { rol: "EMPLEADO" } });
  assert.equal((await a.service.listar(a.org, {})).total, 1);
  if (http) {
    const employee = await page(`/productos?organizacion=${a.org}`, a);
    assert.ok(employee.body.includes("SKU-PRUEBA") && !employee.body.includes("Crear producto") && !employee.body.includes("Editar producto"));
    pass("HTTP: empleado ve el catálogo sin controles de modificación");
    const denied = await submit(createForm, a, { ...data, sku: "EMPLEADO-ILEGAL" });
    assert.ok(denied.includes("No tenés una sesión o membresía con permisos"));
    assert.equal(await db.producto.count({ where: { organizacionId: a.org, sku: "EMPLEADO-ILEGAL" } }), 0);
    pass("HTTP: Server Action previamente obtenida también rechaza al empleado");
  }
  await assert.rejects(a.service.guardar(a.org, p.id, data), e => e.code === "ROL_INSUFICIENTE");
  await assert.rejects(a.service.cambiarEstado(a.org, p.id, false), e => e.code === "ROL_INSUFICIENTE"); pass("Empleado puede consultar y no modificar");
  await db.miembroOrganizacion.update({ where: { organizacionId_usuarioId: { organizacionId: a.org, usuarioId: a.user } }, data: { rol: "ADMINISTRADOR" } });
  await a.service.guardar(a.org, p.id, data); pass("Administrador puede editar");
  for (let i = 0; i < 11; i++) await a.service.guardar(a.org, undefined, { ...data, sku: `PAG-${i}`, nombre: `Paginado ${i}` });
  const page1 = await a.service.listar(a.org, { estado: "todos" }), page2 = await a.service.listar(a.org, { estado: "todos", pagina: 2 });
  assert.equal(page1.productos.length, 10); assert.equal(page2.productos.length, 2);
  assert.ok(!page1.productos.some(p => page2.productos.some(q => q.id === p.id))); pass("Paginación estable de diez registros");
  assert.equal((await a.service.listar(a.org, { buscar: "sku-prueba" })).total, 1);
  assert.equal((await a.service.listar(a.org, { buscar: "paginado" })).total, 11); pass("Búsqueda por nombre y SKU sin distinguir mayúsculas");
  await a.service.cambiarEstado(a.org, p.id, false);
  assert.equal((await a.service.listar(a.org, { estado: "inactivos" })).total, 1);
  assert.equal((await a.service.listar(a.org, { estado: "activos" })).total, 11); pass("Filtros activo e inactivo");
  await db.miembroOrganizacion.update({ where: { organizacionId_usuarioId: { organizacionId: a.org, usuarioId: a.user } }, data: { activa: false, bajaEn: new Date() } });
  await assert.rejects(a.service.listar(a.org, {})); await assert.rejects(a.service.guardar(a.org, p.id, data)); pass("Membresía dada de baja rechazada");
  const anonymous = crearServicioProductos(db, crearAutorizacion({ getUser: async () => null, findMemberships: async () => { throw Error("No consultar sin sesión"); }, evaluarPerfil: async () => "COMPLETO" }).exigirOrganizacion);
  await assert.rejects(anonymous.listar(a.org, {}), e => e.code === "NO_AUTENTICADO");
  await assert.rejects(anonymous.guardar(a.org, undefined, data), e => e.code === "NO_AUTENTICADO"); pass("Usuario sin sesión rechazado");
  console.log(`RESULTADO: ${passed} pruebas de productos aprobadas`);
} finally {
  // Solo fixtures creadas por esta ejecución; no tocar datos existentes.
  await db.producto.deleteMany({ where: { organizacionId: { in: orgs } } });
  await db.miembroOrganizacion.deleteMany({ where: { usuarioId: { in: users } } });
  await db.perfil.deleteMany({ where: { id: { in: users } } });
  await db.organizacion.deleteMany({ where: { id: { in: orgs } } });
  for (const id of users) { const { error } = await admin.auth.admin.deleteUser(id); if (error) throw error; }
  await db.$disconnect();
}
