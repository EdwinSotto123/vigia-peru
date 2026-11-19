/**
 * Los procesos de la entidad ante el Tribunal de Contrataciones (API GET /entidades/:ruc/tribunal; migraciones 402-403):
 * cuántas apelaciones resolvió, cuántas fueron fundadas o terminaron en la nulidad del procedimiento (su comité se
 * equivocó o el proceso tenía un vicio) y las más recientes, cada una con su resolución y su contrato. Sólo las ya leídas
 * y unidas a un contrato: las resoluciones se bajan cada hora y la cobertura crece. Server component; sin datos, nada.
 */
import Link from "next/link";
import { BloqueDetalle, DatosClave, EnlaceFuente, FuenteDato, type DatoClave } from "@/components/patrones";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { API_BASE } from "@/lib/api-client";
import { fechaConAnio, numero, oracion } from "@/lib/formato";

interface Reciente {
  titulo: string;
  fecha: string | null;
  resultado: string | null;
  motivo: string | null;
  enlace: string;
  ocid: string | null;
  codigo: string | null;
}
interface TribunalDeEntidad {
  apelaciones: number;
  fundadas: number;
  nulidades: number;
  recientes: Reciente[];
}

const RESULTADO: Record<string, string> = {
  fundado: "Apelación fundada",
  fundado_en_parte: "Apelación fundada en parte",
  infundado: "Apelación infundada",
  improcedente: "Apelación improcedente",
  nulidad_de_oficio: "Nulidad del procedimiento",
  desistimiento: "Desistimiento",
  otro: "Resuelta",
};

async function leer(ruc: string): Promise<TribunalDeEntidad | null> {
  try {
    const r = await fetch(`${API_BASE}/entidades/${ruc}/tribunal`, { next: { revalidate: 3600 } });
    return r.ok ? ((await r.json()) as TribunalDeEntidad) : null;
  } catch {
    return null;
  }
}

export async function TribunalEntidad({ ruc }: { ruc: string }) {
  const d = await leer(ruc);
  if (!d || !d.apelaciones) return null;
  const cifras: Cifra[] = [
    { valor: numero(d.apelaciones), etiqueta: "apelaciones resueltas", contexto: "de sus procesos, ya leídas" },
    { valor: numero(d.fundadas), etiqueta: "fundadas", contexto: "el comité se equivocó al calificar o al otorgar" },
    { valor: numero(d.nulidades), etiqueta: "nulidades", contexto: "el Tribunal anuló el procedimiento" },
  ];
  return (
    <section aria-labelledby="tribunal-entidad" className="tarjeta mt-5 overflow-clip rounded-2xl border border-line bg-paper">
      <div className="space-y-4 p-4 sm:p-5">
        <h3 id="tribunal-entidad" className="font-display text-bloque font-bold text-ink">
          Ante el Tribunal de Contrataciones
        </h3>
        <CifrasEnFila items={cifras} chico />
        {d.recientes.map((x) => {
          const datos: DatoClave[] = [
            { etiqueta: "Resultado", valor: RESULTADO[x.resultado ?? "otro"] ?? "Resuelta" },
            { etiqueta: "Fecha", valor: x.fecha ? fechaConAnio(x.fecha) : null },
            { etiqueta: "Por qué", valor: x.motivo ? oracion(x.motivo) : null },
            {
              etiqueta: "El proceso",
              valor: x.ocid ? (
                <Link href={`/app/contratos/${encodeURIComponent(x.ocid)}`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                  {x.codigo ?? x.ocid}
                </Link>
              ) : null,
            },
          ];
          return (
            <BloqueDetalle key={x.enlace} titulo={x.titulo}>
              <DatosClave items={datos} />
              <EnlaceFuente href={x.enlace} className="mt-2">
                Leer la resolución
              </EnlaceFuente>
            </BloqueDetalle>
          );
        })}
      </div>
      <FuenteDato fuente="Resoluciones del Tribunal de Contrataciones en gob.pe, leídas por Vigía" className="border-t border-line px-4 py-2 sm:px-5" />
    </section>
  );
}
