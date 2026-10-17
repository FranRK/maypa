// Etapa 10, fase 3: presentacion del producto de un renglon de venta.
// Prefiere el nombre y el SKU historicos guardados al confirmar la venta. Si la venta
// es anterior a la etapa 10 (ambos campos NULL) cae a los datos actuales del catalogo y
// lo marca para que la pantalla avise que pueden haber cambiado. Modulo puro: solo
// presentacion, sin acceso a datos.

export type DetalleProductoVenta = {
  nombreProducto: string | null;
  skuProducto: string | null;
  producto: { nombre: string; sku: string };
};

export type LineaProductoVenta = { nombre: string; sku: string; historico: boolean };

const conContenido = (valor: string | null): valor is string => typeof valor === "string" && /\S/.test(valor);

export function lineaProducto(detalle: DetalleProductoVenta): LineaProductoVenta {
  if (conContenido(detalle.nombreProducto) && conContenido(detalle.skuProducto)) {
    return { nombre: detalle.nombreProducto, sku: detalle.skuProducto, historico: true };
  }
  return { nombre: detalle.producto.nombre, sku: detalle.producto.sku, historico: false };
}
