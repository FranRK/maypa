"use client";
import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { buscarProductosVenta, cotizarVenta, confirmarVenta, type Cotizacion, type ProductoVenta } from "@/app/ventas/actions";
import { DecimalVenta, subtotalVenta } from "@/lib/ventas/importes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FormularioVenta({ org, clave, iniciales, hayMasInicial }: { org: string; clave: string; iniciales: ProductoVenta[]; hayMasInicial: boolean }) {
  const [estado, action, enviando] = useActionState(confirmarVenta.bind(null, org), {});
  const [buscando, buscarTransition] = useTransition();
  const [revisando, cotizarTransition] = useTransition();
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(1);
  const [resultados, setResultados] = useState(iniciales);
  const [hayMas, setHayMas] = useState(hayMasInicial);
  const [carrito, setCarrito] = useState<(ProductoVenta & { cantidad: string })[]>([]);
  const [cotizacion, setCotizacion] = useState<Cotizacion>();
  const [idempotencia, setIdempotencia] = useState(clave);
  const [mensaje, setMensaje] = useState("");
  const bloqueado = enviando || revisando || !!estado.id || !!cotizacion;
  const lineas = carrito.map(p => {
    const cantidad = p.cantidad.replace(",", ".");
    const valida = /^\d{1,11}(?:\.\d{1,3})?$/.test(cantidad) && new DecimalVenta(cantidad).gt(0);
    const subtotal = valida ? subtotalVenta(cantidad, p.precio) : new DecimalVenta(0);
    return { ...p, subtotal: subtotal.toFixed(2), valida, insuficiente: valida && new DecimalVenta(cantidad).gt(p.stock) };
  });
  const valido = lineas.length > 0 && lineas.every(p => p.valida);
  const total = lineas.reduce((suma,p) => suma.add(p.subtotal), new DecimalVenta(0));
  function consultar(n: number) {
    buscarTransition(async () => {
      try {
      const respuesta = await buscarProductosVenta(org, buscar, n);
      if ("mensaje" in respuesta) setMensaje(respuesta.mensaje ?? "Error de búsqueda.");
      else { setResultados(respuesta.productos); setHayMas(respuesta.hayMas); setPagina(n); setMensaje(""); }
      } catch { setMensaje("No se pudo consultar el catálogo. Revisá la conexión y reintentá."); }
    });
  }
  return <section className="grid gap-5 rounded-xl border bg-card p-4 sm:p-6">
    <h2 className="text-2xl font-semibold">Nueva venta</h2>
    <form onSubmit={e => { e.preventDefault(); consultar(1); }} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1"><Label htmlFor="buscar-producto">Buscar por nombre o SKU</Label><Input id="buscar-producto" value={buscar} onChange={e => setBuscar(e.target.value)} maxLength={100} /></div>
      <Button disabled={buscando || bloqueado} variant="outline">{buscando ? "Buscando…" : "Buscar"}</Button>
    </form>
    <div className="grid gap-2 sm:grid-cols-2">{resultados.map(p => <article key={p.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
      <p className="break-words font-medium">{p.nombre}</p><p className="break-all text-sm text-muted-foreground">{p.sku} · {p.precio} · Stock: {p.stock} {p.unidad}</p>
      <Button type="button" variant="outline" disabled={bloqueado || carrito.some(i => i.id === p.id) || carrito.length >= 100} onClick={() => setCarrito([...carrito, { ...p, cantidad: "1" }])}>Agregar</Button>
    </article>)}</div>
    {!resultados.length ? <p>No hay productos activos para esta búsqueda.</p> : null}
    <div className="flex justify-between"><Button type="button" variant="ghost" disabled={pagina === 1 || buscando || bloqueado} onClick={() => consultar(pagina-1)}>Anterior</Button><span>Página {pagina}</span><Button type="button" variant="ghost" disabled={!hayMas || buscando || bloqueado} onClick={() => consultar(pagina+1)}>Siguiente</Button></div>
    <h3 className="text-lg font-semibold">Productos seleccionados</h3>
    {!carrito.length ? <p className="text-muted-foreground">Agregá uno o varios productos.</p> : null}
    {lineas.map(p => <div key={p.id} className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_auto]">
      <div className="min-w-0"><p className="break-words font-medium">{p.nombre}</p><p className="break-all text-sm">SKU: {p.sku} · Precio: {p.precio} · Disponible: {p.stock} {p.unidad}</p><p>Subtotal estimado: {p.subtotal}</p></div>
      <div><Label htmlFor={`cantidad-${p.id}`}>Cantidad</Label><Input id={`cantidad-${p.id}`} inputMode="decimal" value={p.cantidad} maxLength={15} disabled={bloqueado} aria-invalid={!p.valida || p.insuficiente} onChange={e => setCarrito(carrito.map(i => i.id === p.id ? { ...i, cantidad: e.target.value } : i))} />{!p.valida ? <p className="text-sm text-destructive">Cantidad positiva, hasta 3 decimales.</p> : p.insuficiente ? <p className="text-sm text-destructive">Stock consultado insuficiente.</p> : null}</div>
      <Button type="button" variant="ghost" disabled={bloqueado} onClick={() => setCarrito(carrito.filter(i => i.id !== p.id))}>Quitar</Button>
    </div>)}
    <p className="text-xl font-semibold">Total estimado: {total.toFixed(2)}</p>
    <p className="text-sm text-muted-foreground">Se redondea cada subtotal a dos decimales. Revisá los precios y el stock actuales antes de confirmar.</p>
    {!cotizacion ? <Button type="button" disabled={!valido || bloqueado} onClick={() => cotizarTransition(async () => {
      try {
      const respuesta = await cotizarVenta(org, carrito.map(p => ({ productoId: p.id, cantidad: p.cantidad })));
      setMensaje(respuesta.mensaje ?? ""); setCotizacion(respuesta.cotizacion);
      } catch { setMensaje("No se pudo revisar el total. Revisá la conexión y reintentá."); }
    })}>{revisando ? "Revisando precios y stock…" : "Revisar venta"}</Button> : <div className="grid gap-3 rounded-lg border p-4">
      <h3 className="font-semibold">Confirmación · precios verificados por el servidor</h3>
      {cotizacion.detalles.map(d => <p key={d.productoId} className="break-words text-sm">{d.nombre} · {d.cantidad} × {d.precioUnitario} = {d.subtotal} · Disponible: {d.stock}</p>)}
      <p className="text-2xl font-semibold">Total: {cotizacion.total}</p>
      <p className="text-sm">Al confirmar se descontará el stock. La venta confirmada no se puede editar ni eliminar.</p>
      <form action={action}><input type="hidden" name="solicitud" value={JSON.stringify({ claveIdempotencia: idempotencia, revisionPrecios: cotizacion.revisionPrecios, items: cotizacion.detalles.map(d => ({ productoId: d.productoId, cantidad: d.cantidad })) })} /><Button disabled={enviando || !!estado.id}>{enviando ? "Confirmando…" : estado.incierto ? "Reintentar misma solicitud" : "Confirmar venta"}</Button></form>
      <Button type="button" variant="outline" disabled={enviando || !!estado.id || estado.incierto} onClick={() => { setCotizacion(undefined); setIdempotencia(crypto.randomUUID()); setMensaje(""); }}>Modificar carrito</Button>
    </div>}
    <div aria-live="polite">{mensaje ? <p role="alert">{mensaje}</p> : null}{estado.mensaje ? <p role={estado.id ? "status" : "alert"}>{estado.mensaje}</p> : null}</div>
    {estado.id ? <div className="flex flex-wrap gap-4"><Link className="underline" href={`/ventas/${estado.id}?organizacion=${org}`}>Ver venta registrada</Link><a className="underline" href={`/ventas?organizacion=${org}`}>Nueva venta</a></div> : null}
  </section>;
}
