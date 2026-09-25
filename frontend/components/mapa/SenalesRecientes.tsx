"use client";

import { WifiOff } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Seccion } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila } from "@/components/listado";
import { recortar } from "@/components/contratos/recortar";
import { plural, soles } from "@/lib/formato";
import { alertaHref, esSenal } from "./senales";

/**
 * Lo ya hecho, debajo de la pieza viva (plantilla Tablero, DESIGN_SYSTEM.md §14): los
 * contratos leídos de mayor peso del riesgo, en la `Tabla` del kit —chip · contrato ·
 * valor referencial · ›—, la misma fila que el resto de listados.
 *
 * Antes era una frase gris con la cifra adentro ("44 contratos con peso del riesgo
 * medio o alto. Los de mayor peso: …"); la cifra ya está en los `Indicadores` de la
 * cabecera y no se repite. Y antes de eso, un marquee "EN VIVO" que caía a alertas
 * inventadas cuando la API no respondía: si no responde, se dice.
 *
 * Cuenta sólo los de peso del riesgo medio o alto (`esSenal`, ≥ 40): `/alertas`
 * también trae los leídos sin nada que señalar (DESIGN_SYSTEM.md §10.1).
 */

const COLUMNAS: Columna[] = [
  { clave: "riesgo", titulo: "Peso del riesgo", ancho: "136px" },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Valor referencial", ancho: "128px", alinear: "der", desde: "md" },
];

const TOP = 5;

export function SenalesRecientes({
  alertas,
  fallo,
}: {
  /** `null` = todavía cargando. */
  alertas: any[] | null;
  fallo: boolean;
}) {
  if (fallo) {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-inkSoft" role="status" aria-live="polite">
        <WifiOff size={13} className="text-clayTexto" aria-hidden />
        No pudimos cargar las señales publicadas; reintentando…
      </p>
    );
  }

  const senales = alertas?.filter(esSenal) ?? null;

  if (senales && senales.length === 0) {
    return (
      <p className="flex items-center gap-1 text-[12px] text-mute">
        Todavía no hay contratos leídos con peso del riesgo medio o alto.
        <Ayuda titulo="¿Cuándo aparecen?">
          Cuando un contrato termina de leerse y su dictamen pasa la autoevaluación.
        </Ayuda>
      </p>
    );
  }

  const filas: Fila[] = (senales ?? [])
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, TOP)
    .map((a) => {
      const n = Array.isArray(a.banderas) ? a.banderas.length : 0;
      const objeto = typeof a.objeto === "string" && a.objeto ? a.objeto : "Sin objeto registrado";
      return {
        id: String(a.id ?? a.codigo),
        href: alertaHref(a),
        celdas: {
          riesgo: <Severidad score={a.score} />,
          // Recortado en una palabra: el objeto entero va en el dossier.
          contrato: <CeldaPrincipal titulo={recortar(objeto, 140)} meta={[plural(n, "señal", "señales"), a.entidad, a.region].filter(Boolean).join(" · ")} />,
          monto: (
            <CeldaNumero>
              {typeof a.montoSoles === "number" && a.montoSoles > 0 ? soles(a.montoSoles) : <span className="font-sans text-mute">Sin dato</span>}
            </CeldaNumero>
          ),
        },
      };
    });

  return (
    <Seccion
      titulo="Los de mayor peso del riesgo"
      ayuda={
        <Ayuda titulo="¿Cuáles aparecen aquí?">
          Los {TOP} contratos leídos de puntaje más alto, entre los de riesgo medio o alto con el dictamen publicado.
        </Ayuda>
      }
    >
      {senales === null ? (
        <div role="status" aria-busy>
          <TablaSkeleton columnas={COLUMNAS} filas={3} />
          <span className="sr-only">Cargando las señales publicadas…</span>
        </div>
      ) : (
        <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Contratos de mayor peso del riesgo" />
      )}
    </Seccion>
  );
}
