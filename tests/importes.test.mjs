import test from "node:test";
import assert from "node:assert/strict";
import { formatearImporte } from "../lib/importes.ts";

// Normaliza cualquier espacio (incluido el espacio duro que inserta ICU) para poder
// afirmar el texto sin depender del caracter exacto del separador.
const visible = (valor) => formatearImporte(valor).replace(/\s/g, " ");

test("formatearImporte: pesos argentinos con dos decimales", () => {
  assert.equal(visible("15.00"), "$ 15,00");
  assert.equal(visible("2.50"), "$ 2,50");
  assert.equal(visible("0"), "$ 0,00");
  assert.equal(visible("0.00"), "$ 0,00");
});

test("formatearImporte: separa los miles con punto", () => {
  assert.equal(visible("1234.5"), "$ 1.234,50");
  assert.equal(visible("999999999999.99"), "$ 999.999.999.999,99");
});

test("formatearImporte: acepta number y string sin cambiar el valor", () => {
  assert.equal(visible(15), visible("15.00"));
  assert.equal(visible(1234.5), visible("1234.500"));
});

test("formatearImporte: un valor no numerico es un error de programacion", () => {
  assert.throws(() => formatearImporte("no-es-un-importe"));
  assert.throws(() => formatearImporte(Number.NaN));
});
