"use client";
import { useActionState } from "react";
import { guardarProducto, cambiarEstadoProducto, type EstadoFormulario } from "@/app/productos/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ProductoFormulario = { id: string; sku: string; nombre: string; unidad: string; precioVenta: string; stockMinimo: string; activo: boolean };
const campos = [
  { key: "sku", label: "SKU", max: 100 },
  { key: "nombre", label: "Nombre", max: 200 },
  { key: "unidad", label: "Unidad de medida", max: 50 },
  { key: "precioVenta", label: "Precio de venta", step: "0.01" },
  { key: "stockMinimo", label: "Stock mínimo", step: "0.001" },
] as const;

export function FormularioProducto({ org, producto }: { org: string; producto?: ProductoFormulario }) {
  const [state, action, pending] = useActionState(guardarProducto.bind(null, org, producto?.id), {} as EstadoFormulario);
  const prefix = producto?.id ?? "nuevo";
  return <form action={action} className="grid gap-4 sm:grid-cols-2">
    {campos.map(c => {
      const error = state.errores?.[c.key];
      return <div key={c.key} className={c.key === "nombre" ? "sm:col-span-2" : ""}>
        <Label htmlFor={`${prefix}-${c.key}`}>{c.label}</Label>
        <Input id={`${prefix}-${c.key}`} name={c.key} required disabled={pending}
          type={"step" in c ? "number" : "text"} step={"step" in c ? c.step : undefined}
          min={"step" in c ? "0" : undefined} maxLength={"max" in c ? c.max : undefined}
          defaultValue={producto?.[c.key] ?? (c.key === "unidad" ? "unidad" : c.key === "stockMinimo" ? "0" : "")}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${prefix}-${c.key}-error` : undefined} />
        {error ? <p id={`${prefix}-${c.key}-error`} className="mt-1 text-sm text-destructive">{error.join(" ")}</p> : null}
      </div>;
    })}
    <div className="sm:col-span-2">
      <Button disabled={pending}>{pending ? "Guardando…" : producto ? "Guardar cambios" : "Crear producto"}</Button>
      {state.mensaje ? <p role="status" className={`mt-3 text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>{state.mensaje}</p> : null}
    </div>
  </form>;
}

export function EstadoProducto({ org, producto }: { org: string; producto: ProductoFormulario }) {
  const [state, action, pending] = useActionState(cambiarEstadoProducto.bind(null, org, producto.id, !producto.activo), {} as EstadoFormulario);
  return <form action={action} onSubmit={event => {
    if (producto.activo && !window.confirm(`¿Desactivar «${producto.nombre}»? El producto y su historial se conservarán.`)) event.preventDefault();
  }}>
    <Button variant="outline" disabled={pending}>{pending ? "Guardando…" : producto.activo ? "Desactivar" : "Reactivar"}</Button>
    {state.mensaje ? <p role="status" className={`mt-2 text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>{state.mensaje}</p> : null}
  </form>;
}
