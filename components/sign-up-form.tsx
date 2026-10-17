"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { completarPerfilDeRegistro } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    // El nombre y el apellido son obligatorios y no pueden ser solo espacios, igual
    // que en public."Perfil" (columnas NOT NULL con CHECK '[^[:space:]]').
    // `trim` también recorta el espacio duro U+00A0, que la base rechaza.
    const nombreLimpio = nombre.trim();
    const apellidoLimpio = apellido.trim();
    if (!nombreLimpio || !apellidoLimpio) {
      setError("Nombre y apellido son obligatorios");
      setIsLoading(false);
      return;
    }

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
          // Quedan en auth.users.raw_user_meta_data. Es el único lugar donde el
          // registro los puede guardar: public."Perfil" no es escribible desde el
          // cliente. Inmediatamente después del alta, la Server Action
          // `completarPerfilDeRegistro` los escribe en "nombre" y "apellido", y si el
          // alta queda pendiente de confirmar por correo los escribe /auth/confirm.
          data: { nombre: nombreLimpio, apellido: apellidoLimpio },
        },
      });
      if (error) throw error;
      if (!data.session) {
        router.replace("/auth/sign-up-success");
        router.refresh();
        return;
      }
      // Etapa 10: la identidad la resuelve la Server Action desde la sesión recién
      // creada; este formulario solo declara los nombres.
      try {
        const { estado } = await completarPerfilDeRegistro();
        router.replace(estado === "COMPLETO" ? "/dashboard" : "/perfil/completar");
      } catch (errorSinGuardar) {
        // La cuenta y la sesión ya existen: no se perdió nada. Los nombres siguen en la
        // metadata y /perfil/completar los precarga, avisando que hay que guardarlos.
        console.error("No se pudo guardar el perfil durante el registro", errorSinGuardar);
        router.replace("/perfil/completar?aviso=1");
      }
      router.refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>Create a new account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input
                    id="nombre"
                    name="nombre"
                    autoComplete="given-name"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="apellido">Apellido</Label>
                  <Input
                    id="apellido"
                    name="apellido"
                    autoComplete="family-name"
                    required
                    value={apellido}
                    onChange={(e) => setApellido(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Repeat Password</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating an account..." : "Sign up"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <Link href="/auth/login" className="underline underline-offset-4">
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
