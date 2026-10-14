"use client";
import { useActionState, useState } from "react";
import { registrarMovimiento, type EstadoMovimiento } from "@/app/inventario/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { org: string; productoId: string; clave: string };
function Movimiento({ org, productoId, clave, nuevo }: Props & { nuevo: () => void }) {
  const [state, action, pending] = useActionState(registrarMovimiento.bind(null, org), {} as EstadoMovimiento);
  const [tipo, setTipo] = useState("COMPRA");
  const prefijo = `${productoId}-${clave}`;
  const error = (campo: string) => state.errores?.[campo] ? <p id={`${prefijo}-${campo}-error`} className="mt-1 text-sm text-destructive">{state.errores[campo].join(" ")}</p> : null;
  return <form action={action} className="grid gap-4 sm:grid-cols-2">
    <input type="hidden" name="productoId" value={productoId} /><input type="hidden" name="claveIdempotencia" value={clave} />
    <fieldset disabled={pending || state.ok} className="contents">
      <div><Label htmlFor={`${prefijo}-tipo`}>Tipo</Label><select id={`${prefijo}-tipo`} name="tipo" value={tipo} onChange={e => setTipo(e.target.value)} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="COMPRA">Ingreso de mercadería</option><option value="INICIAL">Stock inicial</option><option value="AJUSTE">Ajuste</option></select>{error("tipo")}</div>
      <div><Label htmlFor={`${prefijo}-cantidad`}>Cantidad {tipo === "AJUSTE" ? "(+ o −)" : "positiva"}</Label><Input id={`${prefijo}-cantidad`} name="cantidad" type="number" step="0.001" min={tipo === "AJUSTE" ? undefined : "0.001"} required aria-invalid={Boolean(state.errores?.cantidad)} aria-describedby={`${prefijo}-cantidad-error`} />{error("cantidad")}</div>
      <div className="sm:col-span-2"><Label htmlFor={`${prefijo}-nota`}>Motivo {tipo === "AJUSTE" ? "(obligatorio)" : "(opcional)"}</Label><Input id={`${prefijo}-nota`} name="nota" maxLength={500} required={tipo === "AJUSTE"} aria-invalid={Boolean(state.errores?.nota)} aria-describedby={`${prefijo}-nota-error`} />{error("nota")}</div>
      <div className="sm:col-span-2"><Button disabled={pending || state.ok}>{pending ? "Registrando…" : "Registrar movimiento"}</Button></div>
    </fieldset>
    <div className="sm:col-span-2">
      {state.mensaje ? <p role="status" className={state.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>{state.mensaje}</p> : null}
      {state.ok ? <Button type="button" variant="outline" onClick={nuevo} className="mt-3">Nuevo movimiento</Button> : null}
      <p className="mt-2 text-xs text-muted-foreground">Los reintentos conservan la clave de esta operación. Para registrar otra, usá «Nuevo movimiento» después de confirmar la anterior.</p>
    </div>
  </form>;
}
export function FormularioMovimiento(props: Props) {
  const [clave, setClave] = useState(props.clave);
  return <Movimiento key={clave} {...props} clave={clave} nuevo={() => setClave(crypto.randomUUID())} />;
}
