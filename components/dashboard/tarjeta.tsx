import Link from "next/link";

// Tarjeta de indicador. El valor se muestra grande y el enlace, cuando existe,
// conserva el área táctil mínima en celular.
export function Tarjeta({ titulo, valor, detalle, enlace }: {
  titulo: string;
  valor: string;
  detalle?: string;
  enlace?: { href: string; texto: string };
}) {
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-medium text-muted-foreground">{titulo}</h2>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{valor}</p>
      {detalle ? <p className="mt-1 text-sm text-muted-foreground">{detalle}</p> : null}
      {enlace ? (
        <p className="mt-2">
          <Link href={enlace.href} className="inline-flex h-11 items-center text-sm font-medium underline sm:h-9">
            {enlace.texto}
          </Link>
        </p>
      ) : null}
    </article>
  );
}
