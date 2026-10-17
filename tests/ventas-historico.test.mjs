import test from "node:test";
import assert from "node:assert/strict";
import { lineaProducto } from "../lib/ventas/historico.ts";

// Etapa 10, fase 3: el nombre y el SKU de un renglón de venta se muestran desde los
// datos históricos cuando la venta los conservó; si son NULL (ventas anteriores a la
// etapa 10) se cae a los datos actuales del catálogo y se marca que pueden haber
// cambiado.

test("usa los datos históricos cuando la venta los conservó", () => {
  const linea = lineaProducto({ nombreProducto: "Nombre viejo", skuProducto: "SKU-VIEJO", producto: { nombre: "Nombre nuevo", sku: "SKU-NUEVO" } });
  assert.deepEqual(linea, { nombre: "Nombre viejo", sku: "SKU-VIEJO", historico: true });
});

test("cae a los datos actuales del producto cuando ambos campos son NULL", () => {
  const linea = lineaProducto({ nombreProducto: null, skuProducto: null, producto: { nombre: "Actual", sku: "ACT-1" } });
  assert.deepEqual(linea, { nombre: "Actual", sku: "ACT-1", historico: false });
});

test("un solo campo histórico presente cae a los datos actuales", () => {
  const linea = lineaProducto({ nombreProducto: "Viejo", skuProducto: null, producto: { nombre: "Actual", sku: "ACT-1" } });
  assert.deepEqual(linea, { nombre: "Actual", sku: "ACT-1", historico: false });
});

test("un campo histórico vacío o solo espacios cae a los datos actuales", () => {
  const linea = lineaProducto({ nombreProducto: "  ", skuProducto: "SKU", producto: { nombre: "Actual", sku: "ACT-1" } });
  assert.deepEqual(linea, { nombre: "Actual", sku: "ACT-1", historico: false });
});
