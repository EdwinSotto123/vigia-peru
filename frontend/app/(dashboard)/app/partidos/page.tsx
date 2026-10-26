import type { Metadata } from "next";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import { ContratosPorPartido } from "@/components/partidos/ContratosPorPartido";
import { DirectorioGobiernos, type ContratosDeUnPartido, type Vista } from "@/components/partidos/DirectorioGobiernos";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";
import { leerCobertura } from "@/components/landing/PartidosSeccion";
import { PERIODOS } from "@/lib/partidos";
import { listaY } from "@/lib/formato";
import { PERIODOS_GOBIERNO, anioDeUrl, getRankingPartidos } from "@/lib/partidosApi";

export const metadata: Metadata = { title: "Partidos y gobiernos" };

const VISTAS: Vista[] = ["gobiernos", "partidos", "contratos", "mapa"];

/**
 * Partidos y gobiernos: el directorio completo de quién gobernó cada región, provincia y distrito (Elecciones
 * Regionales y Municipales 2014, 2018 y 2022, del JNE), todas las organizaciones del período y, aparte, los
 * contratos que se firmaron bajo los gobiernos de cada partido. Cuenta quién ganó, no qué hizo cada gobierno;
 * los resultados de 2026 se suman cuando el JNE los proclame.
 *
 * La cabecera es la de toda página (`EncabezadoPagina`: h1, una oración y su ⓘ), sin rótulo encima ni las cajas de
 * cada elección: el período se elige una sola vez, en su selector (DirectorioGobiernos), y lo que falta cargar va en la ⓘ.
 *
 * El servidor solo prepara lo que necesita la vista pedida (el mapa y su cobertura solo cuando se abre "En el
 * mapa"); el directorio lo arma el navegador con el archivo público de autoridades del período.
 */
/** El nombre de cada vista, como en sus pestañas (DirectorioGobiernos): el último paso de la ruta. */
const NOMBRE_VISTA: Record<Vista, string> = { gobiernos: "Quién gobierna", partidos: "Todos los partidos", contratos: "Contratos por partido", mapa: "En el mapa" };

export default async function PartidosPage({ searchParams }: { searchParams?: { anio?: string | string[]; vista?: string | string[] } }) {
  const anio = anioDeUrl(searchParams?.anio);
  const pedida = Array.isArray(searchParams?.vista) ? searchParams?.vista[0] : searchParams?.vista;
  const vista = (VISTAS.find((v) => v === pedida) ?? "gobiernos") as Vista;

  const [ranking, cobertura] = await Promise.all([getRankingPartidos(anio, { orden: "monto" }), vista === "mapa" ? leerCobertura() : Promise.resolve(null)]);

  // Solo datos planos hacia el cliente: contratos asociados por partido (la clave es la misma de la ficha).
  const contratos: Record<string, ContratosDeUnPartido> | null = ranking
    ? Object.fromEntries(
        ranking.data.map((f) => [f.clave, { contratos: f.contratos, leidos: f.leidos, enCola: f.enCola, procesos: f.procesos, montoAdjudicadoPen: f.montoAdjudicadoPen }]),
      )
    : null;
  const pendientes = PERIODOS.filter((p) => !p.cargado);

  return (
    <Pagina className="space-y-5">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Partidos y gobiernos", href: `/app/partidos?anio=${anio}` },
          { etiqueta: NOMBRE_VISTA[vista] },
        ]}
      />
      <EncabezadoPagina
        titulo="Partidos y gobiernos"
        bajada="Quién ganó cada región, provincia y distrito del país, y qué se contrató bajo los gobiernos de cada partido desde 2015."
        ayuda={
          <Ayuda titulo="¿De dónde sale esto?">
            <span className="block">
              De las Elecciones Regionales y Municipales de {listaY(PERIODOS.filter((p) => p.cargado).map((p) => String(p.anio)))}{" "}
              (JNE, Plataforma Electoral): quién ganó cada gobierno y con qué organización.
            </span>
            {pendientes.length > 0 && (
              <span className="mt-2 block">
                Los resultados de {listaY(pendientes.map((p) => String(p.anio)))} (mandato {listaY(pendientes.map((p) => p.mandato))}) se suman cuando el JNE
                los proclame.
              </span>
            )}
            <span className="mt-2 block text-mute">Los contratos, del OECE (CONOSCE) y del SEACE, por la entidad que gobernó cada partido.</span>
          </Ayuda>
        }
      />

      <DirectorioGobiernos
        anio={anio}
        periodos={PERIODOS.filter((p) => p.cargado).map((p) => ({ anio: p.anio, texto: PERIODOS_GOBIERNO.find((g) => g.anio === p.anio)?.texto ?? p.mandato }))}
        vista={vista}
        contratos={contratos}
        contratosNode={vista === "contratos" ? <ContratosPorPartido ranking={ranking} anio={anio} sinNavegacion /> : null}
        mapaNode={vista === "mapa" ? <PartidosExplorador cobertura={cobertura} /> : null}
      />
    </Pagina>
  );
}
