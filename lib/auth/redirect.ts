export function destinoInterno(value: string | null, origin: string) {
  try {
    const url = new URL(value ?? "/dashboard", origin);
    return url.origin === origin ? url.pathname + url.search : "/dashboard";
  } catch {
    return "/dashboard";
  }
}
