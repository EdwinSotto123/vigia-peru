import type { Metadata } from "next";
import { canonica } from "@/lib/seo";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import { DirectorioGobiernos, type ContratosDeUnPartido, type IndicioDeUnPartido, type Vista } from "@/components/partidos/DirectorioGobiernos";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";
import { leerCobertura } from "@/components/landing/PartidosSeccion";
import { PERIODOS, claveOrg } from "@/lib/partidos";
import { listaY } from "@/lib/formato";
import { ANIO_GOBIERNO_VIGENTE, PERIODOS_GOBIERNO, anioDeUrl, getRankingPartidos } from "@/lib/partidosApi";
import { clavePartido, getPoderPartidos } from "@/lib/poder";

export const metadata: Metadata = {
  title: "Partidos y gobiernos",
  description:
    "Qué partido gobierna cada región, provincia y distrito del Perú, y qué contrataron sus gobiernos: procesos adjudicados desde 2015, montos y señales de riesgo.",
  alternates: canonica("/app/partidos"),
};

const VISTAS: Vista[] = ["gobiernos", "partidos", "mapa"];

/**
 * Partidos y gobiernos: el directorio completo de quién gobernó cada región, provincia y distrito (Elecciones
 * Regionales y Municipales 2014, 2018 y 2022, del JNE) y, en UNA tabla, todas las organizaciones del período con sus
 * gobiernos, los procesos y lo adjudicado bajo ellos y, en el período vigente, sus entidades con indicio (mapa de poder).
 * Antes eran dos vistas con la misma lista («Todos los partidos» y «Contratos por partido»): `?vista=contratos` abre
 * ahora la tabla ordenada por lo adjudicado. Cuenta quién ganó, no qué hizo cada gobierno;
 * los resultados de 2026 se suman cuando el JNE los proclame.
 *
 * La cabecera es la de toda página (`EncabezadoPagina`: h1, una oración y su ⓘ), sin rótulo encima ni las cajas de
 * cada elección: el período se elige una sola vez, en su selector (DirectorioGobiernos), y lo que falta cargar va en la ⓘ.
 *
 * El servidor solo prepara lo que necesita la vista pedida (el mapa y su cobertura solo cuando se abre "En el
 * mapa"; el mapa de poder, solo en la tabla de partidos del período vigente); el directorio lo arma el navegador con
 * el archivo público de autoridades del período. El mapa recibe el período de la página: antes tenía su propio
 * selector de elección debajo del de la página.
 */
/** El nombre de cada vista, como en sus pestañas (DirectorioGobiernos): el último paso de la ruta. */
const NOMBRE_VISTA: Record<Vista, string> = { gobiernos: "Quién gobierna", partidos: "Partidos", mapa: "En el mapa" };

export default async function PartidosPage({ searchParams }: { searchParams?: { anio?: string | string[]; vista?: string | string[] } }) {
  const anio = anioDeUrl(searchParams?.anio);
  const pedida = Array.isArray(searchParams?.vista) ? searchParams?.vista[0] : searchParams?.vista;
  // «Contratos por partido» y «Todos los partidos» son ahora la misma tabla (DirectorioGobiernos la ordena por lo
  // adjudicado cuando el enlace viejo dice `?vista=contratos`).
  const vista = (pedida === "contratos" ? "partidos" : (VISTAS.find((v) => v === pedida) ?? "gobiernos")) as Vista;
  const conIndicios = vista === "partidos" && anio === ANIO_GOBIERNO_VIGENTE;

  const [ranking, cobertura, poder] = await Promise.all([
    getRankingPartidos(anio, { orden: "monto" }),
    vista === "mapa" ? leerCobertura() : Promise.resolve(null),
    conIndicios ? getPoderPartidos() : Promise.resolve(null),
  ]);

  // Solo datos planos hacia el cliente: contratos asociados por partido (la clave es la misma de la ficha).
  const contratos: Record<string, ContratosDeUnPartido> | null = ranking
    ? Object.fromEntries(
        ranking.data.map((f) => [f.clave, { contratos: f.contratos, leidos: f.leidos, enCola: f.enCola, procesos: f.procesos, montoAdjudicadoPen: f.montoAdjudicadoPen }]),
      )
    : null;
  // Del mapa de poder, por la misma clave de la ficha (el JNE escribe los nombres en mayúsculas y sin tildes).
  const indicios: Record<string, IndicioDeUnPartido> | null = poder?.data?.length
    ? Object.fromEntries(
        poder.data.map((p) => [
          claveOrg(p.partido),
          { con: p.n_entidades_con_captura, de: p.n_entidades, contratos: p.n_captura, monto: p.monto_captura, ruta: `/app/poder/${clavePartido(p.partido)}` },
        ]),
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
        indicios={indicios}
        mapaNode={vista === "mapa" ? <PartidosExplorador cobertura={cobertura} anioPagina={anio} /> : null}
      />
    </Pagina>
  );
}
