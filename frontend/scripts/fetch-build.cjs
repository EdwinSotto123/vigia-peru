/**
 * Sólo en el build del CI (.gitlab-ci.yml → NODE_OPTIONS="--require …/fetch-build.cjs"). La API sólo atiende a nuestros
 * Workers (backend/api/src/lib/antibots.ts → cerradaAlPublico), y `next build` prerenderiza páginas pidiéndole datos desde
 * el runner de GitLab: sin esto la portada, /app y las demás estáticas saldrían vacías hasta revalidarse.
 *
 * Con VIGIA_BUILD_TOKEN (variable enmascarada del CI), los pedidos a VIGIA_API_URL llevan `x-vigia-build` y la API los deja
 * leer; nada más (no abre el panel ni escrituras). Sin la variable no hace nada. Se carga antes que Next, que después
 * envuelve este fetch con el suyo (caché de datos), así que vale también en los procesos que prerenderizan.
 */
const token = process.env.VIGIA_BUILD_TOKEN;
const api = process.env.VIGIA_API_URL;

if (token && api && typeof globalThis.fetch === "function") {
  const original = globalThis.fetch;
  const host = new URL(api).host;
  globalThis.fetch = function fetchDelBuild(input, init) {
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    } catch {
      return original(input, init);
    }
    if (url.host !== host) return original(input, init);
    const headers = new Headers(init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
    headers.set("x-vigia-build", token);
    return original(input, { ...init, headers });
  };
}
