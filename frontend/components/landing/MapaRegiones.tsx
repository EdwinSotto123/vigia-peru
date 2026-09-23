import { geoMercator, geoPath } from "d3-geo";
import deptos from "@/public/peru-departments.json";
import { construirEscala } from "@/components/mapa/escala";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import type { ContratoZona } from "@/lib/contratos";
import { MapaRegionesEscena, type RegionMapa } from "./MapaRegionesEscena";

/**
 * El mapa de la portada: del país entero a la región de quien mira.
 *
 * Todo lo pesado se hace ACÁ, en el servidor: la proyección, los recorridos de
 * los 25 departamentos y los colores de cada paso. La escena del cliente recibe
 * strings y números y nada más, así que `d3-geo` no viaja al navegador y el mapa
 * se pinta con el primer HTML, sin esperar a ningún fetch.
 *
 * Es el ÚNICO mapa de la portada, a propósito: el usuario ya pidió no repetir
 * mapas. Cuenta tres cosas y deja una pregunta, y el mapa interactivo de verdad
 * sigue siendo `/app/mapa`.
 */

/** Tamaño del lienzo. Retrato, porque el Perú lo es. */
const ANCHO = 520;
const ALTO = 720;

const VERDE_LEIDO = "#BFE6C8";
const GRIS_SIN_LEER = "#E7EAEE";

const millones = (n: number) => Math.round(n / 1e6).toLocaleString("es-PE");

type Feature = { properties: { code: string; name: string } };

export function MapaRegiones({ zonas }: { zonas: ContratoZona[] }) {
  const porCodigo = new Map(zonas.map((z) => [z.ubigeo, z]));
  const coleccion = deptos as unknown as { features: Feature[] };
  const proyeccion = geoMercator().fitExtent(
    [
      [8, 8],
      [ANCHO - 8, ALTO - 8],
    ],
    coleccion as never,
  );
  const trazo = geoPath(proyeccion).digits(1);
  const escala = construirEscala(zonas.map((z) => z.montoPen ?? 0));

  const regiones: RegionMapa[] = coleccion.features
    .map((f) => {
      const z = porCodigo.get(f.properties.code);
      const [cx, cy] = trazo.centroid(f as never);
      return {
        codigo: f.properties.code,
        id: UBIGEO_REGION[f.properties.code] ?? "",
        // El nombre de la API trae las tildes ("Junín"); el del geojson no.
        nombre: z?.nombre ?? f.properties.name,
        d: trazo(f as never) ?? "",
        cx: Math.round(cx),
        cy: Math.round(cy),
        contratos: z?.total ?? 0,
        montoMillones: z ? millones(z.montoPen ?? 0) : "0",
        leidos: z?.procesados ?? 0,
        conSenales: z?.conSenales ?? 0,
        enCola: z?.enCola ?? 0,
        colorMonto: escala.color(z ? z.montoPen ?? 0 : null),
        colorLeido: z && z.procesados > 0 ? VERDE_LEIDO : GRIS_SIN_LEER,
      };
    })
    // De norte a sur: así el barrido del segundo paso baja por el mapa.
    .sort((a, b) => a.cy - b.cy);

  // Las frases de cada paso se arman con los datos, nunca a mano: si mañana
  // Cusco pasa a Lima en señales, la portada lo dice sola.
  const porMonto = [...zonas].sort((a, b) => (b.montoPen ?? 0) - (a.montoPen ?? 0));
  const mayor = porMonto[0];
  const menor = porMonto[porMonto.length - 1];
  const conLectura = zonas.filter((z) => z.procesados > 0).length;
  const leidosTotal = zonas.reduce((n, z) => n + z.procesados, 0);
  const conSenal = zonas.filter((z) => z.conSenales > 0);
  const masSenales = [...conSenal].sort((a, b) => b.conSenales - a.conSenales).slice(0, 3);
  const suma = (f: (z: ContratoZona) => number) => zonas.reduce((s, z) => s + f(z), 0);

  return (
    <MapaRegionesEscena
      ancho={ANCHO}
      alto={ALTO}
      regiones={regiones}
      pais={{
        nombre: "Todo el Perú",
        contratos: suma((z) => z.total),
        montoMillones: millones(suma((z) => z.montoPen ?? 0)),
        leidos: leidosTotal,
        conSenales: suma((z) => z.conSenales),
        enCola: suma((z) => z.enCola),
      }}
      resumen={{
        totalRegiones: zonas.length,
        mayor: mayor ? { nombre: mayor.nombre, millones: millones(mayor.montoPen ?? 0) } : null,
        menor: menor ? { nombre: menor.nombre, millones: millones(menor.montoPen ?? 0) } : null,
        conLectura,
        leidosTotal,
        conSenal: conSenal.length,
        masSenales: masSenales.map((z) => ({ nombre: z.nombre, n: z.conSenales })),
      }}
      coloresMonto={escala.colores}
      verdeLeido={VERDE_LEIDO}
      grisSinLeer={GRIS_SIN_LEER}
    />
  );
}
