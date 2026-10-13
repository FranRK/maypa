"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const logout = async () => {
    const supabase = createClient();
    setPending(true);
    setFailed(false);
    const { error } = await supabase.auth.signOut({ scope: "local" });
    setPending(false);
    if (error) { setFailed(true); return; }
    router.replace("/auth/login");
    router.refresh();
  };

  return <div><Button onClick={logout} disabled={pending}>{pending ? "Cerrando sesión…" : "Cerrar sesión"}</Button>{failed && <p role="alert">No se pudo cerrar la sesión. Reintentá.</p>}</div>;
}
