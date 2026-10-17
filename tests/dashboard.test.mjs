import test from "node:test";
import assert from "node:assert/strict";
import { EstadoVenta, RolMiembro, TipoMovimiento } from "../src/generated/prisma/enums.ts";
import { rangoDelDiaAr, ZONA_HORARIA } from "../lib/fechas.ts";
import {
  ETIQUETAS_ESTADO_VENTA,
  ETIQUETAS_ROL,
  ETIQUETAS_TIPO_MOVIMIENTO,
  etiquetaAutor,
} from "../lib/etiquetas.ts";

const iso = (fecha) => fecha.toISOString();

test("rangoDelDiaAr: el mediodia UTC del 16 pertenece al dia 16 en Argentina", () => {
  const { inicio, fin } = rangoDelDiaAr(new Date("2026-10-16T12:00:00.000Z"));
  assert.equal(iso(inicio), "2026-10-16T03:00:00.000Z");
  assert.equal(iso(fin), "2026-10-17T03:00:00.000Z");
});

test("rangoDelDiaAr: 02:59 UTC todavia es el dia anterior en Argentina", () => {
  const { inicio, fin } = rangoDelDiaAr(new Date("2026-10-16T02:59:59.999Z"));
  assert.equal(iso(inicio), "2026-10-15T03:00:00.000Z");
  assert.equal(iso(fin), "2026-10-16T03:00:00.000Z");
});

test("rangoDelDiaAr: 03:00 UTC ya es el dia nuevo en Argentina", () => {
  const { inicio, fin } = rangoDelDiaAr(new Date("2026-10-16T03:00:00.000Z"));
  assert.equal(iso(inicio), "2026-10-16T03:00:00.000Z");
  assert.equal(iso(fin), "2026-10-17T03:00:00.000Z");
});

test("rangoDelDiaAr: 02:59 UTC del dia siguiente sigue siendo el 16", () => {
  const { inicio, fin } = rangoDelDiaAr(new Date("2026-10-17T02:59:59.999Z"));
  assert.equal(iso(inicio), "2026-10-16T03:00:00.000Z");
  assert.equal(iso(fin), "2026-10-17T03:00:00.000Z");
});

test("rangoDelDiaAr: el rango dura exactamente 24 horas", () => {
  const { inicio, fin } = rangoDelDiaAr(new Date("2026-06-30T15:30:00.000Z"));
  assert.equal(fin.getTime() - inicio.getTime(), 24 * 60 * 60 * 1000);
});

test("rangoDelDiaAr: cruza el cambio de ano", () => {
  const { inicio, fin } = rangoDelDiaAr(new Date("2026-12-31T23:00:00.000Z"));
  assert.equal(iso(inicio), "2026-12-31T03:00:00.000Z");
  assert.equal(iso(fin), "2027-01-01T03:00:00.000Z");
});

test("rangoDelDiaAr: el rango contiene al instante consultado", () => {
  const ahora = new Date("2026-03-09T07:41:12.345Z");
  const { inicio, fin } = rangoDelDiaAr(ahora);
  assert.ok(inicio <= ahora && ahora < fin);
});

test("rangoDelDiaAr: la zona horaria declarada es Buenos Aires", () => {
  assert.equal(ZONA_HORARIA, "America/Argentina/Buenos_Aires");
});

test("etiquetas: todo estado de venta tiene etiqueta en espanol", () => {
  for (const estado of Object.values(EstadoVenta)) {
    const etiqueta = ETIQUETAS_ESTADO_VENTA[estado];
    assert.equal(typeof etiqueta, "string", `Falta etiqueta para ${estado}`);
    assert.notEqual(etiqueta.trim(), "");
    assert.notEqual(etiqueta, estado, `${estado} no esta traducido`);
  }
  assert.equal(Object.keys(ETIQUETAS_ESTADO_VENTA).length, Object.values(EstadoVenta).length);
});

test("etiquetas: todo rol tiene etiqueta en espanol", () => {
  for (const rol of Object.values(RolMiembro)) {
    const etiqueta = ETIQUETAS_ROL[rol];
    assert.notEqual(etiqueta, rol, `${rol} no esta traducido`);
    assert.notEqual(etiqueta.trim(), "");
  }
  assert.equal(Object.keys(ETIQUETAS_ROL).length, Object.values(RolMiembro).length);
});

test("etiquetas: todo tipo de movimiento tiene etiqueta en espanol", () => {
  for (const tipo of Object.values(TipoMovimiento)) {
    const etiqueta = ETIQUETAS_TIPO_MOVIMIENTO[tipo];
    assert.notEqual(etiqueta, tipo, `${tipo} no esta traducido`);
    assert.notEqual(etiqueta.trim(), "");
  }
  assert.equal(Object.keys(ETIQUETAS_TIPO_MOVIMIENTO).length, Object.values(TipoMovimiento).length);
});

const autor = "035005ff-3d8d-4d87-adf7-0a56913b5358";

test("etiquetaAutor: muestra nombre y apellido del perfil", () => {
  const visible = etiquetaAutor(autor, { perfil: { nombre: "  Ana  ", apellido: "  Gomez  " } });
  assert.equal(visible.texto, "Ana Gomez");
  assert.ok(!visible.texto.includes(autor));
});

test("etiquetaAutor: agrega (vos) cuando es la sesion propia", () => {
  const visible = etiquetaAutor(autor, { perfil: { nombre: "Ana", apellido: "Gomez" }, sesion: { id: autor, email: "ana@ejemplo.test" } });
  assert.equal(visible.texto, "Ana Gomez (vos)");
});

test("etiquetaAutor: usa el nombre parcial si falta el apellido", () => {
  assert.equal(etiquetaAutor(autor, { perfil: { nombre: "Ana", apellido: null } }).texto, "Ana");
  assert.equal(etiquetaAutor(autor, { perfil: { nombre: null, apellido: "Gomez" } }).texto, "Gomez");
});

test("etiquetaAutor: sin nombre propio usa el correo de la sesion", () => {
  const visible = etiquetaAutor(autor, { perfil: { nombre: "   ", apellido: "" }, sesion: { id: autor, email: "ana@ejemplo.test" } });
  assert.equal(visible.texto, "ana@ejemplo.test (vos)");
});

test("etiquetaAutor: sin nombre ni sesion propia no expone el UUID", () => {
  const visible = etiquetaAutor(autor, { perfil: null, sesion: { id: "11111111-1111-1111-1111-111111111111", email: "otro@ejemplo.test" } });
  assert.equal(visible.texto, "Sin nombre cargado");
  assert.ok(!visible.texto.includes(autor));
});

test("etiquetaAutor: un perfil en blanco sin sesion propia no expone el UUID", () => {
  const visible = etiquetaAutor(autor, { perfil: { nombre: "   ", apellido: "  " } });
  assert.equal(visible.texto, "Sin nombre cargado");
  assert.ok(!visible.texto.includes("035005ff"));
});

test("etiquetaAutor: la sesion sin correo no habilita un nombre legible", () => {
  const visible = etiquetaAutor(autor, { perfil: null, sesion: { id: autor } });
  assert.equal(visible.texto, "Sin nombre cargado");
});
