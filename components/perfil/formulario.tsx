"use client";
import { useActionState } from "react";
import { guardarPerfil, type EstadoPerfil } from "@/app/perfil/actions";
import { PERFIL_CAMPO_MAX } from "@/lib/auth/perfil-reglas";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Etapa 10: mismo formulario para completar el perfil la primera vez y para
// actualizarlo despues. Los valores precargados vienen del servidor.
export function FormularioPerfil({ inicial }: { inicial: { nombre: string; apellido: string } }) {
  const [state, action, pending] = useActionState(guardarPerfil, {} as EstadoPerfil);
  const error = (campo: "nombre" | "apellido") => state.errores?.[campo]
    ? <p id={`${campo}-error`} className="mt-1 text-sm text-destructive">{state.errores[campo].join(" ")}</p>
    : null;
  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="grid gap-4">
          <div>
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" name="nombre" autoComplete="given-name" required maxLength={PERFIL_CAMPO_MAX}
              defaultValue={inicial.nombre} aria-invalid={Boolean(state.errores?.nombre)}
              aria-describedby={state.errores?.nombre ? "nombre-error" : undefined} />
            {error("nombre")}
          </div>
          <div>
            <Label htmlFor="apellido">Apellido</Label>
            <Input id="apellido" name="apellido" autoComplete="family-name" required maxLength={PERFIL_CAMPO_MAX}
              defaultValue={inicial.apellido} aria-invalid={Boolean(state.errores?.apellido)}
              aria-describedby={state.errores?.apellido ? "apellido-error" : undefined} />
            {error("apellido")}
          </div>
          {state.mensaje ? <p role="status" className="text-sm text-destructive">{state.mensaje}</p> : null}
          <Button disabled={pending}>{pending ? "Guardando…" : "Guardar mis datos"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
