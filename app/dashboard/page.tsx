import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { exigirOrganizacion } from "@/lib/auth/server";
import { AutorizacionError } from "@/lib/auth/policy";
import { LogoutButton } from "@/components/logout-button";

type Props = { searchParams: Promise<{ organizacion?: string | string[] }> };

async function DashboardContent({ searchParams }: Props) {
  const params = await searchParams;
  if (Array.isArray(params.organizacion)) notFound();
  let context;
  try {
    context = await exigirOrganizacion(params.organizacion);
  } catch (error) {
    if (!(error instanceof AutorizacionError)) throw error;
    if (error.code === "NO_AUTENTICADO") redirect("/auth/login");
    if (error.code === "ACCESO_DENEGADO") notFound();
    return (
      <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Acceso restringido</h1>
        <p>Tu cuenta no tiene una membresía activa para acceder al panel.</p>
        <div><LogoutButton /></div>
      </main>
    );
  }
  const { user, membership, organizacion } = context;
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 p-6 md:py-16">
      <header className="flex items-center justify-between gap-4 border-b pb-6">
        <Link href="/dashboard" className="text-lg font-semibold">Stock y ventas</Link>
        <LogoutButton />
      </header>
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">Organización activa</p>
        <h1 className="mt-1 text-3xl font-semibold">{organizacion.nombre}</h1>
        <dl className="mt-6 grid gap-4 text-sm">
          <div><dt className="text-muted-foreground">Usuario</dt><dd>{user.email ?? user.id}</dd></div>
          <div><dt className="text-muted-foreground">Rol</dt><dd>{membership.rol}</dd></div>
        </dl>
        <Link href={`/productos?organizacion=${organizacion.id}`} className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Administrar productos</Link>
        <Link href={`/inventario?organizacion=${organizacion.id}`} className="ml-3 mt-3 inline-block rounded-md border px-4 py-2 text-sm font-medium">Ver inventario</Link>
      </section>
    </main>
  );
}

export default function DashboardPage(props: Props) {
  return <Suspense fallback={<p className="p-6">Cargando tu organización…</p>}><DashboardContent {...props} /></Suspense>;
}
