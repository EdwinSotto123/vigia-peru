/**
 * La pestaña Cómo funciona de /app/auditoria: el método de lectura, que antes vivía entero
 * en el ⓘ del título (un flotante de tres párrafos, cuando un ⓘ admite dos o tres
 * oraciones). Va en una pestaña y no en el ⓘ porque tiene forma propia —tres etapas y los
 * pasos de cada rama— y se entiende mejor dibujado que contado; y va al final porque es
 * lo que se consulta una vez, no lo que se vuelve a mirar.
 *
 *   Etapas   espera → análisis → dictamen, cada una con las píldoras que se ven en la cola
 *   Pasos    la `Tabla` del kit agrupada por rama; cada fila abre su panel (§14.4)
 *
 * Todo sale del catálogo (`components/agentes/catalogo`): los números y los pasos no se
 * escriben a mano. Server component.
 */

import { CabeceraPestana, Ayuda, BloqueDetalle, CuerpoDetalle, DatosClave } from "@/components/patrones";
import { CeldaPrincipal, CeldaTexto, CuentaGrupo, Tabla, type Columna, type GrupoFilas } from "@/components/listado";
import { PASOS, TOTAL_AGENTES, TOTAL_PASOS, porCarril, type PasoPipeline } from "@/components/agentes/catalogo";
import type { EstadoProc } from "@/lib/auditoria";
import { plural } from "@/lib/formato";
import { EstadoPill } from "./EstadoPill";

const ETAPAS: { titulo: string; texto: string; estados: EstadoProc[]; ayuda?: { titulo: string; texto: string } }[] = [
  {
    titulo: "Espera",
    texto: "Asignado a un aporte confirmado, espera sus documentos del SEACE y luego su turno, por antigüedad.",
    estados: ["esperando_documentos", "encolado"],
  },
  {
    titulo: "Análisis",
    texto: `${TOTAL_AGENTES} agentes lo leen en ${TOTAL_PASOS} pasos; cada contrato tarda unos minutos.`,
    estados: ["procesando"],
  },
  {
    titulo: "Dictamen",
    texto: "Cada señal cita su norma y su evidencia, y se publica aunque señale a quien pagó la lectura.",
    estados: ["procesado", "revision"],
    ayuda: {
      titulo: "¿Cuándo queda en revisión?",
      texto:
        "Antes de publicar, el análisis se revisa a sí mismo. Si no alcanza el mínimo, una persona lo revisa y, mientras tanto, no se muestran su puntaje ni sus señales.",
    },
  },
];

const PILDORA = "pill border-line bg-paperSoft text-inkSoft";

const COLUMNAS: Columna[] = [
  { clave: "paso", titulo: "Paso", ancho: "minmax(0,1fr)" },
  { clave: "tipo", titulo: "Tipo", ancho: "112px", desde: "md", apilar: true },
  { clave: "fuentes", titulo: "Contra qué lo coteja", ancho: "minmax(0,18rem)", desde: "lg" },
];

const tipoPaso = (p: PasoPipeline) => (p.tipo === "agente" ? "Agente" : "Consulta");
const listaY = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

export function ComoFunciona() {
  const ramas = porCarril(PASOS);
  const grupos: GrupoFilas[] = ramas.map((r) => {
    const tramos = Math.max(...r.pasos.map((p) => p.paso)) + 1;
    return {
      clave: r.key,
      titulo: (
        <>
          {r.label} <CuentaGrupo className="ml-1">{plural(r.pasos.length, "paso", "pasos")}</CuentaGrupo>
        </>
      ),
      filas: r.pasos.map((p) => {
        // Los que comparten índice dentro de la rama corren a la vez.
        const aLaVez = r.pasos.filter((o) => o.paso === p.paso && o.clave !== p.clave).map((o) => o.nombre);
        return {
          id: p.clave,
          celdas: {
            paso: <CeldaPrincipal titulo={p.nombre} meta={p.que} />,
            tipo: <span className={PILDORA}>{tipoPaso(p)}</span>,
            fuentes: p.fuentes.length ? <CeldaTexto>{p.fuentes.join(", ")}</CeldaTexto> : undefined,
          },
          detalle: {
            titulo: p.titulo,
            contenido: (
              <CuerpoDetalle>
                <DatosClave
                  items={[
                    { etiqueta: "Rama", valor: r.label },
                    { etiqueta: "Orden en la rama", valor: `Paso ${p.paso + 1} de ${tramos}` },
                    ...(aLaVez.length ? [{ etiqueta: "Corre a la vez que", valor: aLaVez.join(", ") }] : []),
                    {
                      etiqueta: "Tipo",
                      valor: p.tipo === "agente" ? "Agente: lee y emite señales" : "Consulta: trae datos o verifica, sin emitir señales",
                    },
                  ]}
                />
                <BloqueDetalle titulo="Qué hace">{p.que}</BloqueDetalle>
                <BloqueDetalle titulo="Contra qué lo coteja">
                  {p.fuentes.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {p.fuentes.map((f) => (
                        <li key={f} className={PILDORA}>
                          {f}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-mute">Sin dato</span>
                  )}
                </BloqueDetalle>
              </CuerpoDetalle>
            ),
          },
        };
      }),
    };
  });

  // Las ramas que corren a la vez y la que junta todo al final, nombradas desde el catálogo.
  const paralelas = listaY(ramas.slice(0, -1).map((r) => r.label));
  const final = ramas[ramas.length - 1]?.label;

  return (
    <div className="space-y-6">
      <CabeceraPestana>De la cola al dictamen, en tres etapas y siempre en el mismo orden.</CabeceraPestana>

      <ol className="grid gap-3 sm:grid-cols-3">
        {ETAPAS.map((e, i) => (
          <li key={e.titulo} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-paper p-4">
            <h3 className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-granate-50 text-[12px] font-bold tabular-nums text-granate"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="sr-only">Etapa {i + 1}:</span>
              {e.titulo}
              {e.ayuda && <Ayuda titulo={e.ayuda.titulo}>{e.ayuda.texto}</Ayuda>}
            </h3>
            <p className="text-[13px] leading-snug text-inkSoft text-pretty">{e.texto}</p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              {e.estados.map((s) => (
                <EstadoPill key={s} estado={s} />
              ))}
            </div>
          </li>
        ))}
      </ol>

      <section aria-labelledby="pasos-analisis">
        <h3 id="pasos-analisis" className="mb-3 flex items-center gap-1 font-display text-[15px] font-bold text-ink">
          Los {TOTAL_PASOS} pasos del análisis
          <Ayuda titulo="¿Qué es una rama?">
            {ramas.length > 2 ? `Las ramas ${paralelas} corren a la vez; la rama ${final} junta lo que encontraron y redacta el dictamen. ` : ""}
            Dentro de cada rama, los pasos van en orden. Toca un paso para ver qué hace y contra qué lo coteja.
          </Ayuda>
        </h3>
        <Tabla columnas={COLUMNAS} grupos={grupos} etiqueta="Pasos del análisis" />
      </section>
    </div>
  );
}
