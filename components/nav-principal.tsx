import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

const SECCIONES = [
  { href: "/dashboard", etiqueta: "Dashboard" },
  { href: "/productos", etiqueta: "Productos" },
  { href: "/inventario", etiqueta: "Inventario" },
  { href: "/ventas", etiqueta: "Ventas" },
] as const;

// Navegación común a todas las pantallas privadas. Cada enlace conserva la
// organización autorizada recibida del servidor y se apila cuando no entra.
// Etapa 10: `perfilIncompleto` agrega el aviso con el enlace directo para cargar el
// nombre y el apellido, sin el cual no se autorizan las operaciones comerciales.
export function NavPrincipal({ org, actual, perfilIncompleto }: { org: string; actual: string; perfilIncompleto?: boolean }) {
  return (
    <header className="grid gap-2 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/dashboard?organizacion=${org}`} className="inline-flex h-11 items-center text-lg font-semibold">
          Stock y ventas
        </Link>
        <LogoutButton />
      </div>
      <nav aria-label="Secciones" className="flex flex-wrap items-center gap-1">
        {SECCIONES.map(seccion => {
          const activa = seccion.href === actual;
          return (
            <Link key={seccion.href} href={`${seccion.href}?organizacion=${org}`}
              aria-current={activa ? "page" : undefined}
              className={`inline-flex h-11 items-center rounded-md px-3 text-sm font-medium ${activa
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
              {seccion.etiqueta}
            </Link>
          );
        })}
      </nav>
      {perfilIncompleto ? (
        <p role="status" className="rounded-md border p-3 text-sm">
          Tu perfil no tiene nombre ni apellido cargados, así que no se pueden registrar ventas ni administrar productos, inventario u organización.{" "}
          <Link href="/perfil/completar" className="font-medium underline underline-offset-4">Completar mi perfil</Link>
        </p>
      ) : null}
    </header>
  );
}
