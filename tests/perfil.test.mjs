import test from "node:test";
import assert from "node:assert/strict";
import { perfilSchema, nombresDeMetadata } from "../lib/auth/perfil-reglas.ts";

const valido = { nombre: "Ana", apellido: "Díaz" };
const acepta = datos => perfilSchema.safeParse(datos).success;

test("Nombre y apellido validos: se recortan los espacios de los bordes", () => {
  assert.deepEqual(perfilSchema.parse({ nombre: "  Ana  ", apellido: " Díaz " }), valido);
});

test("Nombre y apellido son obligatorios", () => {
  assert.equal(acepta({}), false);
  assert.equal(acepta({ nombre: "Ana" }), false);
  assert.equal(acepta({ apellido: "Díaz" }), false);
  assert.equal(acepta({ nombre: "", apellido: "Díaz" }), false);
  assert.equal(acepta({ nombre: "Ana", apellido: "" }), false);
});

test("Solo espacios rechazado, incluido el espacio duro y los tabuladores", () => {
  for (const valor of ["   ", "\t", "\n", "\u00A0", "\u00A0 \u00A0"]) {
    assert.equal(acepta({ ...valido, nombre: valor }), false, `nombre invalido: ${JSON.stringify(valor)}`);
    assert.equal(acepta({ ...valido, apellido: valor }), false, `apellido invalido: ${JSON.stringify(valor)}`);
  }
});

test("Valores que no son texto: rechazados", () => {
  for (const valor of [42, null, undefined, { nombre: "Ana" }, ["Ana"], true]) {
    assert.equal(acepta({ ...valido, nombre: valor }), false, `nombre invalido: ${JSON.stringify(valor)}`);
    assert.equal(acepta({ ...valido, apellido: valor }), false, `apellido invalido: ${JSON.stringify(valor)}`);
  }
});

test("Nombre o apellido demasiado largos: rechazados", () => {
  assert.equal(acepta({ ...valido, nombre: "a".repeat(81) }), false);
  assert.equal(acepta({ ...valido, apellido: "a".repeat(81) }), false);
  assert.equal(acepta({ nombre: "a".repeat(80), apellido: "a".repeat(80) }), true);
});

test("nombresDeMetadata toma los nombres declarados al registrarse", () => {
  assert.deepEqual(nombresDeMetadata({ nombre: " Ana ", apellido: "Díaz" }), valido);
});

test("nombresDeMetadata no inventa ni acepta datos invalidos", () => {
  for (const metadata of [undefined, null, {}, { nombre: "Ana" }, { nombre: "Ana", apellido: "   " },
    { nombre: "", apellido: "" }, "texto", 42, { nombre: 7, apellido: "Díaz" },
    { nombre: "a".repeat(81), apellido: "Díaz" }, { sub: "x", email: "a@b.c" }]) {
    assert.equal(nombresDeMetadata(metadata), null, `metadata invalida: ${JSON.stringify(metadata)}`);
  }
});

test("nombresDeMetadata ignora las claves ajenas que trae la metadata real", () => {
  assert.deepEqual(nombresDeMetadata({ sub: "uuid", email: "ana@example.test", email_verified: true,
    nombre: "Ana", apellido: "Díaz", phone_verified: false }), valido);
});
