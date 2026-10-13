import test from "node:test";
import assert from "node:assert/strict";
import { crearAutorizacion, AutorizacionError } from "../lib/auth/policy.ts";
import { destinoInterno } from "../lib/auth/redirect.ts";

const user = { id: "00000000-0000-0000-0000-000000000001" };
const orgA = "10000000-0000-0000-0000-000000000001";
const orgB = "20000000-0000-0000-0000-000000000001";
const membership = { usuarioId:user.id,organizacionId:orgA,activa:true,rol:"PROPIETARIO",
  organizacion: {id:orgA,nombre:"A",slug:"a"} };
const service = (identity = user, memberships = [membership]) => crearAutorizacion({
  getUser: async () => identity, findMemberships: async () => memberships,
});
const rejected = code => error => error instanceof AutorizacionError && error.code === code;

test("Usuario no autenticado: denegado antes de consultar membresias", async () => {
  let queried = false;
  const auth = crearAutorizacion({getUser:async()=>null,findMemberships:async()=>{queried=true;return[];}});
  await assert.rejects(auth.exigirOrganizacion(orgA),rejected("NO_AUTENTICADO"));
  assert.equal(queried,false);
});
test("Autenticado sin organizacion: restringido", async () => {
  await assert.rejects(service(user,[]).exigirOrganizacion(),rejected("SIN_ORGANIZACION"));
});
test("Miembro activo: permitido", async () => {
  const result = await service().exigirOrganizacion(orgA);
  assert.equal(result.organizacion.id,orgA);
  assert.equal(result.user.id,user.id);
});
test("Miembro dado de baja: rechazado", async () => {
  await assert.rejects(service(user,[{...membership,activa:false}]).exigirOrganizacion(orgA),rejected("ACCESO_DENEGADO"));
});
test("Usuario A no accede a B", async () => {
  await assert.rejects(service().exigirOrganizacion(orgB),rejected("ACCESO_DENEGADO"));
});
test("Empleado no realiza operacion exclusiva de OWNER", async () => {
  await assert.rejects(service(user,[{...membership,rol:"EMPLEADO"}]).exigirOrganizacion(orgA,"ADMINISTRAR_ORGANIZACION"),rejected("ROL_INSUFICIENTE"));
  await service().exigirOrganizacion(orgA,"ADMINISTRAR_ORGANIZACION");
});
test("Membresia de otro usuario y organizacion mal formada no autorizan", async () => {
  await assert.rejects(service(user,[{...membership,usuarioId:"otro"}]).exigirOrganizacion(orgA),rejected("ACCESO_DENEGADO"));
  await assert.rejects(service().exigirOrganizacion("no-es-uuid"),rejected("ACCESO_DENEGADO"));
});
test("La baja se vuelve a consultar en cada operacion", async () => {
  let active = true;
  const auth = crearAutorizacion({getUser:async()=>user,findMemberships:async()=>[{...membership,activa:active}]});
  await auth.exigirOrganizacion(orgA);
  active=false;
  await assert.rejects(auth.exigirOrganizacion(orgA),rejected("ACCESO_DENEGADO"));
});

test("Confirmacion Auth no redirige a destinos externos o mal formados", () => {
  const origin = "http://127.0.0.1:3000";
  for (const value of ["https://otro.example", "//otro.example", "/\n/otro.example", "/\\otro.example", "http://[invalido"]) {
    assert.equal(destinoInterno(value,origin),"/dashboard");
  }
  assert.equal(destinoInterno("/dashboard?organizacion=a",origin),"/dashboard?organizacion=a");
});
