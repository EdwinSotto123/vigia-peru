import { Avatar } from "@/components/financiar/RankingTable";
import { CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { TIPO_FINANCIADOR_LABEL, type Aliado } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";

/**
 * "Quién financió" en la ficha de una zona y en la de una entidad: reconocimiento en
 * contratos, nunca en soles. La fila va a la ficha del aliado cuando tiene una. Todos (antes, los
 * 12 primeros), de a 15 y con buscador por su nombre público (sólo aparecen aliados visibles).
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
      buscable: [a.nombre, esTipo(a.tipo) ? TIPO_FINANCIADOR_LABEL[a.tipo] : null].filter(Boolean).join(" "),
      celdas: {
        aliado: (
          <span className="flex w-full min-w-0 items-center gap-3">
            <Avatar tipo={tipo} logoUrl={a.logoUrl} nombre={a.nombre} />
            <CeldaPrincipal
              titulo={a.nombre}
              meta={[
                a.slug === "vigia-peru" ? (
                  <Dato key="t" tipo="tipo">La propia plataforma</Dato>
                ) : (
                  esTipo(a.tipo) && <Dato key="t" tipo="tipo">{TIPO_FINANCIADOR_LABEL[a.tipo]}</Dato>
                ),
              ]}
            />
          </span>
        ),
        contratos: <CeldaNumero>{numero(a.contratos)}</CeldaNumero>,
      },
    };
  });
  return (
    <TablaPaginada
      columnas={COLUMNAS}
      filas={filas}
      etiqueta={etiqueta}
      tam={15}
      nombre="aliados"
      buscar={{ placeholder: "Buscar un aliado por su nombre…", etiqueta: "Buscar un aliado" }}
    />
  );
}
