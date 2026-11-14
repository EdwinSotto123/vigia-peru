import type { Metadata } from "next";
import { canonica } from "@/lib/seo";
import { PixelReveal } from "@/components/ui/PixelReveal";
import { HeroPixel } from "@/components/landing/HeroPixel";
import { EscalaDinero } from "@/components/landing/EscalaDinero";
import { CasoLeido, type CasoConDetalle } from "@/components/landing/CasoLeido";
import { ComoFunciona } from "@/components/landing/ComoFunciona";
import { PartidosSeccion } from "@/components/landing/PartidosSeccion";
import { Participar } from "@/components/landing/Participar";
import { PausaFueraDePantalla } from "@/components/landing/PausaFueraDePantalla";
import { IndiceRecorrido } from "@/components/landing/Recorrido";
import { getAlertas } from "@/lib/api-client";
import { getEstadoGlobal, getRankingPaginado, getVigilancia } from "@/lib/financiamiento";
import { clasificar } from "@/components/aliados/ranking";
import { anioLectura, desdeLectura, getContratosGeo, getResumenContratos, TIPOS } from "@/lib/contratos";
import type { CifrasFlujo } from "@/components/landing/ExploradorFuentes";
import { contarLeidos, elegirCasos, esReglaDeProceso, type AlertaReal, type AnioEscala, type CasoPortada, type OtraSenal, type TipoEscala } from "@/lib/landing";
import { reglaLabel } from "@/lib/auditoria";
import { OG_BASE, TWITTER_BASE } from "@/lib/compartir";

// El metadata de una page gana sobre el de app/layout.tsx solo para esta ruta.
// Dice qué hace el producto por quien lo busca, no con qué está hecho.
const TITULO_PORTADA = "Vigía by Gobserva: en qué se gasta el dinero de tu región";
const DESCRIPCION_PORTADA =
  "Vigía lee los contratos del Estado peruano, los cruza con registros oficiales y te muestra cuáles merecen una segunda mirada, con la ley y la fuente para comprobarlo. Explora tu región, ayúdanos a seguir vigilando o denuncia una obra.";

export const metadata: Metadata = {
  title: { absolute: TITULO_PORTADA },
  description: DESCRIPCION_PORTADA,
  alternates: canonica("/"),
  // La portada es lo que más se comparte: título y descripción explícitos para la tarjeta.
  openGraph: { ...OG_BASE, type: "website", url: "/", title: TITULO_PORTADA, description: DESCRIPCION_PORTADA },
  twitter: { ...TWITTER_BASE, title: TITULO_PORTADA, description: DESCRIPCION_PORTADA },
};

/**
 * La portada cuenta una historia, en este orden (2026-11-13: de once bandas a seis; medía 15 pantallas en escritorio
 * y 24 en el celular, con bandas vacías, carruseles cortados en el borde y el mismo mensaje dicho dos y tres veces):
 *
 *  1. Qué es (HeroPixel): la pregunta, qué hace Vigía y cómo se sostiene, con el ojo de puntos al lado.
 *  2. El problema (EscalaDinero): miles de contratos, casi nada leído, como tablero: la franja de puntos, los tipos con
 *     su barra, las seis cifras a la vista y lo que cuesta no leerlos.
 *  3. La respuesta (PartidosSeccion): UN solo mapa con tres lecturas (quién gobierna, cuánto se contrata y qué tanto
 *     vigilamos) y la tabla de partidos. Es el único mapa de la portada.
 *  4. Lo que ya encontró (CasoLeido): casos reales como pestañas, y el elegido leído en cuatro pasos.
 *  5. Cómo trabaja (ComoFunciona), en pestañas: qué revisa, de dónde sale cada dato y por qué creerle.
 *  6. Cómo sumarse (Participar): la cifra que espera, aportar, denunciar o investigar, lo que cuesta, por qué aportar no
 *     compra nada y adónde va.
 *
 * Toda cifra sale del API. Si una lectura falla, la sección que depende de ella
 * no se dibuja: una portada que estima lo que no sabe es exactamente lo que este
 * producto le reprocha al Estado. Nada cae a datos de maqueta.
 */
export default async function LandingPage() {
  // Las lecturas en paralelo: son independientes, y en serie cada una le sumaba
  // su viaje de ida y vuelta al primer byte de la portada.
  // Lo que Vigía lee es lo del año en curso: la base trae además la historia del OECE desde 2015, y contra todo
  // eso "leídos" quedaba en 0,0 %. Las cifras de la portada (publicados, leídos, escala, regiones) son del año.
  const anio = anioLectura();
  const desde = desdeLectura();
  const [alertas, estado, resumen, regiones, ranking, vigilancia, ...porTipo] = await Promise.all([
    getAlertas({ limit: 100 }).catch(() => []),
    getEstadoGlobal().catch(() => null),
    getResumenContratos({ desde }).catch(() => null),
    getContratosGeo({ nivel: "departamento", desde }).catch(() => null),
    // Los tres del podio, para la primera pantalla (el mismo pedido que usa el podio de más abajo).
    getRankingPaginado({ periodo: "todo", limit: 12 }).catch(() => null),
    // Lo que cuesta mantener Vigía al mes (migración 206): el pedido de la portada dejó de ser «S/ 3 por contrato».
    getVigilancia().catch(() => null),
    // Las cajitas de la escala: cuántos leyó Vigía de cada tipo (el resumen general
    // trae el total por tipo, pero no los leídos por tipo).
    ...TIPOS_ESCALA.map((t) => getResumenContratos({ tipo: t.clave, desde }).catch(() => null)),
  ]);

  const montoTotal = (regiones ?? []).reduce((s, r) => s + (r.montoPen ?? 0), 0);

  // "Leído" es "tiene score": la misma definición que usa /app/contratos para
  // decir "118 leídos de 18,393". Las tres cifras salen del mismo resumen, o sea
  // del mismo universo (y coinciden con la suma de `procesados` del mapa).
  const publicados = resumen?.total ?? 0;
  // Un análisis en revisión o descartado también se leyó: suma a "leídos",
  // aunque no a las señales.
  const r = resumen?.porRiesgo;
  const leidos = contarLeidos(r) ?? 0;
  const senalAlta = resumen?.porRiesgo.alto ?? 0;

  // Los gráficos del mapa de fuentes: las mismas cifras de arriba, nada nuevo.
  // Si una lectura falló, su gráfico no se dibuja (queda null).
  const cifrasFuentes: CifrasFlujo = {
    publicados: resumen?.total ?? null,
    leidos: r ? leidos : null,
    porTipo: resumen ? tiposConResto(resumen.total, resumen.porTipo) : null,
    // Los mismos cinco grupos que suman `leidos`: el nodo de señales y el del
    // informe cuentan el mismo universo.
    porRiesgo: r
      ? { alto: r.alto ?? 0, medio: r.medio ?? 0, bajo: r.bajo ?? 0, enRevision: r.en_revision ?? 0, descartado: r.descartado ?? 0 }
      : null,
    regiones: regiones?.length
      ? [...regiones].sort((a, b) => b.total - a.total).slice(0, 5).map((z) => ({ nombre: z.nombre, n: z.total }))
      : null,
  };

  const tiposEscala = resumen ? armarTiposEscala(resumen.porTipo, publicados, leidos, porTipo) : [];
  // La escala es del año en curso, como todas las cifras de la portada; el ⓘ lo dice.
  const anioEscala: AnioEscala | null = resumen && publicados > 0 ? { anio, enAnio: publicados } : null;

  // Cada caso de «Lo que ya encontró» lleva de título el nombre de su regla y, por su nombre, sus otras señales de proceso.
  const casos: CasoConDetalle[] = elegirCasos(alertas, 4).map((c) => {
    const regla = reglaDelCaso(alertas, c);
    return { ...c, regla, otras: otrasSenalesDelCaso(alertas, c, regla) };
  });

  return (
    <>
      <HeroPixel aliados={clasificar(ranking?.data ?? []).slice(0, 3)} piso={vigilancia?.meta.pisoPen ?? null} />

      {/* El orden, a la vista: los cinco pasos de la historia, pegados bajo la cabecera, con el que se está leyendo. */}
      <IndiceRecorrido />

      {/* El pitch en dos secciones. A: el problema, como tablero de cifras. */}
      {publicados > 0 && montoTotal > 0 && (
        <EscalaDinero
          montoTotal={montoTotal}
          publicados={publicados}
          leidos={leidos}
          senalAlta={senalAlta}
          tipos={tiposEscala}
          anio={anioEscala}
          financiables={estado?.colaGlobal ?? null}
          regionesConLectura={regiones?.length ? regiones.filter((z) => z.procesados > 0).length : null}
        />
      )}

      {/* B: la respuesta, un solo mapa con tres lecturas y la tabla de partidos. El revelado en píxeles va sólo aquí: en
          nueve secciones dejaba de ser un momento y era un efecto repetido. */}
      <PixelReveal desde="izquierda" celda={30}>
        <PartidosSeccion />
      </PixelReveal>

      {/* La prueba antes del pedido (2026-10-29): los casos leídos; después cómo se lee, con qué fuentes y con qué
          reglas; recién entonces cómo sumarse. */}
      <CasoLeido casos={casos} leidos={leidos} />

      {/* «En revisión»: la misma cuenta que el gráfico de señales del mapa de fuentes (resumen de contratos). El estado
          global contaba otro universo y la portada decía 12 en una sección y 14 en otra. */}
      <ComoFunciona cifras={cifrasFuentes} enRevision={r ? (r.en_revision ?? 0) : null} />

      <Participar enCola={estado?.colaGlobal ?? null} />

      {/* Las animaciones en bucle de cada bloque corren sólo cuando el bloque está cerca de la pantalla. */}
      <PausaFueraDePantalla />
    </>
  );
}

/**
 * El nombre de la regla del caso de portada ("Única oferta válida"): `elegirCasos` no
 * lo trae, así que se busca en su alerta la bandera cuya evidencia es la elegida. Se
 * compara sólo letras y cifras porque la portada limpia la puntuación del texto. Si no
 * aparece, la ficha dice "Lo que encontró Vigía" en vez de adivinar.
 */
function reglaDelCaso(alertas: AlertaReal[], caso: CasoPortada): string | null {
  const clave = (t: string) => t.toLowerCase().replace(/[^a-z0-9áéíóúüñ]/g, "");
  const buscada = clave(caso.hallazgo);
  const alerta = alertas.find((a) => a.codigoconvocatoria === caso.convocatoria && (a.codigo ?? "") === caso.codigo);
  const bandera = alerta?.banderas?.find((b) => b.evidencia && clave(b.evidencia) === buscada);
  return bandera ? reglaLabel(bandera.regla) : null;
}

/**
 * Las otras señales de proceso del contrato de portada, sólo por su nombre ("Procedimiento
 * no competitivo"), sin repetir la que ya se muestra. Las que hablan de personas o las que
 * redacta un modelo leyendo el PDF no se nombran acá: quedan contadas en "otrasSenales".
 */
function otrasSenalesDelCaso(alertas: AlertaReal[], caso: CasoPortada, reglaMostrada: string | null): OtraSenal[] {
  const alerta = alertas.find((a) => a.codigoconvocatoria === caso.convocatoria && (a.codigo ?? "") === caso.codigo);
  const vistas = new Set<string>(reglaMostrada ? [reglaMostrada] : []);
  const otras: OtraSenal[] = [];
  for (const b of alerta?.banderas ?? []) {
    if (!esReglaDeProceso(b.regla)) continue;
    const etiqueta = reglaLabel(b.regla);
    if (vistas.has(etiqueta)) continue;
    vistas.add(etiqueta);
    const severidad = b.severidad === "alta" || b.severidad === "media" || b.severidad === "baja" ? b.severidad : "media";
    otras.push({ etiqueta, severidad });
  }
  return otras;
}

/** Los cuatro tipos con cajita propia, en palabras de persona. El resto va en "Convenios y otros". */
const TIPOS_ESCALA: { clave: Exclude<TipoEscala["clave"], "otros">; etiqueta: string }[] = [
  { clave: "bienes", etiqueta: "Bienes" },
  { clave: "servicios", etiqueta: "Servicios" },
  { clave: "obras", etiqueta: "Obras" },
  { clave: "consultoria", etiqueta: "Consultorías" },
];

/**
 * Las cajitas de la escala: los cuatro tipos grandes y "Convenios y otros" con lo que
 * falta para llegar al total, así las cajitas suman el número del titular. Los leídos de
 * "otros" sólo se calculan si se conocen los de los cuatro tipos (si no, "Sin dato").
 */
function armarTiposEscala(
  porTipo: Partial<Record<string, number>>,
  total: number,
  leidosTotal: number,
  resumenes: ({ porRiesgo: Partial<Record<string, number>> } | null)[],
): TipoEscala[] {
  const grandes: TipoEscala[] = TIPOS_ESCALA.map((t, i) => ({
    clave: t.clave,
    etiqueta: t.etiqueta,
    total: porTipo[t.clave] ?? 0,
    leidos: contarLeidos(resumenes[i]?.porRiesgo),
  }));
  const resto = total - grandes.reduce((s, t) => s + t.total, 0);
  const conocidos = grandes.every((t) => t.leidos != null);
  const otros: TipoEscala = {
    clave: "otros",
    etiqueta: "Convenios y otros",
    total: resto,
    leidos: conocidos ? Math.max(0, leidosTotal - grandes.reduce((s, t) => s + (t.leidos ?? 0), 0)) : null,
  };
  return [...grandes.filter((t) => t.total > 0).sort((a, b) => b.total - a.total), ...(resto > 0 ? [otros] : [])];
}

/**
 * Los cinco tipos de contrato más comunes y una última barra con lo que falta
 * para llegar al total: los otros tipos y los que no tienen tipo. Así
 * las barras suman el número del título ("N contratos publicados, por tipo").
 */
function tiposConResto(total: number, porTipo: Partial<Record<string, number>>): NonNullable<CifrasFlujo["porTipo"]> {
  const top = TIPOS.map((t) => ({ etiqueta: t.label, n: porTipo[t.value] ?? 0 }))
    .filter((t) => t.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const resto = total - top.reduce((s, t) => s + t.n, 0);
  if (resto <= 0) return top;
  const sinClasificar = porTipo.sin_clasificar ?? 0;
  const etiqueta =
    sinClasificar <= 0 ? "Otros tipos" : sinClasificar >= resto ? "Sin clasificar" : "Otros tipos o sin clasificar";
  return [...top, { etiqueta, n: resto, resto: true }];
}
