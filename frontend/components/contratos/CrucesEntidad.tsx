/**
 * Ficha de entidad, pestaña "Ganadores en otros registros": sus procesos cuyo ganador tiene cruces con la ONPE,
 * el JNE, las visitas, las penalidades o las sanciones (GET /entidades/:ruc/cruces). Cada fila abre la
 * convocatoria, donde está el detalle de cada cruce con su fuente.
 */

import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { Separador } from "@/components/ui/Partes";
import type { CrucesEntidad } from "@/lib/contratos";
import { soles } from "@/lib/formato";

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;

const COLUMNAS: Columna[] = [
  { clave: "contrato", titulo: "Proceso y ganador", ancho: "minmax(0,1fr)" },
  { clave: "cruces", titulo: "Aparece en", ancho: "minmax(0,1.1fr)", desde: "md", apilar: true },
  { clave: "adjudicado", titulo: "Adjudicado", ancho: "130px", alinear: "der", desde: "lg" },
  { clave: "buenaPro", titulo: "Buena pro", ancho: "96px", desde: "lg" },
];

export function CrucesEntidadTabla({ procesos, nombre }: { procesos: CrucesEntidad["procesos"]; nombre: string }) {
  const filas: Fila[] = procesos.map((p) => {
    const codigo = String(p.codigo ?? p.ocid);
    return {
      id: `${p.ocid}-${p.rucProveedor}`,
      href: `/app/convocatoria/${encodeURIComponent(codigo)}`,
      celdas: {
        contrato: (
          <CeldaPrincipal
            titulo={p.objeto || "Proceso sin objeto registrado"}
            meta={
              <>
                <span>{p.proveedor ?? "Ganador sin nombre"}</span>
                <Separador />
                <span className="font-mono" translate="no">
                  {codigo}
                </span>
              </>
            }
          />
        ),
        cruces: (
          <ul className="flex flex-wrap gap-1.5" aria-label="Registros donde aparece">
            {p.cruces.map((c) => (
              <li key={c.tipo}>
                <Badge variant={VARIANTE[c.severidad]}>{c.etiqueta}</Badge>
              </li>
            ))}
          </ul>
        ),
        adjudicado: p.montoSoles != null ? <CeldaNumero>{soles(p.montoSoles)}</CeldaNumero> : undefined,
        buenaPro: <CeldaFecha fecha={p.fechaBuenaPro} />,
      },
    };
  });
  return <Tabla columnas={COLUMNAS} filas={filas} etiqueta={`Procesos de ${nombre} cuyo ganador aparece en otros registros`} />;
}
