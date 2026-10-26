"use client";

import Link from "next/link";
import { Flag, WifiOff } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Seccion } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila } from "@/components/listado";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { ConBanderaDato } from "@/components/contratos/DatoDudosoContrato";
import { limpiarObjeto, recortar } from "@/components/contratos/recortar";
import { formatMonto, type ContratoResumen } from "@/lib/contratos";
import { oracion, plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { CORTE_MEDIA } from "@/lib/severidad";

/**
 * Lo ya hecho, debajo de la pieza viva (plantilla Tablero, DESIGN_SYSTEM.md §14): los contratos leídos de mayor peso
 * del riesgo, en la `Tabla` del kit —chip · contrato · valor referencial · ›—, la misma fila que el resto de listados.
 *
 * Sale de `GET /contratos?orden=score` (y no de `/alertas`): así el monto es de verdad el valor REFERENCIAL que dice la
 * columna (la alerta trae el adjudicado) y llega la bandera de «posible error de carga» de cada contrato
 * (`datoDudoso`). En el celular el chip va bajo el título (§14.1: `desde: "md", apilar`); antes una columna fija de
 * 136 px dejaba el título en dos palabras. Títulos en oración y entidades con su nombre, no en MAYÚSCULAS.
 *
 * Cuenta sólo los de peso del riesgo medio o alto (puntaje ≥ 40 con señales publicadas, DESIGN_SYSTEM.md §10.1).
 */

const COLUMNAS: Columna[] = [
  { clave: "riesgo", titulo: "Peso del riesgo", ancho: "132px", desde: "md", apilar: true },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Valor referencial", ancho: "140px", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Valor" },
];

const TOP = 5;

/** Peso del riesgo medio o alto: con señales publicadas y puntaje de 40 o más. */
export const esDeMayorPeso = (c: Pick<ContratoResumen, "score" | "banderas">) => (c.banderas ?? 0) > 0 && (c.score ?? 0) >= CORTE_MEDIA;

export function SenalesRecientes({
  contratos,
  fallo,
}: {
  /** Los de mayor puntaje (ya ordenados por el API). `null` = todavía cargando. */
  contratos: ContratoResumen[] | null;
  fallo: boolean;
}) {
  if (fallo) {
    return (
      <p className="flex items-center gap-1.5 text-rotulo text-inkSoft" role="status" aria-live="polite">
        <WifiOff size={13} className="text-clayTexto" aria-hidden />
        No pudimos cargar los contratos de mayor peso del riesgo; reintentando…
      </p>
    );
  }

  const deMayorPeso = contratos?.filter(esDeMayorPeso) ?? null;

  if (deMayorPeso && deMayorPeso.length === 0) {
    return (
      <p className="flex items-center gap-1 text-rotulo text-mute">
        Todavía no hay contratos leídos con peso del riesgo medio o alto.
        <Ayuda titulo="¿Cuándo aparecen?">
          Cuando un contrato termina de leerse y su dictamen pasa la autoevaluación.
        </Ayuda>
      </p>
    );
  }

  // recorte: los cinco de mayor peso; todas las señales, con buscador y filtros, en «Ver todas las señales publicadas»
  const filas: Fila[] = (deMayorPeso ?? []).slice(0, TOP).map((c) => {
    const titulo = c.titulo ? oracion(limpiarObjeto(c.titulo)) : "Sin objeto registrado";
    return {
      id: c.ocid,
      href: rutaContrato(c.ocid, "dictamen"),
      celdas: {
        riesgo: (
          <ConBanderaDato dato={c.datoDudoso}>
            <PesoRiesgo score={c.score} banderas={c.banderas} enRevision={c.enRevision} formato="pastilla" />
          </ConBanderaDato>
        ),
        // Recortado en una palabra: el objeto entero va en el dossier y en el `title`.
        contrato: (
          <CeldaPrincipal
            titulo={recortar(titulo, 140)}
            textoCompleto={titulo}
            meta={[
              <Dato key="s" icono={Flag} nombre="Señales">{plural(c.banderas ?? 0, "señal", "señales")}</Dato>,
              c.entidad && <Dato key="e" tipo="entidad">{tituloNatural(c.entidad)}</Dato>,
              c.zona && <Dato key="r" tipo="lugar">{c.zona}</Dato>,
            ]}
          />
        ),
        monto: <CeldaNumero>{formatMonto(c.montoPen, c.moneda)}</CeldaNumero>,
      },
    };
  });

  return (
    <Seccion
      titulo="Los de mayor peso del riesgo"
      ayuda={
        <Ayuda titulo="¿Cuáles aparecen aquí?">
          Los {TOP} contratos leídos de puntaje más alto, entre los de riesgo medio o alto con el dictamen publicado, de
          todos los años. Un dato que el Estado publicó y no se puede creer lleva su bandera de «posible error».
        </Ayuda>
      }
    >
      {deMayorPeso === null ? (
        <div role="status" aria-busy>
          <TablaSkeleton columnas={COLUMNAS} filas={3} />
          <span className="sr-only">Cargando los contratos de mayor peso del riesgo…</span>
        </div>
      ) : (
        <div className="space-y-2">
          <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Contratos de mayor peso del riesgo" />
          {/* Los de mayor peso; todas las señales, con buscador y filtros, en /app/hallazgos. */}
          <Link href="/app/hallazgos" className="inline-flex min-h-[24px] items-center text-meta font-medium text-granate underline-offset-2 hover:underline">
            Ver todas las señales publicadas
          </Link>
        </div>
      )}
    </Seccion>
  );
}
