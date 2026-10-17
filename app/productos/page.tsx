import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { productos } from "@/lib/productos/server";
import { AutorizacionError, permiteOperacion } from "@/lib/auth/policy";
import { estadoPerfilDeUsuario } from "@/lib/auth/server";
import { formatearImporte } from "@/lib/importes";
import { FormularioProducto, EstadoProducto } from "@/components/productos/formulario";
import { NavPrincipal } from "@/components/nav-principal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
async function Contenido({ searchParams }: Props) {
  const params = await searchParams;
  if (["organizacion", "buscar", "estado", "pagina"].some(k => Array.isArray(params[k]))) notFound();
  let result;
  try {
    result = await productos.listar(params.organizacion as string | undefined, {
      buscar: params.buscar, estado: params.estado, pagina: params.pagina,
    });
  } catch (error) {
    if (error instanceof AutorizacionError && error.code === "NO_AUTENTICADO") redirect("/auth/login");
    if (error instanceof AutorizacionError || error instanceof z.ZodError) {
      return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-semibold">Acceso restringido o filtros inválidos</h1><p className="my-4">Revisá tu membresía y los filtros de búsqueda.</p><Link href="/dashboard" className="underline">Volver al dashboard</Link></main>;
    }
    throw error;
  }
  const { context, productos: rows, total, paginas, filtros } = result;
  const org = context.organizacion.id;
  const perfilIncompleto = (await estadoPerfilDeUsuario(context.user.id)) === "INCOMPLETO";
  const editar = permiteOperacion(context.membership.rol, "ADMINISTRAR_PRODUCTOS");
  const enlace = (pagina: number) => `/productos?${new URLSearchParams({ organizacion: org, buscar: filtros.buscar, estado: filtros.estado, pagina: String(pagina) })}`;
  return <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-8">
    <NavPrincipal org={org} actual="/productos" perfilIncompleto={perfilIncompleto} />
    <div><p className="text-sm text-muted-foreground">{context.organizacion.nombre}</p><h1 className="text-3xl font-semibold">Productos</h1><p className="mt-2 text-muted-foreground">{editar ? "Administrá el catálogo de tu organización." : "Consulta del catálogo. Tu rol no permite modificaciones."}</p></div>
    {editar ? <details className="rounded-xl border bg-card p-5"><summary className="min-h-[44px] cursor-pointer font-semibold sm:min-h-0">Crear producto</summary><div className="mt-5"><FormularioProducto org={org} /></div></details> : null}
    <form className="grid items-end gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto_auto]" action="/productos">
      <input type="hidden" name="organizacion" value={org} />
      <div><Label htmlFor="buscar">Buscar por nombre o SKU</Label><Input id="buscar" name="buscar" defaultValue={filtros.buscar} maxLength={100} /></div>
      <div><Label htmlFor="estado">Estado</Label><select id="estado" name="estado" defaultValue={filtros.estado} className="flex h-11 w-full rounded-md border bg-background px-3 text-base sm:h-9 sm:text-sm"><option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos</option></select></div>
      <Button type="submit">Buscar</Button>
    </form>
    <p className="text-sm text-muted-foreground">{total} productos · Página {filtros.pagina} de {paginas}</p>
    <section aria-label="Listado de productos" className="grid gap-4">
      {!rows.length ? <p className="rounded-xl border p-6">No hay productos para estos filtros.</p> : null}
      {rows.map(p => {
        const producto = { id: p.id, nombre: p.nombre, sku: p.sku, unidad: p.unidad, precioVenta: p.precioVenta.toFixed(2), stockMinimo: p.stockMinimo.toFixed(3), activo: p.activo };
        return <article key={p.id} className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold break-words">{p.nombre}</h2><p className="text-sm text-muted-foreground break-all">SKU: {p.sku}</p></div><Badge variant={p.activo ? "default" : "secondary"}>{p.activo ? "Activo" : "Inactivo"}</Badge></div>
          <dl className="my-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Unidad</dt><dd>{p.unidad}</dd></div><div><dt className="text-muted-foreground">Precio de venta</dt><dd className="tabular-nums">{formatearImporte(producto.precioVenta)}</dd></div><div><dt className="text-muted-foreground">Stock mínimo</dt><dd className="tabular-nums">{producto.stockMinimo}</dd></div></dl>
          {editar ? <div className="grid gap-4"><details><summary className="min-h-[44px] cursor-pointer font-medium underline sm:min-h-0">Editar producto</summary><div className="mt-4"><FormularioProducto org={org} producto={producto} /></div></details><EstadoProducto org={org} producto={producto} /></div> : null}
        </article>;
      })}
    </section>
    <nav aria-label="Paginación" className="flex justify-between gap-4">{filtros.pagina > 1 ? <Button variant="outline" asChild><Link href={enlace(filtros.pagina - 1)}>Anterior</Link></Button> : <span />}{filtros.pagina < paginas ? <Button variant="outline" asChild><Link href={enlace(filtros.pagina + 1)}>Siguiente</Link></Button> : null}</nav>
  </main>;
}
export default function ProductosPage(props: Props) {
  return <Suspense fallback={<p className="p-6">Cargando productos…</p>}><Contenido {...props} /></Suspense>;
}
