import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ventas } from "@/lib/ventas/server";
import { AutorizacionError } from "@/lib/auth/policy";
import { estadoPerfilDeUsuario } from "@/lib/auth/server";
import { ETIQUETAS_ESTADO_VENTA, ETIQUETAS_ROL } from "@/lib/etiquetas";
import { formatearFechaHora } from "@/lib/fechas";
import { formatearImporte } from "@/lib/importes";
import { FormularioVenta } from "@/components/ventas/formulario";
import { NavPrincipal } from "@/components/nav-principal";
import { Autor } from "@/components/autor";
import { lineaProducto } from "@/lib/ventas/historico";

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
    return <main className="p-6"><h1 className="text-2xl font-semibold">Acceso restringido o filtros inválidos</h1><Link href="/dashboard" className="inline-flex h-11 items-center underline">Volver al dashboard</Link></main>;
  }
  const org = data.context.organizacion.id;
  const perfilIncompleto = (await estadoPerfilDeUsuario(data.context.user.id)) === "INCOMPLETO";
  const sesion = { id: data.context.user.id, email: data.context.user.email };
  // El catalogo del formulario se pide con REGISTRAR_VENTAS, que exige el perfil
  // completo. Sin perfil no se arma el formulario: el aviso de arriba explica por que.
  const catalogo = perfilIncompleto ? { productos: [], hayMas: false } : await ventas.buscarProductos(org, {});
  return <main className="mx-auto grid max-w-5xl gap-6 p-4 md:p-8">
    <NavPrincipal org={org} actual="/ventas" perfilIncompleto={perfilIncompleto} />
    <div><p className="text-muted-foreground">{data.context.organizacion.nombre}</p><h1 className="text-3xl font-semibold">Ventas</h1><p className="mt-1 break-words text-sm text-muted-foreground">{data.context.user.email ? `${data.context.user.email} · ` : ""}{ETIQUETAS_ROL[data.context.membership.rol]}</p></div>
    {perfilIncompleto
      ? <p className="rounded-xl border p-5">Completá tu nombre y tu apellido para poder registrar ventas. El historial sigue disponible.</p>
      : <FormularioVenta org={org} clave={randomUUID()} iniciales={catalogo.productos} hayMasInicial={catalogo.hayMas} />}
    <section className="grid gap-3"><h2 className="text-2xl font-semibold">Historial de ventas</h2><p className="text-sm text-muted-foreground">{data.total} ventas · Página {data.pagina} de {data.paginas}</p>
      {data.ventas.map(v => {
        const lineas = v.detalles.map(d => ({ id: d.id, ...lineaProducto(d) }));
        return <article key={v.id} className="grid gap-1 rounded-xl border p-4">
          <Link href={`/ventas/${v.id}?organizacion=${org}`} className="inline-flex h-11 items-center font-medium underline sm:h-9">Venta del {formatearFechaHora(v.creadaEn)}</Link>
          <p className="tabular-nums">{ETIQUETAS_ESTADO_VENTA[v.estado]} · Total: {formatearImporte(v.total.toFixed(2))}</p>
          <ul className="grid gap-0.5 text-sm">{lineas.map(l => <li key={l.id} className="break-words">{l.nombre} · {l.sku}{!l.historico ? <span className="text-muted-foreground"> (datos actuales; pueden haber cambiado)</span> : null}</li>)}</ul>
          <p className="text-sm text-muted-foreground">Empleado: <Autor usuarioId={v.creadaPor} perfil={v.creador.perfil} sesion={sesion} /></p>
        </article>;
      })}
      {!data.ventas.length ? <p className="rounded-xl border p-4">Todavía no hay ventas registradas.</p> : null}
      <nav aria-label="Paginación de ventas" className="flex justify-between">{data.pagina > 1 ? <Link className="inline-flex h-11 items-center underline sm:h-9" href={`/ventas?organizacion=${org}&pagina=${data.pagina-1}`}>Anterior</Link> : <span />}{data.pagina < data.paginas ? <Link className="inline-flex h-11 items-center underline sm:h-9" href={`/ventas?organizacion=${org}&pagina=${data.pagina+1}`}>Siguiente</Link> : null}</nav>
    </section>
  </main>;
}
export default function VentasPage(props: Props) { return <Suspense fallback={<p className="p-6">Cargando ventas…</p>}><Contenido {...props} /></Suspense>; }
