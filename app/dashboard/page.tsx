import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { dashboard } from "@/lib/dashboard/server";
import { AutorizacionError } from "@/lib/auth/policy";
import { estadoPerfilDeUsuario } from "@/lib/auth/server";
import { ETIQUETAS_ESTADO_VENTA, ETIQUETAS_ROL, ETIQUETAS_TIPO_MOVIMIENTO } from "@/lib/etiquetas";
import { formatearFechaHora } from "@/lib/fechas";
import { formatearImporte } from "@/lib/importes";
import { NavPrincipal } from "@/components/nav-principal";
import { Tarjeta } from "@/components/dashboard/tarjeta";
import { Autor } from "@/components/autor";
import { LogoutButton } from "@/components/logout-button";

type Props = { searchParams: Promise<{ organizacion?: string | string[] }> };

async function Contenido({ searchParams }: Props) {
  const params = await searchParams;
  if (Array.isArray(params.organizacion)) notFound();
  let data;
  try {
    data = await dashboard.resumen(params.organizacion);
  } catch (error) {
    if (!(error instanceof AutorizacionError)) throw error;
    if (error.code === "NO_AUTENTICADO") redirect("/auth/login");
    if (error.code === "ACCESO_DENEGADO") notFound();
    return (
      <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Acceso restringido</h1>
        <p>Tu cuenta no tiene una membresía activa para acceder al panel.</p>
        <p>Si además te falta cargar tu nombre y apellido, podés hacerlo en <Link href="/perfil/completar" className="underline underline-offset-4">Mis datos</Link>.</p>
        <div><LogoutButton /></div>
      </main>
    );
  }
  const { context, ventasDelDia, stockBajo, ultimasVentas, movimientos } = data;
  const org = context.organizacion.id;
  const perfilIncompleto = (await estadoPerfilDeUsuario(context.user.id)) === "INCOMPLETO";
  const sesion = { id: context.user.id, email: context.user.email };
  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-4 md:p-8">
      <NavPrincipal org={org} actual="/dashboard" perfilIncompleto={perfilIncompleto} />
      <div>
        <p className="text-sm text-muted-foreground">{context.organizacion.nombre}</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">Panel</h1>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {context.user.email ? `${context.user.email} · ` : ""}{ETIQUETAS_ROL[context.membership.rol]}
        </p>
      </div>
      <section aria-label="Indicadores del día" className="grid gap-4 sm:grid-cols-3">
        <Tarjeta titulo="Ventas del día" valor={formatearImporte(ventasDelDia.total)}
          detalle="Importe bruto de las ventas confirmadas de hoy, en horario de Buenos Aires." />
        <Tarjeta titulo="Cantidad de ventas" valor={String(ventasDelDia.cantidad)}
          detalle="Ventas confirmadas hoy." enlace={{ href: `/ventas?organizacion=${org}`, texto: "Ver historial de ventas" }} />
        <Tarjeta titulo="Productos con stock bajo" valor={String(stockBajo)}
          detalle="Productos activos por debajo de su stock mínimo."
          enlace={{ href: `/inventario?organizacion=${org}&stock=bajo`, texto: "Ver productos con stock bajo" }} />
      </section>
      <section aria-label="Últimas ventas" className="grid gap-3">
        <h2 className="text-xl font-semibold">Últimas ventas</h2>
        {!ultimasVentas.length ? <p className="rounded-xl border p-4 text-muted-foreground">Todavía no hay ventas registradas.</p> : null}
        {ultimasVentas.map(v => (
          <article key={v.id} className="grid gap-1 rounded-xl border bg-card p-4">
            <Link href={`/ventas/${v.id}?organizacion=${org}`} className="inline-flex min-h-11 items-center font-medium underline md:min-h-0">
              Ver detalle de la venta
            </Link>
            <p className="text-sm tabular-nums">
              {ETIQUETAS_ESTADO_VENTA[v.estado]} · Total: {formatearImporte(v.total.toFixed(2))} · {formatearFechaHora(v.creadaEn)}
            </p>
            <p className="text-sm text-muted-foreground">Empleado: <Autor usuarioId={v.creadaPor} perfil={v.creador.perfil} sesion={sesion} /></p>
          </article>
        ))}
      </section>
      <section aria-label="Movimientos recientes de inventario" className="grid gap-3">
        <h2 className="text-xl font-semibold">Movimientos recientes</h2>
        {!movimientos.length ? <p className="rounded-xl border p-4 text-muted-foreground">Todavía no hay movimientos de inventario.</p> : null}
        {movimientos.map(m => (
          <article key={m.id} className="grid gap-1 rounded-xl border bg-card p-4">
            <Link href={`/inventario?organizacion=${org}&producto=${m.productoId}#historial`}
              className="inline-flex min-h-11 items-center break-words font-medium underline md:min-h-0">
              {m.producto.nombre} · {m.producto.sku}
            </Link>
            <p className="text-sm">
              {ETIQUETAS_TIPO_MOVIMIENTO[m.tipo]} · {m.variacion.lt(0) ? "" : "+"}{m.variacion.toFixed(3)} {m.producto.unidad} · {formatearFechaHora(m.creadoEn)}
            </p>
            <p className="text-sm text-muted-foreground">Autor: <Autor usuarioId={m.usuarioId} perfil={m.autor.perfil} sesion={sesion} /></p>
          </article>
        ))}
      </section>
    </main>
  );
}

export default function DashboardPage(props: Props) {
  return <Suspense fallback={
    <main className="mx-auto grid max-w-5xl gap-6 p-4 md:p-8">
      <p role="status" className="text-muted-foreground">Cargando el panel…</p>
    </main>
  }><Contenido {...props} /></Suspense>;
}
