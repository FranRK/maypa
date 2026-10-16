import { Suspense } from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { ventas } from "@/lib/ventas/server";
import { VentaError } from "@/lib/ventas/service";
import { AutorizacionError } from "@/lib/auth/policy";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ organizacion?: string | string[] }> };
async function Contenido({ params, searchParams }: Props) {
  const [{ id }, filtros] = await Promise.all([params, searchParams]);
  if (Array.isArray(filtros.organizacion)) notFound();
  let data;
  try { data = await ventas.detalle(filtros.organizacion, id); }
  catch (error) {
    if (error instanceof AutorizacionError && error.code === "NO_AUTENTICADO") redirect("/auth/login");
    if (error instanceof AutorizacionError || error instanceof VentaError || error instanceof z.ZodError) notFound();
    throw error;
  }
  const { context, venta } = data;
  return <main className="mx-auto grid max-w-4xl gap-5 p-4 md:p-8">
    <Link href={`/ventas?organizacion=${context.organizacion.id}`} className="underline">Volver a ventas</Link>
    <div><p>{context.organizacion.nombre}</p><h1 className="break-all text-2xl font-semibold">Venta {venta.id}</h1><p>{venta.estado}</p></div>
    <p>Fecha: {venta.creadaEn.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</p><p className="break-all">Empleado: {venta.creadaPor}</p>
    {venta.detalles.map(d => <article key={d.id} className="grid gap-2 rounded-xl border p-4"><h2 className="break-words font-semibold">{d.producto.nombre} · {d.producto.sku}</h2><p>{d.cantidad.toFixed(3)} {d.producto.unidad} × {d.precioUnitario.toFixed(2)} = {d.subtotal.toFixed(2)}</p>{d.movimientos.map(m => <p key={m.id} className="break-all text-sm text-muted-foreground">Movimiento {m.id} · {m.tipo}: {m.variacion.toFixed(3)}</p>)}</article>)}
    <p className="text-2xl font-semibold">Total: {venta.total.toFixed(2)}</p><p className="text-sm text-muted-foreground">Precios históricos conservados. Las ventas confirmadas no se pueden editar ni eliminar.</p>
  </main>;
}
export default function DetalleVentaPage(props: Props) { return <Suspense fallback={<p className="p-6">Cargando detalle…</p>}><Contenido {...props} /></Suspense>; }
