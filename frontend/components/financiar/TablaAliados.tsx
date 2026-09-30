import { Avatar } from "@/components/financiar/RankingTable";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { TIPO_FINANCIADOR_LABEL, type Aliado } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";

/**
 * "Quién financió" en la ficha de una zona y en la de una entidad: reconocimiento en
 * contratos, nunca en soles. La fila va a la ficha del aliado cuando tiene una.
 * Server-safe: sólo datos planos.
 */

export interface AliadoFila {
  nombre: string;
  slug: string | null;
  logoUrl: string | null;
  /** "empresa" | "persona" | "organizacion" (el API por entidad lo manda como string). */
  tipo: string;
  contratos: number;
}

const COLUMNAS: Columna[] = [
  { clave: "aliado", titulo: "Aliado", ancho: "minmax(0,1fr)" },
  { clave: "contratos", titulo: "Financiados", ancho: "112px", alinear: "der" },
];

const esTipo = (t: string): t is Aliado["tipo"] => t === "empresa" || t === "persona" || t === "organizacion";

export function TablaAliados({ aliados, etiqueta }: { aliados: AliadoFila[]; etiqueta: string }) {
  const filas: Fila[] = aliados.map((a) => {
    const tipo = esTipo(a.tipo) ? a.tipo : "organizacion";
    return {
      id: `${a.slug ?? a.nombre}-${a.contratos}`,
      href: a.slug ? `/aliado/${a.slug}` : undefined,
      celdas: {
        aliado: (
          <span className="flex w-full min-w-0 items-center gap-3">
            <Avatar tipo={tipo} logoUrl={a.logoUrl} nombre={a.nombre} />
            <CeldaPrincipal
              titulo={a.nombre}
              meta={a.slug === "vigia-peru" ? "La propia plataforma" : esTipo(a.tipo) ? TIPO_FINANCIADOR_LABEL[a.tipo] : undefined}
            />
          </span>
        ),
        contratos: <CeldaNumero>{numero(a.contratos)}</CeldaNumero>,
      },
    };
  });
  return <Tabla columnas={COLUMNAS} filas={filas} etiqueta={etiqueta} />;
}
