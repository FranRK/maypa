import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { perfilDeSesion } from "@/lib/auth/server";
import { FormularioPerfil } from "@/components/perfil/formulario";
import { LogoutButton } from "@/components/logout-button";

type Props = { searchParams: Promise<{ aviso?: string | string[] }> };

// Etapa 10: pantalla para cargar el nombre y el apellido. La identidad sale de la
// sesion verificada; el formulario no envia ningun id.
async function Contenido({ searchParams }: Props) {
  const params = await searchParams;
  const perfil = await perfilDeSesion();
  if (!perfil) redirect("/auth/login");
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Mis datos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {perfil.estado === "COMPLETO"
            ? "Ya cargaste tu nombre y tu apellido. Podés actualizarlos."
            : "Necesitamos tu nombre y tu apellido: sin ellos no se pueden registrar ventas ni administrar productos, inventario u organización."}
        </p>
      </div>
      {params.aviso ? <p role="status" className="rounded-md border p-3 text-sm">No pudimos guardar tus datos automáticamente al crear la cuenta. Revisalos y guardá de nuevo.</p> : null}
      {perfil.email ? <p className="break-all text-sm text-muted-foreground">Cuenta: {perfil.email}</p> : null}
      <FormularioPerfil inicial={perfil.inicial} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="inline-flex h-11 items-center text-sm underline underline-offset-4">Volver al panel</Link>
        <LogoutButton />
      </div>
    </main>
  );
}

export default function CompletarPerfilPage(props: Props) {
  return <Suspense fallback={
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
      <p role="status" className="text-muted-foreground">Cargando tus datos…</p>
    </main>
  }><Contenido {...props} /></Suspense>;
}
