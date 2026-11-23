import type { ReactElement } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Nota } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { plural } from "@/lib/formato";
import type { PatronesDeEntidad, SeccionPatrones } from "@/lib/patrones";
import { FAMILIAS_PATRON, PATRON_EMPRESA, P_PATRON_EMPRESA, indicePorFamilia, type EntradaConFamilia } from "@/lib/patronesEntidad";
import { etiquetaRegla, type CatalogoReglas } from "@/lib/revision";
import { IndiceAntecedentes, type TipoDelIndice } from "./IndiceAntecedentes";

/** La lista de un patrón con el RUC de la empresa: un trozo aparte (carga todas las listas y su panel de detalle). */
const ListaDePatron = dynamic(() => import("@/components/investigar/PatronesVista").then((m) => m.ListaDePatron));

/**
 * La ficha de un patrón en que aparece la empresa (pedido del usuario del 2026-11-18: «armar fichas por cada patrón»): su
 * familia, la misma lista de /app/patrones con su RUC ya puesto (sin repetirla en cada fila: `vista="empresa"`; cada fila
 * abre su panel con la evidencia) y qué conviene mirar.
 */
function FichaDePatron({ clave, ruc, etiquetas }: { clave: SeccionPatrones; ruc: string; etiquetas: Record<string, string> }) {
  const p = PATRON_EMPRESA[clave];
  if (!p) return null;
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{FAMILIAS_PATRON.find((f) => f.clave === p.familia)?.nombre ?? "Patrón en que aparece"}</Badge>
        {p.observacion ? <Badge variant="amber">En observación: todavía no cuenta para el puntaje</Badge> : null}
      </p>
      <ListaDePatron clave={clave} ruc={ruc} titulo={p.nombre} etiquetas={etiquetas} vista="empresa" />
      <Nota>
        <b className="font-semibold text-ink">Qué conviene mirar.</b> {p.mirar}{" "}
        <Link href={`/app/patrones?seccion=${clave}`} prefetch={false} className="font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
          Ver este patrón en todo el país
        </Link>
      </Nota>
    </div>
  );
}

/**
 * Los patrones en que aparece una empresa (postor de relleno, mismo dueño, grupos, compras repetidas…) como su subpestaña:
 * cómo se reparten sus casos por familia y el índice (`?apat=`) con la ficha de cada uno. `n`: cuántos patrones tienen
 * casos (0: no hay subpestaña).
 */
export function vistaDePatrones(listas: PatronesDeEntidad["listas"], ruc: string, cat: CatalogoReglas): { vista: ReactElement | null; n: number } {
  // El nombre legible de cada señal de los agentes, como en /app/patrones.
  const etiquetas: Record<string, string> = {};
  for (const id of [...Object.keys(cat), "red_flag_documental"]) etiquetas[id] = etiquetaRegla(id, cat);
  const patrones: (TipoDelIndice & EntradaConFamilia)[] = listas.flatMap(({ clave, casos }) => {
    const x = PATRON_EMPRESA[clave];
    return x && casos
      ? [{
          clave, familia: x.familia, nombre: x.nombre, corto: x.corto, severidad: x.severidad, n: casos,
          resumen: `${plural(casos, "caso", "casos")}${x.observacion ? ", en observación" : ""}`,
          contenido: <FichaDePatron clave={clave} ruc={ruc} etiquetas={etiquetas} />,
        }]
      : [];
  });
  const tipos: TipoDelIndice[] = indicePorFamilia(patrones);
  if (!tipos.length) return { vista: null, n: 0 };
  return {
    n: tipos.length,
    vista: (
      <div className="space-y-4">
        <IndiceAntecedentes tipos={tipos} param={P_PATRON_EMPRESA} que="Patrón" columna="Casos" titulo={plural(tipos.length, "patrón en que aparece", "patrones en que aparece")} />
      </div>
    ),
  };
}
