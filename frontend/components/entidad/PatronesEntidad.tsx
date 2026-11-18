import dynamic from "next/dynamic";
import Link from "next/link";
import { FileWarning, Repeat2, Search, SearchCheck } from "lucide-react";
import { IndiceAntecedentes, type TipoDelIndice } from "@/components/empresas/secciones/IndiceAntecedentes";
import { Indicadores } from "@/components/listado";
import { Ayuda, CabeceraPestana, EstadoVacio, FuenteDato, Nota, Pestanas } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { TIPO_CRUCE, chipCruce } from "@/lib/cruces";
import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";
import { CONOSCE_BUSCADOR, CONTRATACIONES_ABIERTAS, DATASET_SOCIOS_RNP } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { getPatronesDeEntidad, type PatronesDeEntidad, type SeccionPatrones } from "@/lib/patrones";
import { CRUCE_CON_LISTA, FAMILIAS_PATRON, PATRON_LISTA, familiaDeCruce, type FamiliaPatron, type PatronDeLista } from "@/lib/patronesEntidad";
import { etiquetaRegla, getCatalogoReglas, type CatalogoReglas } from "@/lib/revision";
import { rutaContrato } from "@/lib/rutas";
import { EnIndice, FamiliasDePatron, type FamiliaConCasos } from "./FamiliasDePatron";

/**
 * La pestaña «Antecedentes y patrones» de la ficha de una entidad (pedidos del usuario del 2026-11-18). Antes eran banderas
 * sueltas en la cabecera y listas filtradas: nada decía «aquí hay concertación». Son DOS subpestañas, porque son dos cosas
 * («antecedente sería del contrato, mientras patrones es de varios contratos»):
 *
 *   · Patrones (`?pv=patrones`, `?patron=`): lo que se repite ENTRE VARIOS contratos u órdenes. Cada uno es una lista de
 *     /app/patrones (mismo dueño, grupos, compras repetidas, compras y familia…) con el RUC de la entidad ya puesto; cada
 *     fila abre su panel con la evidencia.
 *   · Antecedentes (`?pv=antecedentes`, `?antecedente=`): lo que pesa sobre CADA contrato, por quien lo ganó o por cómo se
 *     adjudicó (postor único, sanción vigente, socio común entre postores, fraccionamiento…): sus cifras, quiénes lo
 *     repiten, los contratos de más peso y el enlace a todos, filtrados en su lista de compras.
 *
 * Las dos llevan sus familias arriba (concertación, compras partidas, familia y política, sanciones, documentos) y un
 * índice con la ficha del elegido. Las banderas de la cabecera enlazan a su patrón (`?seccion=patrones&patron=`).
 *
 * La lista de cada patrón va en un trozo aparte (dynamic): carga todas las listas y su panel de detalle, que pesan.
 */
const ListaDePatron = dynamic(() => import("@/components/investigar/PatronesVista").then((m) => m.ListaDePatron));

const ENLACE = "font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate";
const PESO = { alta: 0, media: 1, baja: 2 } as const;

function CabeceraFicha({ familia, observacion }: { familia: FamiliaPatron; observacion?: boolean }) {
  const f = FAMILIAS_PATRON.find((x) => x.clave === familia);
  return (
    <p className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral">{f?.nombre ?? "Patrón"}</Badge>
      {observacion ? <Badge variant="amber">En observación: todavía no cuenta para el puntaje</Badge> : null}
    </p>
  );
}

/** La ficha de un patrón que tiene su lista: la lista con el RUC de la entidad, qué mirar y dónde verlo en todo el país. */
function FichaDeLista({ clave, p, ruc, etiquetas }: { clave: SeccionPatrones; p: PatronDeLista; ruc: string; etiquetas: Record<string, string> }) {
  return (
    <div className="space-y-4">
      <CabeceraFicha familia={p.familia} observacion={p.observacion} />
      <ListaDePatron clave={clave} ruc={ruc} titulo={p.nombre} etiquetas={etiquetas} />
      <Nota>
        <b className="font-semibold text-ink">Qué conviene mirar.</b> {p.mirar}{" "}
        <Link href={`/app/patrones?seccion=${clave}`} prefetch={false} className={ENLACE}>
          Ver este patrón en todas las entidades
        </Link>
      </Nota>
    </div>
  );
}

/** La ficha de un antecedente de sus contratos: qué es, cuántos y cuánto, los contratos de más peso y el enlace a todos. */
function FichaDeCruce({ c, ruc, patron }: { c: PatronesDeEntidad["cruces"][number]; ruc: string; patron?: { clave: SeccionPatrones; nombre: string; casos: number } }) {
  const info = TIPO_CRUCE[c.tipo] as { corto?: string; explica?: string } | undefined;
  const ejemplos = c.ejemplos ?? [];
  const repiten = c.repiten ?? [];
  return (
    <div className="space-y-4">
      <CabeceraFicha familia={familiaDeCruce(c.tipo)} />
      {patron ? (
        <Nota>
          <b className="font-semibold text-ink">También es un patrón.</b> Entre varios contratos de la entidad se repite{" "}
          <EnIndice param="patron" valor={patron.clave} pestana={{ param: "pv", clave: "patrones" }} className={ENLACE}>
            {patron.nombre.charAt(0).toLowerCase() + patron.nombre.slice(1)} ({plural(patron.casos, "caso", "casos")})
          </EnIndice>
          : ahí están juntos, con su evidencia.
        </Nota>
      ) : null}
      <div className="space-y-1">
        <h3 className="font-display text-bloque font-bold text-ink">{info?.corto ?? c.etiqueta}</h3>
        <p className="max-w-[80ch] text-dato leading-snug text-inkSoft">{info?.explica ?? c.etiqueta}</p>
      </div>
      <Indicadores
        franja
        items={[
          { valor: numero(c.contratos), etiqueta: c.contratos === 1 ? "contrato de la entidad" : "contratos de la entidad", contexto: "cuyo ganador tiene este antecedente", icono: <Search size={15} strokeWidth={1.9} aria-hidden />, parte: null },
          { valor: numero(c.graves), etiqueta: "de señal alta", contexto: c.graves ? "van primero en la lista" : "ninguno de señal alta", parte: null },
          { valor: solesCompacto(c.monto), etiqueta: "suman esos contratos", contexto: plural(c.empresas, "proveedor distinto", "proveedores distintos"), parte: null },
        ]}
      />
      {repiten.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-cuerpo font-semibold text-ink">Quiénes lo repiten en esta entidad</h4>
          <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
            {repiten.map((x, i) => (
              <li key={`${x.ruc ?? "sin"}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3.5 py-2 text-dato">
                <span className="min-w-0">
                  {x.ruc && /^20\d{9}$/.test(x.ruc) ? (
                    <Link href={`/empresa/${x.ruc}?seccion=antecedentes`} prefetch={false} className={ENLACE}>
                      {x.proveedor ? tituloNatural(x.proveedor) : `RUC ${x.ruc}`}
                    </Link>
                  ) : (
                    <span className="text-ink">{x.proveedor ? tituloNatural(x.proveedor) : "Persona natural"}</span>
                  )}
                </span>
                <span className="shrink-0 text-meta text-inkSoft">
                  <span className="font-mono tabular-nums text-ink">{numero(x.contratos)}</span> contratos por{" "}
                  <span className="font-mono tabular-nums text-ink">{solesCompacto(x.monto)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ejemplos.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-cuerpo font-semibold text-ink">
            {c.contratos > ejemplos.length ? `Los ${numero(ejemplos.length)} contratos de más peso` : c.contratos === 1 ? "El contrato" : "Los contratos"}
          </h4>
          <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line" data-lista="avance">
            {ejemplos.map((x) => (
              <li key={`${x.ocid}-${x.ruc ?? ""}`}>
                <Link
                  href={rutaContrato(x.ocid, "ficha", { seccion: "antecedentes" })}
                  prefetch={false}
                  className="block px-3.5 py-2.5 transition-colors hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 text-dato font-medium text-ink">{x.objeto ? tituloNatural(x.objeto) : `Proceso ${x.codigo ?? x.ocid}`}</span>
                    <span className="shrink-0 font-mono text-meta tabular-nums text-inkSoft">{x.monto != null ? solesCompacto(x.monto) : "Sin monto"}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-rotulo text-mute">
                    <Severidad bandera={x.severidad === "alta" ? "alta" : x.severidad === "media" ? "media" : "baja"} formato="punto" />
                    <span>
                      {x.fecha ? `Buena pro del ${fechaConAnio(x.fecha)}` : "Sin fecha de buena pro"}, ganó {x.proveedor ? tituloNatural(x.proveedor) : "un proveedor sin nombre en el registro"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <EnlaceAccion href={`/entidad/${ruc}?seccion=contratos&vista=contratos&cruce=${encodeURIComponent(c.tipo)}`} prefetch={false} flecha>
        {c.contratos === 1 ? "Ver ese contrato en sus compras" : `Ver los ${numero(c.contratos)} contratos en sus compras`}
      </EnlaceAccion>
      <FuenteDato
        fuente="Procesos de la entidad (SEACE y CONOSCE, OECE), cruzados con los registros públicos del ganador"
        href={CONTRATACIONES_ABIERTAS}
        enlaces={[
          { texto: "Procesos en CONOSCE (OECE)", href: CONOSCE_BUSCADOR },
          { texto: "Conformación jurídica de proveedores (RNP)", href: DATASET_SOCIOS_RNP },
        ]}
      />
    </div>
  );
}

const PV = "pv";
type Entrada = TipoDelIndice & { familia: FamiliaPatron };

/** Las familias con entradas, en su orden, con cuántas tiene cada una y la primera que abre. */
function familiasDe(entradas: Entrada[]): FamiliaConCasos[] {
  return FAMILIAS_PATRON.flatMap((f) => {
    const suyas = entradas.filter((e) => e.familia === f.clave);
    return suyas.length ? [{ clave: f.clave, corto: f.corto, explica: f.explica, n: suyas.length, graves: suyas.filter((e) => e.severidad === "alta").length, primera: suyas[0].clave }] : [];
  });
}

/** Por familia (en su orden), lo grave primero y, dentro, lo que más casos tiene; cada entrada con el rótulo de su familia. */
function ordenar(entradas: Entrada[]): Entrada[] {
  const orden = new Map(FAMILIAS_PATRON.map((f, i) => [f.clave, i]));
  return entradas
    .sort((a, b) => orden.get(a.familia)! - orden.get(b.familia)! || PESO[a.severidad] - PESO[b.severidad] || b.n - a.n)
    .map((e) => ({ ...e, grupo: FAMILIAS_PATRON.find((f) => f.clave === e.familia)?.nombre }));
}

const sinFamilia = ({ familia: _familia, ...t }: Entrada): TipoDelIndice => t;

export async function PatronesEntidad({
  ruc,
  sub,
  patron,
}: {
  ruc: string;
  /** La subpestaña pedida (`?pv=`). */
  sub?: string;
  /** El patrón pedido (`?patron=`): sólo para los enlaces de antes del 2026-11-18, que nombraban así un antecedente. */
  patron?: string;
}) {
  const [d, cat] = await Promise.all([getPatronesDeEntidad(ruc), getCatalogoReglas().catch(() => ({}) as CatalogoReglas)]);
  if (!d) {
    return (
      <EstadoVacio compacto titulo="No pudimos armar sus patrones ahora">
        El servicio no respondió. Vuelve a abrir la pestaña en un momento: sus banderas siguen en la cabecera.
      </EstadoVacio>
    );
  }
  // El nombre legible de cada señal de los agentes, como en /app/patrones.
  const etiquetas: Record<string, string> = {};
  for (const id of [...Object.keys(cat), "red_flag_documental"]) etiquetas[id] = etiquetaRegla(id, cat);

  // Los patrones: lo que junta varios contratos u órdenes de la entidad.
  const casosDe = new Map(d.listas.map((x) => [x.clave, x.casos]));
  const patrones: Entrada[] = [];
  const sinCasos: string[] = [];
  const sinRespuesta: string[] = [];
  for (const { clave, casos } of d.listas) {
    const p = PATRON_LISTA[clave];
    if (!p) continue;
    if (casos == null) {
      sinRespuesta.push(p.corto);
      continue;
    }
    if (casos === 0) {
      sinCasos.push(p.corto);
      continue;
    }
    patrones.push({
      clave, familia: p.familia, nombre: p.nombre, corto: p.corto, severidad: p.severidad, n: casos,
      resumen: `${plural(casos, "caso", "casos")}${p.observacion ? ", en observación" : ""}`,
      contenido: <FichaDeLista clave={clave} p={p} ruc={ruc} etiquetas={etiquetas} />,
    });
  }
  // Los antecedentes: lo que pesa sobre cada contrato. Van todos: el que además es un patrón (mismo dueño, socio de una
  // inhabilitada…) lo dice en su ficha y enlaza a él, en vez de desaparecer de aquí.
  const antecedentes: Entrada[] = d.cruces.map((c) => {
    const info = TIPO_CRUCE[c.tipo] as { corto?: string } | undefined;
    const lista = CRUCE_CON_LISTA[c.tipo];
    const p = lista ? PATRON_LISTA[lista] : undefined;
    const casos = lista ? casosDe.get(lista) ?? 0 : 0;
    return {
      clave: c.tipo, familia: familiaDeCruce(c.tipo), nombre: info?.corto ?? c.etiqueta, corto: chipCruce(c.tipo),
      severidad: c.graves > 0 ? "alta" : c.medias > 0 ? "media" : "baja", n: c.contratos,
      resumen: `${plural(c.contratos, "contrato", "contratos")}${c.graves ? `, ${numero(c.graves)} de señal alta` : ""}`,
      contenido: <FichaDeCruce c={c} ruc={ruc} patron={lista && p && casos > 0 ? { clave: lista, nombre: p.nombre, casos } : undefined} />,
    };
  });
  const tiposPatron = ordenar(patrones);
  const tiposAntecedente = ordenar(antecedentes);

  if (!tiposPatron.length && !tiposAntecedente.length) {
    return (
      <EstadoVacio compacto titulo="Sin patrones ni antecedentes en esta entidad">
        Se buscaron {numero(sinCasos.length)} patrones y los antecedentes de quienes ganaron sus contratos: no hay casos. No significa que todo esté bien:
        significa que estos cruces no encontraron nada con los datos publicados.
      </EstadoVacio>
    );
  }
  // Un enlace de antes del 2026-11-18 nombraba el antecedente como `patron=c-<tipo>`: abre su subpestaña y lo elige.
  const viejo = patron?.startsWith("c-") ? patron.slice(2) : undefined;
  const activa = sub === "patrones" || sub === "antecedentes" ? sub : viejo ? "antecedentes" : tiposPatron.length ? "patrones" : "antecedentes";

  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué es un patrón, qué es un antecedente y cómo leer esta pestaña?">
            <span className="block">
              Un <b>patrón</b> junta varios contratos u órdenes de la entidad: las mismas empresas que parecen competir y no compiten, el mismo
              dueño detrás de varios proveedores, la misma compra repetida, la familia de quien decide.
            </span>
            <span className="mt-1.5 block">
              Un <b>antecedente</b> es de un solo contrato: lo que los registros públicos dicen de quien lo ganó o de cómo se adjudicó (un solo
              postor, una sanción vigente, una empresa recién fundada).
            </span>
            <span className="mt-1.5 block">
              En las dos, arriba van las familias y a la izquierda el índice con cuántos casos hay aquí. Al elegir uno se abre su ficha: qué es,
              sus cifras, sus casos y la fuente. Es un motivo para mirar, no una acusación.
            </span>
          </Ayuda>
        }
      >
        Patrones: lo que se repite entre varios contratos. Antecedentes: lo que pesa sobre cada contrato, por quien lo ganó.
      </CabeceraPestana>
      <Pestanas
        param={PV}
        variante="segunda"
        etiqueta="Patrones o antecedentes"
        activa={activa}
        pestanas={[
          {
            clave: "patrones",
            etiqueta: "Patrones",
            conteo: tiposPatron.length,
            icono: <Repeat2 size={15} aria-hidden />,
            contenido: (
              <div className="space-y-4">
                {tiposPatron.length ? (
                  <>
                    <FamiliasDePatron
                      familias={familiasDe(tiposPatron)}
                      param="patron"
                      uno="patrón con casos"
                      varios="patrones con casos"
                      etiqueta="Familias de patrones con casos en esta entidad"
                    />
                    <IndiceAntecedentes tipos={tiposPatron.map(sinFamilia)} param="patron" titulo={`${plural(tiposPatron.length, "patrón", "patrones")} entre varios contratos`} />
                  </>
                ) : (
                  <EstadoVacio compacto titulo="Sin patrones entre varios contratos">
                    Ninguno de los patrones que se buscan tiene casos en esta entidad. Sus contratos sí tienen antecedentes: están en la otra subpestaña.
                  </EstadoVacio>
                )}
                {(sinCasos.length > 0 || sinRespuesta.length > 0) && (
                  <section className="space-y-2 border-t border-line pt-4" aria-labelledby="patrones-sin-casos">
                    <h3 id="patrones-sin-casos" className="flex items-center gap-1.5 text-cuerpo font-semibold text-ink">
                      <SearchCheck size={15} strokeWidth={1.9} className="text-inkSoft" aria-hidden /> También se buscó, y no hay casos
                    </h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {sinCasos.map((x) => (
                        <li key={x}>
                          <Badge variant="neutral">{x}</Badge>
                        </li>
                      ))}
                    </ul>
                    {sinRespuesta.length > 0 && <p className="text-meta text-mute">No respondieron ahora (no es un cero): {sinRespuesta.join(", ")}.</p>}
                  </section>
                )}
                <p className="text-meta">
                  <Link href="/app/patrones" prefetch={false} className={ENLACE}>
                    Ver todos los patrones, en todo el país
                  </Link>
                </p>
              </div>
            ),
          },
          {
            clave: "antecedentes",
            etiqueta: "Antecedentes",
            conteo: tiposAntecedente.length,
            icono: <FileWarning size={15} aria-hidden />,
            contenido: tiposAntecedente.length ? (
              <div className="space-y-4">
                <FamiliasDePatron
                  familias={familiasDe(tiposAntecedente)}
                  param="antecedente"
                  uno="antecedente"
                  varios="antecedentes"
                  etiqueta="Familias de antecedentes en los contratos de esta entidad"
                />
                <IndiceAntecedentes
                  tipos={tiposAntecedente.map(sinFamilia)}
                  param="antecedente"
                  inicial={viejo}
                  titulo={`${plural(tiposAntecedente.length, "antecedente", "antecedentes")} en sus contratos`}
                />
              </div>
            ) : (
              <EstadoVacio compacto titulo="Sin antecedentes en sus contratos">
                Ninguno de sus contratos tiene un ganador con antecedentes en los registros que cruza Vigía.
              </EstadoVacio>
            ),
          },
        ]}
      />
      <FuenteDato
        fuente="OECE (SEACE, CONOSCE y Registro Nacional de Proveedores), SUNAT, Contraloría, JNE, ONPE y lo que los agentes de Vigía leyeron en sus documentos"
        href={CONTRATACIONES_ABIERTAS}
      />
    </div>
  );
}
