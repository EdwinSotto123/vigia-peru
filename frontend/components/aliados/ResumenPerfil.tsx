import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Ayuda, DatosClave, EstadoVacio, Seccion, type DatoClave } from "@/components/patrones";
import { fecha, numero, plural } from "@/lib/formato";
import { PARTES_LECTURA } from "./proporcion";
import { PruebaIndependencia } from "./ReglasIndependencia";
import { RegionesDeAliado, TablaSenales, senalesRecientes, type SenalDeAliado } from "./PerfilAliado";
import type { ContribucionAliado } from "./CadenaAliado";
import type { ResumenPerfil as Resumen } from "./perfil";

/**
 * La primera pestaña del perfil de un aliado (DESIGN_SYSTEM.md §14.3 y §14.6): lo que se
 * entiende en una pantalla. A la izquierda, lo que se encontró en sus contratos (las
 * señales más recientes) y dónde cayeron; a la derecha, lo que hizo posible y en qué
 * terminó lo leído. Cada lista muestra unas pocas filas y lleva a su pestaña completa.
 */

const num = numero;
const VISIBLES = 4;

/** "Ver las 12 señales →": cambia de pestaña (la URL lleva `?seccion=`). */
function VerTodo({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex min-h-[32px] items-center gap-1 text-[13px] font-semibold text-granate underline-offset-2 hover:underline"
    >
      {children} <ArrowRight size={13} aria-hidden />
    </Link>
  );
}

export function ResumenDelPerfil({
  nombre,
  r,
  senales,
  contribuciones,
  entidades,
  hrefs,
  esMaqueta = false,
}: {
  nombre: string;
  r: Resumen;
  /** Señales ya extraídas de los comprobantes (ordenadas por puntaje). */
  senales: SenalDeAliado[];
  /** En orden descendente por fecha, como las devuelve el API. */
  contribuciones: ContribucionAliado[];
  /** Entidades distintas entre los contratos leídos; `null` si no se puede contar entero. */
  entidades: number | null;
  /** Enlaces a las otras pestañas. */
  hrefs: { senales: string; zonas: string; aportes: string };
  esMaqueta?: boolean;
}) {
  const recientes = senalesRecientes(senales, VISIBLES);
  const primero = contribuciones[contribuciones.length - 1];
  const ultimo = contribuciones[0];
  const porLeer = Math.max(0, r.financiados - r.leidos);

  const posible: DatoClave[] = [
    { etiqueta: "Aportes", valor: num(r.aportes) },
    { etiqueta: "Primer aporte", valor: primero ? fecha(primero.pagadaAt) : null },
    ...(r.aportes > 1 && ultimo ? [{ etiqueta: "Último aporte", valor: fecha(ultimo.pagadaAt) }] : []),
    ...(entidades != null && entidades > 0 ? [{ etiqueta: "Entidades revisadas", valor: num(entidades) }] : []),
    {
      etiqueta: "Por leer",
      valor: porLeer > 0 ? plural(porLeer, "contrato", "contratos") : "Ninguno: todo leído",
      ayuda: (
        <Ayuda titulo="¿Por qué quedan contratos por leer?">
          Están financiados y esperan su turno en la cola, o sus documentos. Se leen en orden de antigüedad.
        </Ayuda>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <Seccion
            titulo="Últimas señales en sus contratos"
            ayuda={
              <Ayuda titulo="¿Una señal es una acusación?">
                No: cada señal se publica con la norma citada y el documento oficial que la sostiene, y se publicó sin
                consultar a {nombre}.
              </Ayuda>
            }
            acciones={senales.length > recientes.length ? <VerTodo href={hrefs.senales}>Ver las {num(r.conSenal)}</VerTodo> : undefined}
          >
            {recientes.length > 0 ? (
              <TablaSenales senales={recientes} nombre={nombre} esMaqueta={esMaqueta} compacta />
            ) : (
              // Sin la llamita: esta página nombra a una persona u organización (§2.3).
              <EstadoVacio compacto conLlamita={false} titulo={r.leidos > 0 ? "Sin señales publicadas" : "Todavía sin contratos leídos"}>
                {r.leidos > 0
                  ? `Ninguno de sus ${num(r.leidos)} contratos leídos tiene una señal publicada.`
                  : "Cada contrato aparece aquí en cuanto su dictamen se publica."}
              </EstadoVacio>
            )}
          </Seccion>

          {r.regiones.length > 0 && (
            <Seccion
              titulo="Dónde cayeron sus contratos"
              acciones={
                r.regiones.length > VISIBLES ? <VerTodo href={hrefs.zonas}>Ver las {num(r.regiones.length)} zonas</VerTodo> : undefined
              }
            >
              <RegionesDeAliado regiones={r.regiones} financiados={r.financiados} limite={VISIBLES} />
            </Seccion>
          )}
        </div>

        <div className="space-y-6 lg:col-span-5">
          <Seccion titulo={`Lo que hizo posible ${nombre}`} acciones={<VerTodo href={hrefs.aportes}>Sus aportes</VerTodo>}>
            <div className="space-y-4">
              <DatosClave items={posible} />
              <QueSalio leidos={r.leidos} conSenal={r.conSenal} enRevision={r.enRevision} sinSenal={r.sinSenal} />
            </div>
          </Seccion>
          <PruebaIndependencia nombre={nombre} />
        </div>
      </div>
    </div>
  );
}

/**
 * En qué terminaron las lecturas que pagó: una barra apilada a escala, porque lo que
 * importa es la proporción entre los destinos de un contrato leído. "En revisión" va en
 * neutro, nunca en ámbar (ámbar es "Señal media").
 */
function QueSalio({ leidos, conSenal, enRevision, sinSenal }: { leidos: number; conSenal: number; enRevision: number; sinSenal: number }) {
  if (leidos === 0) return null;
  const partes = [
    { clave: "senal", etiqueta: "con señales", valor: conSenal, barra: PARTES_LECTURA.senal },
    { clave: "revision", etiqueta: "en revisión", valor: enRevision, barra: PARTES_LECTURA.revision },
    { clave: "limpio", etiqueta: "sin señales", valor: sinSenal, barra: PARTES_LECTURA.limpio },
  ].filter((p) => p.valor > 0);
  return (
    <figure className="rounded-xl border border-line px-3.5 py-3">
      <figcaption className="text-[13px] text-mute">En qué terminaron sus {num(leidos)} contratos leídos</figcaption>
      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-paperDeep" aria-hidden>
        {partes.map((p) => (
          <div key={p.clave} className={p.barra} style={{ width: `${(p.valor / leidos) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-inkSoft">
        {partes.map((p) => (
          <li key={p.clave} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${p.barra}`} aria-hidden />
            <span className="font-semibold tabular-nums text-ink">{num(p.valor)}</span> {p.etiqueta}
          </li>
        ))}
      </ul>
    </figure>
  );
}
