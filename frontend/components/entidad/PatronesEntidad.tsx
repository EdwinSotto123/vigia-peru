import dynamic from "next/dynamic";
import Link from "next/link";
import { FileWarning, Repeat2, SearchCheck } from "lucide-react";
import { IndiceAntecedentes, type TipoDelIndice } from "@/components/empresas/secciones/IndiceAntecedentes";
import { Indicadores } from "@/components/listado";
import { Ayuda, EstadoVacio, FuenteDato, Nota, Pestanas } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TIPO_CRUCE, chipCruce } from "@/lib/cruces";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { CONOSCE_BUSCADOR, CONTRATACIONES_ABIERTAS, DATASET_SOCIOS_RNP } from "@/lib/fuentes";
import { getPatronesDeEntidad, type PatronesDeEntidad, type SeccionPatrones } from "@/lib/patrones";
import {
  CRUCE_CON_LISTA,
  FAMILIAS_PATRON,
  PATRON_LISTA,
  familiaDeCruce,
  indicePorFamilia,
  primeraOracion,
  seriesDeFamilias,
  type EntradaConFamilia,
  type FamiliaPatron,
  type PatronDeLista,
} from "@/lib/patronesEntidad";
import { etiquetaRegla, getCatalogoReglas, type CatalogoReglas } from "@/lib/revision";
import { AntecedenteEnEntidad } from "./AntecedenteEnEntidad";
import { EnIndice } from "./FamiliasDePatron";

/**
 * La pestaña «Antecedentes y patrones» de la ficha de una entidad (pedidos del usuario del 2026-11-18). Son DOS
 * subpestañas, porque son dos cosas («antecedente sería del contrato, mientras patrones es de varios contratos») y nunca
 * se mezclan en un mismo índice:
 *
 *   · Patrones (`?pv=patrones`, `?patron=`): lo que se repite ENTRE VARIOS contratos u órdenes. Cada uno es una lista de
 *     /app/patrones (mismo dueño, grupos, compras repetidas, compras y familia…) con el RUC de la entidad ya puesto; cada
 *     fila abre su panel con la evidencia.
 *   · Antecedentes (`?pv=antecedentes`, `?antecedente=`): lo que pesa sobre CADA contrato, por quien lo ganó o por cómo se
 *     adjudicó (postor único, sanción vigente, socio común entre postores…): sus cifras, año por año, quiénes lo tienen
 *     y TODOS sus contratos, con buscador (`AntecedenteEnEntidad`, que se pide al elegirlo).
 *
 * Cada subpestaña abre con un FILTRO (IndiceAntecedentes: un botón por patrón o antecedente, agrupados por familia con su
 * total; el 2026-11-23 reemplazó al reparto por familia y al índice del costado, que decían lo mismo dos veces). Antes: (`RepartoFamilias`: una barra a todo el ancho y una
 * celda por familia con sus casos y lo grave; antes, cinco cajitas que sólo decían «2 patrones con casos») y sigue con el
 * índice (ícono de severidad, cifra y barra, agrupado por familia con su color) y la ficha del elegido. Las banderas de la
 * cabecera enlazan a su patrón (`?seccion=patrones&patron=`).
 *
 * La lista de cada patrón va en un trozo aparte (dynamic): carga todas las listas y su panel de detalle, que pesan.
 */
const ListaDePatron = dynamic(() => import("@/components/investigar/PatronesVista").then((m) => m.ListaDePatron));

const ENLACE = "font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate";

/** Arriba de cada ficha: su familia y, si nace en observación, que todavía no cuenta para el puntaje. */
function CabeceraFicha({ familia, observacion }: { familia: FamiliaPatron; observacion?: boolean }) {
  const f = FAMILIAS_PATRON.find((x) => x.clave === familia);
  return (
    <p className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral">{f?.nombre ?? "Patrón"}</Badge>
      {observacion ? <Badge variant="amber">En observación: todavía no cuenta para el puntaje</Badge> : null}
    </p>
  );
}

/**
 * La ficha de un patrón que tiene su lista: la lista con el RUC de la entidad, qué mirar y dónde verlo en todo el país. Su
 * nombre es lo más grande de la columna y su severidad y su familia van DEBAJO de lo que es (antes, una pastilla con la
 * familia encima del título: «no tiene forma ni jerarquía», 2026-11-23).
 */
function FichaDeLista({ clave, p, ruc, etiquetas, serie }: { clave: SeccionPatrones; p: PatronDeLista; ruc: string; etiquetas: Record<string, string>; serie?: number }) {
  const familia = FAMILIAS_PATRON.find((x) => x.clave === p.familia)?.nombre;
  return (
    <div className="space-y-5">
      <ListaDePatron
        clave={clave}
        ruc={ruc}
        titulo={p.nombre}
        etiquetas={etiquetas}
        vista="entidad"
        destacado={{ severidad: p.severidad, familia, serie, observacion: p.observacion }}
      />
      <Nota>
        <b className="font-semibold text-ink">Qué conviene mirar.</b> {p.mirar}{" "}
        <Link href={`/app/patrones?seccion=${clave}`} prefetch={false} className={ENLACE}>
          Ver este patrón en todas las entidades
        </Link>
      </Nota>
    </div>
  );
}

/**
 * La ficha de un antecedente de sus contratos: qué es (su nombre y una oración; lo demás en su ⓘ), sus cifras en franja
 * (contratos, de señal alta con su parte, cuánto suman, cuántos proveedores) y lo que cuenta `AntecedenteEnEntidad`: año
 * por año, quiénes y todos sus contratos. Al pie, el mismo filtro en Compras (con sus demás filtros) y la fuente.
 */
function FichaDeCruce({ c, ruc, patron }: { c: PatronesDeEntidad["cruces"][number]; ruc: string; patron?: { clave: SeccionPatrones; nombre: string; casos: number } }) {
  const info = TIPO_CRUCE[c.tipo] as { corto?: string; explica?: string } | undefined;
  const nombre = info?.corto ?? c.etiqueta;
  const bajada = primeraOracion(info?.explica);
  return (
    <div className="space-y-5">
      {/* Como la de un patrón: el nombre manda y la familia va debajo de lo que es, no encima del título. */}
      <div>
        <div className="flex items-start gap-1.5">
          <h3 className="font-display text-seccion font-bold leading-[1.15] tracking-[-0.01em] text-ink text-balance sm:text-cifra">{nombre}</h3>
          {info?.explica && (
            <Ayuda titulo="¿Qué quiere decir?" etiqueta={`Qué quiere decir «${nombre}»`} className="mt-0.5 shrink-0 sm:mt-1.5">
              {info.explica}
            </Ayuda>
          )}
        </div>
        {bajada && <p className="mt-2 max-w-[65ch] text-cuerpo leading-relaxed text-inkSoft text-pretty">{bajada}</p>}
        <div className="mt-3">
          <CabeceraFicha familia={familiaDeCruce(c.tipo)} />
        </div>
      </div>
      <Indicadores
        franja
        items={[
          { valor: numero(c.contratos), etiqueta: c.contratos === 1 ? "contrato de la entidad" : "contratos de la entidad", contexto: "su ganador tiene este antecedente", parte: null },
          {
            valor: numero(c.graves),
            etiqueta: "de señal alta",
            contexto: c.graves ? `de ${numero(c.contratos)}: van primero en la lista` : "ninguno de señal alta",
            tono: c.graves ? "alta" : "neutro",
            parte: c.contratos ? c.graves / c.contratos : null,
          },
          { valor: solesCompacto(c.monto), etiqueta: "suman esos contratos", contexto: "por el monto adjudicado", parte: null },
          {
            valor: numero(c.empresas),
            etiqueta: c.empresas === 1 ? "proveedor" : "proveedores distintos",
            contexto: (c.repiten ?? []).length ? "algunos lo repiten: abajo, quiénes" : "cada uno con su contrato",
            parte: null,
          },
        ]}
      />
      {patron ? (
        <Nota>
          <b className="font-semibold text-ink">También es un patrón.</b> Entre varios contratos de la entidad se repite{" "}
          <EnIndice param="patron" valor={patron.clave} pestana={{ param: "pv", clave: "patrones" }} className={ENLACE}>
            {patron.nombre.charAt(0).toLowerCase() + patron.nombre.slice(1)} ({plural(patron.casos, "caso", "casos")})
          </EnIndice>
          : ahí están juntos, con su evidencia.
        </Nota>
      ) : null}
      <AntecedenteEnEntidad ruc={ruc} tipo={c.tipo} nombre={nombre} contratos={c.contratos} graves={c.graves} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
        <EnlaceAccion href={`/entidad/${ruc}?seccion=contratos&vista=contratos&cruce=${encodeURIComponent(c.tipo)}`} prefetch={false} variante="secundario" flecha>
          {c.contratos === 1 ? "Verlo en sus compras" : "Verlos en sus compras, con más filtros"}
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
    </div>
  );
}

const PV = "pv";

const AYUDA_GENERAL = (
  <Ayuda titulo="¿Qué es un patrón, qué es un antecedente y cómo leer esta pestaña?">
    <span className="block">
      Un <b>patrón</b> junta varios contratos u órdenes de la entidad: las mismas empresas que parecen competir y no compiten, el mismo dueño detrás de
      varios proveedores, la misma compra repetida, la familia de quien decide.
    </span>
    <span className="mt-1.5 block">
      Un <b>antecedente</b> es de un solo contrato: lo que los registros públicos dicen de quien lo ganó o de cómo se adjudicó (un solo postor, una sanción
      vigente, una empresa recién fundada).
    </span>
    <span className="mt-1.5 block">
      En las dos, arriba va cómo se reparten por familia y a la izquierda el índice con cuántos casos hay aquí. Al elegir uno se abre su ficha: qué es, sus
      cifras, sus casos y la fuente. Es un motivo para mirar, no una acusación.
    </span>
  </Ayuda>
);
type Entrada = TipoDelIndice & EntradaConFamilia;

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
  // El color de cada familia (el del reparto y el índice), para la ficha de cada patrón.
  const series = seriesDeFamilias(
    d.listas.flatMap(({ clave, casos }): EntradaConFamilia[] => {
      const p = PATRON_LISTA[clave];
      return p && casos ? [{ clave, familia: p.familia, severidad: p.severidad, n: casos }] : [];
    }),
  );
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
      contenido: <FichaDeLista clave={clave} p={p} ruc={ruc} etiquetas={etiquetas} serie={series.get(p.familia)} />,
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
      severidad: c.graves > 0 ? "alta" : c.medias > 0 ? "media" : "baja", n: c.contratos, graves: c.graves,
      resumen: `${plural(c.contratos, "contrato", "contratos")}${c.graves ? `, ${numero(c.graves)} de señal alta` : ""}`,
      contenido: <FichaDeCruce c={c} ruc={ruc} patron={lista && p && casos > 0 ? { clave: lista, nombre: p.nombre, casos } : undefined} />,
    };
  });
  const tiposPatron: TipoDelIndice[] = indicePorFamilia(patrones);
  const tiposAntecedente: TipoDelIndice[] = indicePorFamilia(antecedentes);

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
      {/* El nombre de la pestaña ya está en la barra: aquí no se repite a la vista (2026-11-23, «no tiene forma ni
          jerarquía»). Lo que era su línea de explicación va en cada subpestaña (`pista`) y la ayuda, al pie. */}
      <h2 className="sr-only">Antecedentes y patrones</h2>
      <Pestanas
        param={PV}
        variante="segunda"
        etiqueta="Patrones o antecedentes"
        activa={activa}
        pestanas={[
          {
            clave: "patrones",
            etiqueta: "Patrones",
            pista: "Lo que se repite entre varios contratos",
            conteo: tiposPatron.length,
            icono: <Repeat2 size={15} aria-hidden />,
            contenido: (
              <div className="space-y-4">
                {tiposPatron.length ? (
                  <>
                    <IndiceAntecedentes
                      tipos={tiposPatron}
                      param="patron"
                      que="Patrón"
                      columna="Casos"
                      titulo={`${plural(tiposPatron.length, "patrón", "patrones")} entre varios contratos`}
                    />
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
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
                    <span className="inline-flex items-center gap-1">
                      Un patrón es un motivo para mirar, no una acusación.
                      {AYUDA_GENERAL}
                    </span>
                    <Link href="/app/patrones" prefetch={false} className={ENLACE}>
                      Ver todos los patrones, en todo el país
                    </Link>
                  </p>
                  <FuenteDato
                    fuente="OECE (SEACE, CONOSCE y Registro Nacional de Proveedores), SUNAT, Contraloría, JNE, ONPE y lo que los agentes de Vigía leyeron en sus documentos"
                    href={CONTRATACIONES_ABIERTAS}
                  />
                </div>
              </div>
            ),
          },
          {
            clave: "antecedentes",
            etiqueta: "Antecedentes",
            pista: "Lo que pesa sobre cada contrato",
            conteo: tiposAntecedente.length,
            icono: <FileWarning size={15} aria-hidden />,
            contenido: tiposAntecedente.length ? (
              <div className="space-y-4">
                <IndiceAntecedentes
                  tipos={tiposAntecedente}
                  param="antecedente"
                  inicial={viejo}
                  que="Antecedente"
                  columna="Contratos"
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
    </div>
  );
}
