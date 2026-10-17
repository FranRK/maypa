import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { destinoInterno } from "@/lib/auth/redirect";
import { completarPerfilDeUsuario } from "@/lib/auth/server";

// Etapa 10: al confirmar la cuenta se escriben en public."Perfil" los nombres que la
// persona declaro al registrarse (metadata de Auth), pero solo si el perfil todavia
// esta incompleto. Si esa escritura falla, la confirmacion no se pierde: la sesion ya
// quedo abierta y /perfil/completar los pide con el aviso correspondiente.
async function perfilListo(usuario: { id: string; user_metadata?: unknown } | null | undefined) {
  try {
    return (await completarPerfilDeUsuario(usuario)) === "COMPLETO";
  } catch (error) {
    console.error("No se pudo guardar el perfil al confirmar la cuenta", error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = destinoInterno(searchParams.get("next"), request.nextUrl.origin);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect((await perfilListo(data.user)) ? next : "/perfil/completar?aviso=1");
    }
    redirect("/auth/error?error=No%20se%20pudo%20confirmar%20la%20sesion");
  }

  if (token_hash && type) {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect((await perfilListo(data.user)) ? next : "/perfil/completar?aviso=1");
    } else {
      // redirect the user to an error page with some instructions
      redirect(`/auth/error?error=${error?.message}`);
    }
  }

  // redirect the user to an error page with some instructions
  redirect(`/auth/error?error=No token hash or type`);
}
