import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ventas } from "@/lib/ventas/server";
import { AutorizacionError } from "@/lib/auth/policy";
import { FormularioVenta } from "@/components/ventas/formulario";
import { LogoutButton } from "@/components/logout-button";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
async function Contenido({ searchParams }: Props) {
  const params = await searchParams;
  let data;
  try {
    const filtros = z.object({ organizacion: z.string().optional(), pagina: z.string().optional() }).parse(params);
    data = await ventas.listar(filtros.organizacion, { pagina: filtros.pagina });
  } catch (error) {
    if (error instanceof AutorizacionError && error.code === "NO_AUTENTICADO") redirect("/auth/login");
    if (!(error instanceof AutorizacionError || error instanceof z.ZodError)) throw error;
    return <main className="p-6"><h1 className="text-2xl font-semibold">Acceso restringido o filtros inválidos</h1><Link href="/dashboard" className="underline">Volver al dashboard</Link></main>;
  }
  const org = data.context.organizacion.id;
  const catalogo = await ventas.buscarProductos(org, {});
  return <main className="mx-auto grid max-w-5xl gap-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><Link href={`/dashboard?organizacion=${org}`} className="font-semibold">Stock y ventas / Dashboard</Link><LogoutButton /></header>
    <div><p className="text-muted-foreground">{data.context.organizacion.nombre}</p><h1 className="text-3xl font-semibold">Ventas</h1><p className="text-sm text-muted-foreground">Empleado: {data.context.user.email ?? data.context.user.id} · {data.context.membership.rol}</p></div>
    <FormularioVenta org={org} clave={randomUUID()} iniciales={catalogo.productos} hayMasInicial={catalogo.hayMas} />
    <section className="grid gap-3"><h2 className="text-2xl font-semibold">Historial de ventas</h2><p>{data.total} ventas · Página {data.pagina} de {data.paginas}</p>
      {data.ventas.map(v => <article key={v.id} className="grid gap-2 rounded-xl border p-4 sm:grid-cols-2"><Link href={`/ventas/${v.id}?organizacion=${org}`} className="break-all font-medium underline">Venta {v.id}</Link><p>{v.estado} · Total: {v.total.toFixed(2)}</p><p className="text-sm">{v.creadaEn.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</p><p className="break-all text-sm">Empleado: {v.creadaPor}</p></article>)}
      {!data.ventas.length ? <p>Todavía no hay ventas registradas.</p> : null}
      <nav aria-label="Paginación de ventas" className="flex justify-between">{data.pagina > 1 ? <Link className="underline" href={`/ventas?organizacion=${org}&pagina=${data.pagina-1}`}>Anterior</Link> : <span />}{data.pagina < data.paginas ? <Link className="underline" href={`/ventas?organizacion=${org}&pagina=${data.pagina+1}`}>Siguiente</Link> : null}</nav>
    </section>
  </main>;
}
export default function VentasPage(props: Props) { return <Suspense fallback={<p className="p-6">Cargando ventas…</p>}><Contenido {...props} /></Suspense>; }
