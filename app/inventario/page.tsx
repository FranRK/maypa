import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { inventario } from "@/lib/inventario/server";
import { InventarioError, decimalStock, milesimas } from "@/lib/inventario/service";
import { AutorizacionError, permiteOperacion } from "@/lib/auth/policy";
import { estadoPerfilDeUsuario } from "@/lib/auth/server";
import { ETIQUETAS_TIPO_MOVIMIENTO } from "@/lib/etiquetas";
import { formatearFechaHora } from "@/lib/fechas";
import { FormularioMovimiento } from "@/components/inventario/formulario";
import { NavPrincipal } from "@/components/nav-principal";
import { Autor } from "@/components/autor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
const tipos = ETIQUETAS_TIPO_MOVIMIENTO;
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
async function Contenido({ searchParams }: Props) {
  const params = await searchParams;
  const keys = ["buscar", "estado", "stock", "pagina", "historialPagina", "producto", "tipo"];
  if ([...keys, "organizacion"].some(k => Array.isArray(params[k]))) notFound();
  let data;
  try { data = await inventario.listar(params.organizacion as string | undefined, Object.fromEntries(keys.map(k => [k, params[k]]))); }
  catch (error) {
    if (error instanceof AutorizacionError && error.code === "NO_AUTENTICADO") redirect("/auth/login");
    if (error instanceof AutorizacionError || error instanceof z.ZodError || error instanceof InventarioError) return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-semibold">Acceso restringido o filtros inválidos</h1><p className="my-4">Revisá la membresía y el producto solicitado.</p><Link href="/dashboard" className="underline">Volver al dashboard</Link></main>;
    throw error;
  }
  const { context, filtros } = data;
  const org = context.organizacion.id;
  const perfilIncompleto = (await estadoPerfilDeUsuario(context.user.id)) === "INCOMPLETO";
  const sesion = { id: context.user.id, email: context.user.email };
  const editar = permiteOperacion(context.membership.rol, "ADMINISTRAR_INVENTARIO");
  const href = (changes: Record<string, string>) => `/inventario?${new URLSearchParams({ organizacion: org, buscar: filtros.buscar, estado: filtros.estado, stock: filtros.stock, pagina: String(filtros.pagina), historialPagina: String(filtros.historialPagina), tipo: filtros.tipo, ...(filtros.producto ? { producto: filtros.producto } : {}), ...changes })}`;
  return <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-8">
    <NavPrincipal org={org} actual="/inventario" perfilIncompleto={perfilIncompleto} />
    <div><p className="text-sm text-muted-foreground">{context.organizacion.nombre}</p><h1 className="text-3xl font-semibold">Inventario</h1><p className="mt-2 text-muted-foreground">Existencias e historial de movimientos. Stock bajo: cantidad menor al mínimo del producto.</p></div>
    {!data.escrituraDisponible ? <p role="status" className="rounded-xl border p-4">La consulta está disponible. Falta aplicar la migración de idempotencia para registrar movimientos.</p> : null}
    <form action="/inventario" className="grid items-end gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="organizacion" value={org} />
      <div><Label htmlFor="buscar">Nombre o SKU</Label><Input id="buscar" name="buscar" defaultValue={filtros.buscar} maxLength={100} /></div>
      <div><Label htmlFor="estado">Productos</Label><select id="estado" name="estado" defaultValue={filtros.estado} className="h-11 w-full rounded-md border bg-background px-3 text-base sm:h-9 sm:text-sm"><option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos</option></select></div>
      <div><Label htmlFor="stock">Stock</Label><select id="stock" name="stock" defaultValue={filtros.stock} className="h-11 w-full rounded-md border bg-background px-3 text-base sm:h-9 sm:text-sm"><option value="todos">Todos</option><option value="bajo">Stock bajo</option><option value="sin_stock">Sin stock</option></select></div>
      <Button>Buscar</Button>
    </form>
    <p className="text-sm text-muted-foreground">{data.total} productos · Página {filtros.pagina} de {data.paginas}</p>
    <section aria-label="Existencias" className="grid gap-4">
      {!data.productos.length ? <p className="rounded-xl border p-5">No hay productos para estos filtros.</p> : null}
      {data.productos.map(p => <article key={p.id} className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap justify-between gap-3"><div><h2 className="break-words text-xl font-semibold">{p.nombre}</h2><p className="break-all text-sm text-muted-foreground">SKU: {p.sku}</p></div><div className="flex gap-2">{p.bajo ? <Badge variant="destructive">Stock bajo</Badge> : null}{!p.activo ? <Badge variant="secondary">Inactivo</Badge> : null}</div></div>
        <dl className="my-4 grid grid-cols-2 gap-3"><div><dt className="text-sm text-muted-foreground">Stock actual ({p.unidad})</dt><dd className="text-2xl font-semibold">{decimalStock(milesimas(p.cantidad.toString()))}</dd></div><div><dt className="text-sm text-muted-foreground">Stock mínimo</dt><dd>{decimalStock(milesimas(p.stockMinimo.toString()))}</dd></div></dl>
        <Link href={href({ producto: p.id, historialPagina: "1" }) + "#historial"} className="inline-flex h-11 items-center text-sm underline sm:h-9">Ver historial de este producto</Link>
        {editar && p.activo && data.escrituraDisponible ? <details className="mt-4 border-t pt-4"><summary className="min-h-[44px] cursor-pointer font-semibold sm:min-h-0">Registrar movimiento</summary><div className="mt-4"><FormularioMovimiento org={org} productoId={p.id} clave={randomUUID()} /></div></details> : null}
      </article>)}
    </section>
    <nav aria-label="Paginación de existencias" className="flex justify-between">{filtros.pagina > 1 ? <Link href={href({ pagina: String(filtros.pagina - 1) })} className="inline-flex h-11 items-center underline sm:h-9">Anterior</Link> : <span />}{filtros.pagina < data.paginas ? <Link href={href({ pagina: String(filtros.pagina + 1) })} className="inline-flex h-11 items-center underline sm:h-9">Siguiente</Link> : null}</nav>
    <section id="historial" className="grid gap-4 border-t pt-6">
      <h2 className="text-2xl font-semibold">Historial de movimientos</h2>
      <form action="/inventario" className="flex flex-wrap items-end gap-3"><input type="hidden" name="organizacion" value={org} /><input type="hidden" name="estado" value={filtros.estado} /><input type="hidden" name="stock" value={filtros.stock} /><input type="hidden" name="buscar" value={filtros.buscar} />{filtros.producto ? <input type="hidden" name="producto" value={filtros.producto} /> : null}<div><Label htmlFor="tipo-historial">Tipo de movimiento</Label><select id="tipo-historial" name="tipo" defaultValue={filtros.tipo} className="h-11 w-full rounded-md border bg-background px-3 text-base sm:h-9 sm:text-sm"><option value="todos">Todos</option>{Object.entries(tipos).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div><Button variant="outline">Filtrar historial</Button>{filtros.producto ? <Link href={`/inventario?organizacion=${org}#historial`} className="inline-flex h-11 items-center text-sm underline sm:h-9">Ver todos los productos</Link> : null}</form>
      <p className="text-sm text-muted-foreground">{data.historialTotal} movimientos · Página {filtros.historialPagina} de {data.historialPaginas}</p>
      {!data.historial.length ? <p>No hay movimientos para estos filtros.</p> : null}
      {data.historial.map(m => <article key={m.id} className="grid gap-2 rounded-xl border p-4 sm:grid-cols-2"><div><h3 className="break-words font-semibold">{m.producto.nombre} · {m.producto.sku}</h3><p className="text-sm">{tipos[m.tipo]} · {m.variacion.toFixed(3)} {m.producto.unidad}</p></div><div className="text-sm"><p>{formatearFechaHora(m.creadoEn)}</p><p className="text-muted-foreground">Autor: <Autor usuarioId={m.usuarioId} perfil={m.autor.perfil} sesion={sesion} /></p></div>{m.nota ? <p className="break-words text-sm sm:col-span-2">Motivo: {m.nota}</p> : null}</article>)}
      <nav aria-label="Paginación del historial" className="flex justify-between">{filtros.historialPagina > 1 ? <Link href={href({ historialPagina: String(filtros.historialPagina - 1) }) + "#historial"} className="inline-flex h-11 items-center underline sm:h-9">Anterior</Link> : <span />}{filtros.historialPagina < data.historialPaginas ? <Link href={href({ historialPagina: String(filtros.historialPagina + 1) }) + "#historial"} className="inline-flex h-11 items-center underline sm:h-9">Siguiente</Link> : null}</nav>
    </section>
  </main>;
}
export default function InventarioPage(props: Props) { return <Suspense fallback={<p className="p-6">Cargando inventario…</p>}><Contenido {...props} /></Suspense>; }
