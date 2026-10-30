// gobserva.cloud (y www) → https://vigia.gobserva.cloud, con la misma ruta y consulta (301). Vigía es un producto de
// Gobserva; mientras el dominio no tenga su propia portada, la raíz lleva a Vigía (pedido del usuario, 2026-10-29).
// Despliegue y DNS: README.md de esta carpeta.
const DESTINO = "https://vigia.gobserva.cloud";

export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(`${DESTINO}${url.pathname}${url.search}`, 301);
  },
};
