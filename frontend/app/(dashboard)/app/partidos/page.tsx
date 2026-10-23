import { Migas } from "@/components/patrones";
import type { Metadata } from "next";
import { Pagina } from "@/components/patrones";
import { ContratosPorPartido } from "@/components/partidos/ContratosPorPartido";
import { DirectorioGobiernos, type ContratosDeUnPartido, type Vista } from "@/components/partidos/DirectorioGobiernos";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";
import { leerCobertura } from "@/components/landing/PartidosSeccion";
import { PERIODOS } from "@/lib/partidos";
import { PERIODOS_GOBIERNO, anioDeUrl, getRankingPartidos } from "@/lib/partidosApi";

export const metadata: Metadata = { title: "Partidos y gobiernos" };

const VISTAS: Vista[] = ["gobiernos", "partidos", "contratos", "mapa"];

/**
 * Partidos y gobiernos: el directorio completo de quién gobernó cada región, provincia y distrito (Elecciones
 * Regionales y Municipales 2014, 2018 y 2022, del JNE), todas las organizaciones del período y, aparte, los
 * contratos que se firmaron bajo los gobiernos de cada partido. Cuenta quién ganó, no qué hizo cada gobierno;
 * los resultados de 2026 se suman cuando el JNE los proclame.
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

  return (
    <Pagina className="space-y-5">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Partidos y gobiernos", href: `/app/partidos?anio=${anio}` },
          { etiqueta: NOMBRE_VISTA[vista] },
        ]}
      />
      {/* La cabecera de las demás páginas de Explorar (`encabezado-color`: filete y lavado del color de la sección). Antes
          tenía un degradado lima propio: otro color que el de su sección y texto bajo 4,5:1 en su parte más intensa. */}
      <header className="encabezado-color grid items-center gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="etiqueta-mono text-acento-texto">Quién gobernó el Perú</p>
          <h1 className="mt-1 font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">Partidos y gobiernos</h1>
          <p className="mt-1.5 max-w-3xl text-cuerpo leading-snug text-inkSoft">
            Quién ganó cada región, provincia y distrito del país en 2014, 2018 y 2022, y qué se contrató bajo los gobiernos de cada partido desde 2015.
          </p>
        </div>
        {/* Las elecciones y su mandato, de un vistazo: lo que hay cargado y lo que falta. */}
        <ul aria-label="Elecciones cargadas" className="grid grid-cols-2 gap-2 text-meta sm:grid-cols-4 lg:grid-cols-1">
          {PERIODOS.map((p) => (
            <li key={p.anio} className={"flex items-baseline justify-between gap-3 rounded-lg border px-3 py-1.5 " + (p.cargado ? "border-acento-borde bg-paper/70" : "border-line bg-paper/40 text-mute")}>
              <span className="font-mono font-semibold tabular-nums text-ink">{p.anio}</span>
              <span className="text-inkSoft">{p.cargado ? `mandato ${p.mandato}` : "resultados pendientes"}</span>
            </li>
          ))}
        </ul>
      </header>

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
