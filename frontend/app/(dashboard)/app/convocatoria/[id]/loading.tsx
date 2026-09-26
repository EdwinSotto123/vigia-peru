import { Cargando, Pagina } from "@/components/patrones";

/**
 * Mientras el servidor arma el informe (page.tsx): la misma espera que tenía la página
 * cuando lo pedía el navegador, con la llamita (§10.5). Sólo bajo [id]: el listado de
 * análisis publicados tiene su propia espera.
 */
export default function CargandoInforme() {
  return (
    <Pagina>
      <Cargando texto="Cargando el análisis…" lineas={5} />
    </Pagina>
  );
}
