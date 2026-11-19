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
  /** Frente al resto del país (migración 422): procesos apelables corregidos, la tasa del resto, cuántas veces más, la
   * probabilidad de azar y si destaca (falsos descubrimientos al 10 % sobre todas las entidades). */
  comparacion?: { procesos: number; corregidos: number; tasa: number; tasaResto: number; veces: number | null; pValor: number; destacada: boolean } | null;
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

/** «Pct» con coma decimal: 0,8 %, 12 %. */
const pct = (x: number) => { const p = 100 * x; return `${p < 10 ? p.toFixed(1).replace(".", ",") : String(Math.round(p))} %`; };

/**
 * Sus procesos corregidos por el Tribunal frente al resto del país. Sólo se afirma un exceso si pasa el control de falsos
 * descubrimientos (destacada); si no, se dan las cifras sin juicio. Con pocos procesos apelables, nada.
 */
function FrenteAlPais({ c }: { c?: TribunalDeEntidad["comparacion"] }) {
  if (!c || c.procesos < 10) return null;
  return (
    <p className="text-meta leading-relaxed text-inkSoft">
      De sus <b>{numero(c.procesos)}</b> procesos apelables desde 2024 (licitaciones, concursos y adjudicaciones con dos
      postores o más), el Tribunal corrigió <b>{numero(c.corregidos)}</b> ({pct(c.tasa)}); en el resto del país, el {pct(c.tasaResto)}.{" "}
      {c.destacada && c.veces != null ? (
        <>Es <b>{c.veces.toFixed(1).replace(".", ",")} veces</b> lo del resto del país y no se explica por azar: sus comités se equivocan, o sus procesos tienen vicios, más que en otras entidades.</>
      ) : (
        <>La diferencia con el resto del país no basta para descartar el azar.</>
      )}{" "}
      Todavía se están leyendo resoluciones: la cifra puede cambiar.
    </p>
  );
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
        <FrenteAlPais c={d.comparacion} />
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
