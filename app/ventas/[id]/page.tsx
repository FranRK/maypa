import { Suspense } from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { ventas } from "@/lib/ventas/server";
import { VentaError } from "@/lib/ventas/service";
import { AutorizacionError } from "@/lib/auth/policy";
import { estadoPerfilDeUsuario } from "@/lib/auth/server";
import { ETIQUETAS_ESTADO_VENTA, ETIQUETAS_TIPO_MOVIMIENTO } from "@/lib/etiquetas";
import { formatearFechaHora } from "@/lib/fechas";
import { formatearImporte } from "@/lib/importes";
import { NavPrincipal } from "@/components/nav-principal";
import { Autor } from "@/components/autor";
import { Badge } from "@/components/ui/badge";
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
  const org = context.organizacion.id;
  const perfilIncompleto = (await estadoPerfilDeUsuario(context.user.id)) === "INCOMPLETO";
  const sesion = { id: context.user.id, email: context.user.email };
  return <main className="mx-auto grid max-w-4xl gap-5 p-4 md:p-8">
    <NavPrincipal org={org} actual="/ventas" perfilIncompleto={perfilIncompleto} />
    <Link href={`/ventas?organizacion=${org}`} className="inline-flex h-11 items-center underline sm:h-9">Volver a ventas</Link>
    <div><p className="text-muted-foreground">{context.organizacion.nombre}</p><h1 className="text-2xl font-semibold">Venta del {formatearFechaHora(venta.creadaEn)}</h1><div className="mt-2"><Badge>{ETIQUETAS_ESTADO_VENTA[venta.estado]}</Badge></div></div>
    <p className="text-sm">Empleado: <Autor usuarioId={venta.creadaPor} perfil={venta.creador.perfil} sesion={sesion} /></p>
    {venta.detalles.map(d => <article key={d.id} className="grid gap-2 rounded-xl border p-4">
      <h2 className="break-words font-semibold">{d.producto.nombre} · {d.producto.sku}</h2>
      <p className="flex flex-wrap items-baseline gap-x-1 tabular-nums">{d.cantidad.toFixed(3)} {d.producto.unidad} × {formatearImporte(d.precioUnitario.toFixed(2))} = <span className="font-medium">{formatearImporte(d.subtotal.toFixed(2))}</span></p>
      {d.movimientos.map(m => <p key={m.id} className="text-sm text-muted-foreground">{ETIQUETAS_TIPO_MOVIMIENTO[m.tipo]}: {m.variacion.toFixed(3)} {d.producto.unidad}</p>)}
    </article>)}
    <p className="text-2xl font-semibold tabular-nums">Total: {formatearImporte(venta.total.toFixed(2))}</p><p className="text-sm text-muted-foreground">Precios históricos conservados. Las ventas confirmadas no se pueden editar ni eliminar.</p>
  </main>;
}
export default function DetalleVentaPage(props: Props) { return <Suspense fallback={<p className="p-6">Cargando detalle…</p>}><Contenido {...props} /></Suspense>; }
