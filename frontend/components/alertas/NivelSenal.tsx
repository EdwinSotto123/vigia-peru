import { AlertTriangle, CircleAlert, CircleDot } from "lucide-react";
import { SEVERIDAD, type NivelSeveridad } from "@/lib/severidad";
import type { NivelBandera } from "@/lib/revision";
import { cn } from "@/lib/utils";

/**
 * La severidad de una SEÑAL — los tres canales de siempre (color + ícono dibujado +
 * palabra), con los tokens de `lib/severidad.ts` y sin inventar ninguno.
 *
 * Por qué no es `<Severidad bandera>` directamente, que sería lo corto: la escala de
 * `lib/severidad.ts` está escrita para el score de un CONTRATO, donde "baja"
 * significa *no encontramos nada relevante* — y por eso su etiqueta es "Sin señal
 * relevante", su ícono un check y su color `moss`, el verde de lo positivo y de lo
 * verificado. Aplicado a una bandera eso miente dos veces: una señal de severidad
 * baja sí existe (14 de las 220 publicadas lo son), y pintarla con el mismo verde
 * del sello "Cotejada" la volvería indistinguible de una verificación correcta en
 * una columna de veinte filas.
 *
 * Así que para `alta` y `media` se usan exactamente los tokens del sistema —las
 * etiquetas ya dicen "Señal alta" y "Señal media"— y para `baja` se toma el neutro
 * que el propio sistema reserva a lo que no carga semáforo (`sin_analizar.texto`,
 * `text-mute`) en vez del verde. Ningún color nuevo, ningún umbral escrito a mano.
 *
 * El arreglo de fondo va en `lib/severidad.ts`, que no es de este frente: falta un
 * vocabulario de bandera ("Señal baja") separado del vocabulario de score ("Sin
 * señal relevante"). Está reportado como pendiente.
 */

const NIVEL: Record<NivelBandera, { palabra: string; token: NivelSeveridad; Icono: typeof AlertTriangle }> = {
  alta: { palabra: "Señal alta", token: "alta", Icono: AlertTriangle },
  media: { palabra: "Señal media", token: "media", Icono: CircleAlert },
  baja: { palabra: "Señal baja", token: "sin_analizar", Icono: CircleDot },
};

export function NivelSenal({
  nivel,
  formato = "linea",
  className,
}: {
  nivel: NivelBandera;
  formato?: "linea" | "pastilla";
  className?: string;
}) {
  const { palabra, token, Icono } = NIVEL[nivel];
  const s = SEVERIDAD[token];

  if (formato === "pastilla") {
    return (
      <span className={cn("pill", s.fondo, s.texto, s.borde, className)}>
        <Icono size={11} aria-hidden />
        {palabra}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", s.texto, className)}>
      <Icono size={13} aria-hidden />
      {palabra}
    </span>
  );
}
