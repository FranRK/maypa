import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { crearAutorizacion } from "../lib/auth/policy.ts";
import { evaluarPerfilConPrisma, guardarPerfil, completarPerfilDesdeMetadata } from "../lib/auth/perfil.ts";
import { crearServicioProductos } from "../lib/productos/service.ts";
import { crearServicioInventario } from "../lib/inventario/service.ts";
import { crearServicioVentas } from "../lib/ventas/service.ts";
import { localTarget, localClient } from "./supabase-local.mjs";
import { dockerLocalTarget } from "./docker-local-target.mjs";
import { seedLocalOrganization } from "./seed-local.mjs";

const base = "http://127.0.0.1:3000";
const target = process.argv.includes("--docker") ? dockerLocalTarget() : localTarget();
const identity = await localClient(target); await identity.end();
console.log("Pruebas exclusivamente locales:", JSON.stringify(target.safe));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.url, max: 10 }) });
const admin = createClient(target.api, target.adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [], orgs = [];
// Etapa 10: usuarios ficticios con nombre y apellido explicitos. No se derivan del
// correo ni son placeholders de personas reales.
const PERSONA = { nombre: "Prueba", apellido: "Perfil" };
let passed = 0;
const pass = message => { passed++; console.log("OK:", message); };
const fila = usuarioId => db.perfil.findUnique({ where: { id: usuarioId } });
const comercial = ["REGISTRAR_VENTAS", "ADMINISTRAR_PRODUCTOS", "ADMINISTRAR_INVENTARIO", "ADMINISTRAR_ORGANIZACION"];
const lectura = ["VER_DASHBOARD", "VER_PRODUCTOS", "VER_INVENTARIO", "VER_VENTAS"];
const rechazaPorPerfil = error => error?.code === "PERFIL_INCOMPLETO";
const item = (p, cantidad = "1") => ({ productoId: p.id, cantidad });

async function cuenta(metadata) {
  const email = `perfil-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, ...(metadata === undefined ? {} : { user_metadata: metadata }) });
  assert.equal(error, null); users.push(data.user.id);
  return { id: data.user.id, email, password };
}
async function sesion(persona) {
  const cookies = new Map();
  const client = createServerClient(target.api, target.publicKey, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: entries => entries.forEach(({ name, value }) => cookies.set(name, value)) } });
  assert.equal((await client.auth.signInWithPassword({ email: persona.email, password: persona.password })).error, null);
  return { cookies, client };
}
// Usuario con organizacion, membresia PROPIETARIO y sesion real (cookies SSR).
async function conOrganizacion() {
  const persona = await cuenta({ ...PERSONA });
  const seed = await seedLocalOrganization(target, persona.email, `perfil-${randomUUID()}`, undefined, PERSONA);
  orgs.push(seed.organizationId);
  const { cookies, client } = await sesion(persona);
  const auth = crearAutorizacion({ async getUser() { const { data, error } = await client.auth.getUser(); return error ? null : data.user; },
    findMemberships: usuarioId => db.miembroOrganizacion.findMany({ where: { usuarioId }, include: { organizacion: true } }),
    evaluarPerfil: usuarioId => evaluarPerfilConPrisma(db, usuarioId) });
  return { ...persona, org: seed.organizationId, cookies, auth,
    productos: crearServicioProductos(db, auth.exigirOrganizacion),
    inventario: crearServicioInventario(db, auth.exigirOrganizacion),
    ventas: crearServicioVentas(db, auth.exigirOrganizacion) };
}
const cookie = a => [...a.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
async function page(path, a) {
  const response = await fetch(`${base}${path}`, { redirect: "manual", headers: a ? { Cookie: cookie(a) } : {}, signal: AbortSignal.timeout(120000) });
  const body = await response.text();
  assert.ok(!body.includes(target.adminKey) && !body.includes(target.url), "No deben filtrarse secretos ni la cadena de conexión");
  return { response, body };
}
// Referencias publicas de las Server Actions en los chunks del cliente de desarrollo.
async function actionIds(archivo, nombres) {
  const ids = {};
  for (const file of await readdir(".next/dev/static/chunks")) {
    if (!file.endsWith(".js")) continue;
    const source = await readFile(`.next/dev/static/chunks/${file}`, "utf8");
    if (!source.includes(archivo)) continue;
    for (const match of source.matchAll(/\{"([a-f0-9]{40,64})":\{"name":"([^"]+)"\}\}/g)) ids[match[2]] = match[1];
  }
  for (const nombre of nombres) assert.ok(ids[nombre], `No se encontro la referencia de ${nombre} (${archivo})`);
  return ids;
}
async function action(path, id, cuerpo, a) {
  const response = await fetch(`${base}${path}`, { method: "POST", body: cuerpo, signal: AbortSignal.timeout(120000),
    headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, ...(typeof cuerpo === "string" ? { "Content-Type": "text/plain;charset=UTF-8" } : {}), ...(a ? { Cookie: cookie(a) } : {}) } });
  assert.ok(response.status < 500, `La accion respondio ${response.status}`);
  return response.text();
}
// Envio del formulario de /perfil/completar: la accion recibe (estadoPrevio, FormData).
// Los campos van antes de "0": la parte con los argumentos resuelve la referencia "$K1"
// cuando ya leyo el formulario.
function formularioPerfil(campos) {
  const body = new FormData();
  for (const [nombre, valor] of Object.entries(campos)) body.set(`_1_${nombre}`, valor);
  body.set("0", JSON.stringify([{}, "$K1"]));
  return body;
}
const enlace = body => body.includes('href="/perfil/completar"');

try {
  // --- Núcleo de datos -----------------------------------------------------------------
  const sinPerfil = await cuenta({ ...PERSONA });

  const guardado = await guardarPerfil(db, sinPerfil.id, { nombre: "  Ana  ", apellido: " Díaz " });
  assert.deepEqual(guardado, { nombre: "Ana", apellido: "Díaz" });
  const creada = await fila(sinPerfil.id);
  assert.equal(creada.nombre, "Ana"); assert.equal(creada.apellido, "Díaz");
  assert.equal(await evaluarPerfilConPrisma(db, sinPerfil.id), "COMPLETO");
  pass("Sin fila previa: se crea el Perfil propio con los valores recortados");

  await guardarPerfil(db, sinPerfil.id, { nombre: "Ana María", apellido: "Díaz" });
  assert.equal(await db.perfil.count({ where: { id: sinPerfil.id } }), 1);
  assert.equal((await fila(sinPerfil.id)).nombre, "Ana María");
  pass("Guardar dos veces actualiza la misma fila, sin duplicar el perfil");

  const antes = await fila(sinPerfil.id);
  for (const datos of [{ nombre: "", apellido: "Díaz" }, { nombre: "   ", apellido: "Díaz" },
    { nombre: "Ana", apellido: "\u00A0" }, { nombre: "Ana" }, { nombre: 7, apellido: "Díaz" },
    { nombre: "a".repeat(81), apellido: "Díaz" }]) {
    await assert.rejects(guardarPerfil(db, sinPerfil.id, datos), `debia rechazar ${JSON.stringify(datos)}`);
  }
  assert.deepEqual(await fila(sinPerfil.id), antes);
  pass("Vacios, solo espacios, tipos ajenos y textos demasiado largos: rechazados sin escribir");

  const ajena = await cuenta({ ...PERSONA });
  await guardarPerfil(db, ajena.id, { nombre: "Beto", apellido: "Ajena" });
  await guardarPerfil(db, sinPerfil.id, { nombre: "Ana", apellido: "Díaz" });
  assert.equal((await fila(ajena.id)).nombre, "Beto");
  pass("Guardar el perfil propio no modifica el de otra persona");

  const inexistente = randomUUID();
  await assert.rejects(guardarPerfil(db, inexistente, { nombre: "Nadie", apellido: "Inexistente" }));
  assert.equal(await fila(inexistente), null);
  pass("Sin cuenta de Auth no se puede crear un perfil (la relacion se respeta)");

  // --- Registro: la metadata de Auth llega a PostgreSQL --------------------------------
  const registrada = await cuenta({ sub: "uuid", email: "x@example.test", nombre: "  Carla  ", apellido: "Registro" });
  assert.equal(await fila(registrada.id), null);
  assert.equal(await completarPerfilDesdeMetadata(db, registrada.id, { nombre: "  Carla  ", apellido: "Registro" }), "COMPLETO");
  const completa = await fila(registrada.id);
  assert.equal(completa.nombre, "Carla"); assert.equal(completa.apellido, "Registro");
  pass("Registro: el perfil ausente se crea con los nombres declarados en la metadata");

  assert.equal(await completarPerfilDesdeMetadata(db, registrada.id, { nombre: "Otro", apellido: "Nombre" }), "COMPLETO");
  assert.equal((await fila(registrada.id)).nombre, "Carla");
  pass("Registro repetible: no sobrescribe un perfil ya completo");

  // --- Fase 2: la base ya no admite un perfil sin nombre ni apellido --------------------
  const fase2 = await cuenta({ ...PERSONA });
  await assert.rejects(db.perfil.create({ data: { id: fase2.id } }),
    "El cliente Prisma exige nombre y apellido");
  await assert.rejects(db.$executeRaw`INSERT INTO public."Perfil" ("id","nombre","apellido")
    VALUES (${fase2.id}::uuid, ${null}, ${null})`, "NOT NULL rechaza NULL");
  await assert.rejects(db.$executeRaw`INSERT INTO public."Perfil" ("id","nombre","apellido")
    VALUES (${fase2.id}::uuid, ${""}, ${"Diaz"})`, "El CHECK rechaza el nombre vacio");
  await assert.rejects(db.$executeRaw`INSERT INTO public."Perfil" ("id","nombre","apellido")
    VALUES (${fase2.id}::uuid, ${"   "}, ${"Diaz"})`, "El CHECK rechaza solo espacios");
  assert.equal(await fila(fase2.id), null);
  pass("Fase 2: la base rechaza un Perfil sin nombre o apellido validos");

  const sinDatos = await cuenta({ nombre: "   ", apellido: "" });
  for (const metadata of [undefined, null, {}, { nombre: "Ana" }, { nombre: "", apellido: "" },
    { nombre: "   ", apellido: "Díaz" }, { nombre: "a".repeat(81), apellido: "Díaz" }, "texto", 42]) {
    assert.equal(await completarPerfilDesdeMetadata(db, sinDatos.id, metadata), "INCOMPLETO", `metadata: ${JSON.stringify(metadata)}`);
  }
  assert.equal(await fila(sinDatos.id), null);
  pass("Metadata sin nombres utilizables: no crea el perfil ni inventa valores");

  const organizaciones = await db.organizacion.count(), membresias = await db.miembroOrganizacion.count();
  const soloRegistro = await cuenta({ nombre: "Elena", apellido: "Registro" });
  assert.equal(await completarPerfilDesdeMetadata(db, soloRegistro.id, { nombre: "Elena", apellido: "Registro" }), "COMPLETO");
  assert.equal(await db.organizacion.count(), organizaciones, "el registro no debe crear organizaciones");
  assert.equal(await db.miembroOrganizacion.count(), membresias, "el registro no debe crear membresias ni permisos");
  const autorizacionSoloRegistro = crearAutorizacion({ async getUser() { return { id: soloRegistro.id }; },
    findMemberships: usuarioId => db.miembroOrganizacion.findMany({ where: { usuarioId }, include: { organizacion: true } }),
    evaluarPerfil: usuarioId => evaluarPerfilConPrisma(db, usuarioId) });
  await assert.rejects(autorizacionSoloRegistro.exigirOrganizacion(undefined, "REGISTRAR_VENTAS"), e => e.code === "SIN_ORGANIZACION");
  pass("Completar el perfil no otorga organizacion, membresia ni permisos");

  // --- Perfil no completo: se bloquean las operaciones comerciales ---------------------
  // Despues de la fase 2 la base garantiza que todo Perfil tiene nombre y apellido, asi
  // que un perfil incompleto real ya no puede existir. Para ejercer la regla se inyecta
  // la evaluacion: es el mismo camino que recorre el servidor cuando la fila no existe
  // (fila ausente) o cuando el cliente Prisma no puede evaluarla.
  const titular = await conOrganizacion();
  const producto = await titular.productos.guardar(titular.org, undefined,
    { sku: "PERFIL-1", nombre: "Producto ficticio perfil", unidad: "unidad", precioVenta: "3.00", stockMinimo: "0" });
  await titular.inventario.registrar(titular.org, { productoId: producto.id, tipo: "INICIAL", cantidad: "10", nota: "", claveIdempotencia: randomUUID() });
  assert.equal(await evaluarPerfilConPrisma(db, titular.id), "COMPLETO");
  const autorizacionForzada = evaluacion => crearAutorizacion({
    getUser: async () => ({ id: titular.id, email: titular.email }),
    findMemberships: usuarioId => db.miembroOrganizacion.findMany({ where: { usuarioId }, include: { organizacion: true } }),
    evaluarPerfil: async () => evaluacion,
  });
  const ventasAntes = await db.venta.count({ where: { organizacionId: titular.org } });
  const movimientosAntes = await db.movimientoStock.count({ where: { organizacionId: titular.org } });
  for (const evaluacion of ["INCOMPLETO", "NO_EVALUABLE"]) {
    const auth = autorizacionForzada(evaluacion);
    for (const permiso of comercial) await assert.rejects(auth.exigirOrganizacion(titular.org, permiso), rechazaPorPerfil);
    for (const permiso of lectura) assert.equal((await auth.exigirOrganizacion(titular.org, permiso)).organizacion.id, titular.org);
    await assert.rejects(crearServicioVentas(db, auth.exigirOrganizacion).registrar(titular.org, { items: [item(producto, "2")], revisionPrecios: "a".repeat(64), claveIdempotencia: randomUUID() }), rechazaPorPerfil);
    await assert.rejects(crearServicioInventario(db, auth.exigirOrganizacion).registrar(titular.org, { productoId: producto.id, tipo: "COMPRA", cantidad: "1", nota: "", claveIdempotencia: randomUUID() }), rechazaPorPerfil);
    await assert.rejects(crearServicioProductos(db, auth.exigirOrganizacion).guardar(titular.org, undefined, { sku: "PERFIL-2", nombre: "No debe crearse", unidad: "unidad", precioVenta: "1", stockMinimo: "0" }), rechazaPorPerfil);
  }
  assert.equal(await db.venta.count({ where: { organizacionId: titular.org } }), ventasAntes);
  assert.equal(await db.movimientoStock.count({ where: { organizacionId: titular.org } }), movimientosAntes);
  assert.equal(await db.producto.count({ where: { organizacionId: titular.org } }), 1);
  pass("Perfil INCOMPLETO y NO_EVALUABLE: las cuatro operaciones comerciales se rechazan sin escribir; consultar sigue permitido");

  // --- Aviso y pantalla -----------------------------------------------------------------
  // Con el perfil del titular completo, el panel no muestra el aviso.
  const propio = await page(`/dashboard?organizacion=${titular.org}`, titular);
  assert.equal(propio.response.status, 200);
  assert.ok(!enlace(propio.body), "Un perfil completo no muestra el aviso");
  pass("Un perfil completo no muestra el aviso en el panel");

  // Una cuenta sin membresia (y sin perfil) recibe el panel restringido con el enlace.
  const sinMembresia = await cuenta({ ...PERSONA });
  const sesionSinMembresia = await sesion(sinMembresia);
  const restringida = await page("/dashboard", sesionSinMembresia);
  assert.equal(restringida.response.status, 200);
  assert.ok(enlace(restringida.body), "El panel restringido debe ofrecer el enlace a /perfil/completar");
  pass("Sin membresia, el panel ofrece el enlace a /perfil/completar");

  const anonima = await page("/perfil/completar");
  assert.ok([303, 307, 308].includes(anonima.response.status), "Sin sesion debe redirigir");
  assert.equal(new URL(anonima.response.headers.get("location"), base).pathname, "/auth/login");
  pass("Sin sesion, /perfil/completar redirige al login");

  const pantalla = await page("/perfil/completar", titular);
  assert.equal(pantalla.response.status, 200);
  assert.ok(pantalla.body.includes('name="nombre"') && pantalla.body.includes('name="apellido"'), "El formulario debe pedir nombre y apellido");
  assert.ok(pantalla.body.includes('value="Prueba"') && pantalla.body.includes('value="Perfil"'), "El formulario se precarga con los nombres declarados al registrarse");
  pass("La pantalla pide nombre y apellido y precarga lo declarado en el registro");

  // --- La accion de guardado -------------------------------------------------------------
  const idsPerfil = await actionIds("app/perfil/actions.ts", ["guardarPerfil"]);
  for (const campos of [{ nombre: "", apellido: "Ajena" }, { nombre: "   ", apellido: "Ajena" },
    { nombre: "Ana", apellido: "\u00A0" }, { nombre: "", apellido: "" }]) {
    const respuesta = await action("/perfil/completar", idsPerfil.guardarPerfil, formularioPerfil(campos), titular);
    assert.ok(respuesta.includes("Revisá los campos indicados"), `debia rechazar ${JSON.stringify(campos)}`);
    assert.equal((await fila(titular.id)).nombre, "Prueba");
    assert.equal((await fila(titular.id)).apellido, "Perfil");
  }
  pass("HTTP: vacios y solo espacios rechazados por la accion, sin escribir en el perfil");

  const otro = await conOrganizacion();
  const antesOtro = await fila(otro.id);
  const forzada = await action("/perfil/completar", idsPerfil.guardarPerfil,
    formularioPerfil({ nombre: "Suplantado", apellido: "Ajeno", usuarioId: otro.id, id: otro.id, email: otro.email }), titular);
  assert.ok(forzada);
  const despuesOtro = await fila(otro.id);
  assert.equal(despuesOtro.nombre, antesOtro.nombre);
  assert.equal(despuesOtro.apellido, antesOtro.apellido);
  assert.equal((await fila(titular.id)).nombre, "Suplantado");
  pass("HTTP: el id que manda el formulario se ignora; no se puede modificar el perfil ajeno");

  // --- Recuperar permisos y operar de nuevo ---------------------------------------------
  assert.equal(await evaluarPerfilConPrisma(db, titular.id), "COMPLETO");
  for (const permiso of comercial) assert.equal((await titular.auth.exigirOrganizacion(titular.org, permiso)).organizacion.id, titular.org);
  pass("Completar el perfil devuelve los cuatro permisos comerciales");

  const solicitud = { items: [item(producto, "2")], revisionPrecios: (await titular.ventas.cotizar(titular.org, [item(producto, "2")])).revisionPrecios, claveIdempotencia: randomUUID() };
  assert.ok((await titular.ventas.registrar(titular.org, solicitud)).id);
  assert.ok((await titular.inventario.registrar(titular.org, { productoId: producto.id, tipo: "COMPRA", cantidad: "5", nota: "Compra ficticia", claveIdempotencia: randomUUID() })).id);
  assert.ok((await titular.productos.listar(titular.org, {})).total >= 1);
  pass("Con el perfil completo vuelven a funcionar ventas, inventario y productos");

  const despues = await page(`/dashboard?organizacion=${titular.org}`, titular);
  assert.ok(!enlace(despues.body), "Con el perfil completo el aviso debe desaparecer");
  pass("Con el perfil completo el aviso desaparece");

  // --- Cada persona solo ve su perfil y su organizacion ---------------------------------
  const otraPagina = await page(`/dashboard?organizacion=${otro.org}`, otro);
  assert.equal(otraPagina.response.status, 200);
  assert.ok(!otraPagina.body.includes(producto.sku), "No debe ver el producto de la otra organizacion");
  assert.ok(!otraPagina.body.includes("Suplantado"), "No debe aparecer el nombre del perfil ajeno");
  assert.ok(!enlace(otraPagina.body) && !otraPagina.body.includes("Completar mi perfil"), "El perfil ajeno completo no debe ver el aviso");
  pass("Otra persona no ve el perfil ajeno ni datos de la otra organizacion");

  // --- Registro por HTTP ----------------------------------------------------------------
  const pendiente = await cuenta({ nombre: "Gloria", apellido: "Confirmada" });
  assert.equal(await fila(pendiente.id), null);
  const generado = await admin.auth.admin.generateLink({ type: "magiclink", email: pendiente.email });
  assert.equal(generado.error, null);
  const confirmacion = await fetch(`${base}/auth/confirm?token_hash=${generado.data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent("/dashboard")}`, { redirect: "manual", signal: AbortSignal.timeout(120000) });
  assert.ok([303, 307, 308].includes(confirmacion.status), `La confirmacion debe redirigir y respondio ${confirmacion.status}`);
  assert.equal((await fila(pendiente.id)).nombre, "Gloria");
  assert.equal((await fila(pendiente.id)).apellido, "Confirmada");
  pass("Confirmar el correo deja el perfil en PostgreSQL con los nombres declarados");

  const recien = await cuenta({ nombre: "Fabián", apellido: "Alta" });
  assert.equal(await fila(recien.id), null);
  const sesionRecien = await sesion(recien);
  // El alta es la pantalla que importa la accion: hay que pedirla para que el servidor
  // de desarrollo compile el fragmento con su referencia.
  const alta = await page("/auth/sign-up");
  assert.equal(alta.response.status, 200);
  assert.ok(alta.body.includes('name="nombre"') && alta.body.includes('name="apellido"'), "El alta debe pedir nombre y apellido");
  const idsAuth = await actionIds("app/auth/actions.ts", ["completarPerfilDeRegistro"]);
  await action("/perfil/completar", idsAuth.completarPerfilDeRegistro, JSON.stringify([]), sesionRecien);
  assert.equal((await fila(recien.id)).nombre, "Fabián");
  assert.equal((await fila(recien.id)).apellido, "Alta");
  assert.equal(await evaluarPerfilConPrisma(db, recien.id), "COMPLETO");
  pass("HTTP: la accion del alta escribio los nombres en PostgreSQL y no solo en la metadata");

  console.log(`RESULTADO: ${passed} comprobaciones de perfil aprobadas`);
} finally {
  await db.$transaction(async tx => {
    await tx.movimientoStock.deleteMany({ where: { organizacionId: { in: orgs } } });
    await tx.detalleVenta.deleteMany({ where: { organizacionId: { in: orgs } } }); await tx.venta.deleteMany({ where: { organizacionId: { in: orgs } } });
    await tx.saldoStock.deleteMany({ where: { organizacionId: { in: orgs } } }); await tx.producto.deleteMany({ where: { organizacionId: { in: orgs } } });
    await tx.miembroOrganizacion.deleteMany({ where: { usuarioId: { in: users } } }); await tx.perfil.deleteMany({ where: { id: { in: users } } }); await tx.organizacion.deleteMany({ where: { id: { in: orgs } } });
  });
  for (const id of users) { const { error } = await admin.auth.admin.deleteUser(id); if (error) throw error; }
  await db.$disconnect();
}
