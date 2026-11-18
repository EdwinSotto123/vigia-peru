import dynamic from "next/dynamic";
import Link from "next/link";
import { Search, SearchCheck } from "lucide-react";
import { IndiceAntecedentes, type TipoDelIndice } from "@/components/empresas/secciones/IndiceAntecedentes";
import { Indicadores } from "@/components/listado";
import { Ayuda, CabeceraPestana, EstadoVacio, FuenteDato, Nota } from "@/components/patrones";
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
import { cn } from "@/lib/utils";

/**
 * La pestaña «Patrones» de la ficha de una entidad (pedido del usuario del 2026-11-18): un índice de TODO lo que se repite
 * en ella, por familias (concertación, compras partidas, familia y política, sanciones, sus documentos), y la ficha del
 * patrón elegido. Antes eran banderas sueltas en la cabecera y listas filtradas: nada decía «aquí hay concertación».
 *
 * Dos clases de ficha:
 *   · De una lista de /app/patrones (mismo dueño, grupos, compras repetidas, compras y familia…): la misma lista, con el RUC
 *     de la entidad ya puesto; cada fila abre su panel con la evidencia.
 *   · De un antecedente de quienes ganaron sus contratos (postor único, socio común entre postores, rival que fue su
 *     socia, fraccionamiento…): sus cifras, los contratos de más peso y el enlace a todos, filtrados en su lista de compras.
 * El elegido va a la URL (`?patron=`): las banderas de la cabecera enlazan al suyo.
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
function FichaDeCruce({ c, ruc }: { c: PatronesDeEntidad["cruces"][number]; ruc: string }) {
  const info = TIPO_CRUCE[c.tipo] as { corto?: string; explica?: string } | undefined;
  const ejemplos = c.ejemplos ?? [];
  const repiten = c.repiten ?? [];
  return (
    <div className="space-y-4">
      <CabeceraFicha familia={familiaDeCruce(c.tipo)} />
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

export async function PatronesEntidad({ ruc }: { ruc: string }) {
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

  const casosDe = new Map(d.listas.map((x) => [x.clave, x.casos]));
  type Entrada = TipoDelIndice & { familia: FamiliaPatron };
  const entradas: Entrada[] = [];
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
    entradas.push({
      clave, familia: p.familia, nombre: p.nombre, corto: p.corto, severidad: p.severidad, n: casos,
      resumen: `${plural(casos, "caso", "casos")}${p.observacion ? ", en observación" : ""}`,
      contenido: <FichaDeLista clave={clave} p={p} ruc={ruc} etiquetas={etiquetas} />,
    });
  }
  for (const c of d.cruces) {
    // Si el patrón ya tiene su lista con casos (mismo dueño, socio de inhabilitada…), el antecedente no se repite.
    const lista = CRUCE_CON_LISTA[c.tipo];
    if (lista && (casosDe.get(lista) ?? 0) > 0) continue;
    const info = TIPO_CRUCE[c.tipo] as { corto?: string } | undefined;
    entradas.push({
      clave: `c-${c.tipo}`, familia: familiaDeCruce(c.tipo), nombre: info?.corto ?? c.etiqueta, corto: chipCruce(c.tipo),
      severidad: c.graves > 0 ? "alta" : c.medias > 0 ? "media" : "baja", n: c.contratos,
      resumen: `${plural(c.contratos, "contrato", "contratos")}${c.graves ? `, ${numero(c.graves)} de señal alta` : ""}`,
      contenido: <FichaDeCruce c={c} ruc={ruc} />,
    });
  }
  // Por familia (en su orden), lo grave primero y, dentro, lo que más casos tiene.
  const orden = new Map(FAMILIAS_PATRON.map((f, i) => [f.clave, i]));
  entradas.sort((a, b) => (orden.get(a.familia)! - orden.get(b.familia)!) || PESO[a.severidad] - PESO[b.severidad] || b.n - a.n);
  const tipos: TipoDelIndice[] = entradas.map(({ familia, ...t }) => ({ ...t, grupo: FAMILIAS_PATRON.find((f) => f.clave === familia)?.nombre }));

  if (!tipos.length) {
    return (
      <EstadoVacio compacto titulo="Sin patrones en esta entidad">
        Se buscaron {numero(sinCasos.length)} patrones y los antecedentes de quienes ganaron sus contratos: no hay casos. No significa que todo esté bien:
        significa que estos cruces no encontraron nada con los datos publicados.
      </EstadoVacio>
    );
  }
  const familias = FAMILIAS_PATRON.map((f) => {
    const suyas = entradas.filter((e) => e.familia === f.clave);
    return { ...f, patrones: suyas.length, graves: suyas.filter((e) => e.severidad === "alta").length, primera: suyas[0]?.clave };
  }).filter((f) => f.patrones > 0);

  return (
    <div className="space-y-5">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué es un patrón y cómo leer esta pestaña?">
            <span className="block">
              Una señal sola puede ser casualidad. Aquí está lo que <b>se repite</b> en la entidad, ordenado por familias: empresas que parecen
              competir y no compiten, compras partidas o repetidas, familia y política, proveedores con sanción y lo que los agentes leyeron en
              sus documentos.
            </span>
            <span className="mt-1.5 block">
              A la izquierda, cada patrón con cuántos casos tiene aquí. Al elegir uno se abre su ficha: qué es, sus cifras, sus casos (cada fila
              abre la evidencia) y la fuente.
            </span>
            <span className="mt-1.5 block">Un patrón es un motivo para mirar, no una acusación.</span>
          </Ayuda>
        }
      >
        Lo que se repite en esta entidad, por familias. Elige un patrón para ver su ficha, con sus casos y su evidencia.
      </CabeceraPestana>
      {/* Las familias, todas (la franja de cifras muestra cuatro como mucho): cada una lleva a su primer patrón. */}
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Familias de patrones con casos en esta entidad">
        {familias.map((f) => (
          <li key={f.clave}>
            <Link
              href={`/entidad/${ruc}?seccion=patrones&patron=${encodeURIComponent(f.primera ?? "")}`}
              scroll={false}
              prefetch={false}
              title={f.explica}
              className="block h-full rounded-xl border border-line bg-paper px-3 py-2.5 transition-colors hover:border-granate/40 hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
            >
              <span className="block text-meta font-medium text-inkSoft">{f.corto}</span>
              <span className="mt-0.5 flex items-baseline gap-1.5">
                <span className={cn("font-display text-seccion font-bold tabular-nums", f.graves ? "text-crimsonTexto" : "text-ink")}>{numero(f.patrones)}</span>
                <span className="text-rotulo text-mute">{f.patrones === 1 ? "patrón con casos" : "patrones con casos"}</span>
              </span>
              <span className="mt-0.5 block text-rotulo text-mute">{f.graves ? `${numero(f.graves)} de señal alta` : "ninguno de señal alta"}</span>
            </Link>
          </li>
        ))}
      </ul>
      <IndiceAntecedentes tipos={tipos} param="patron" titulo={`${plural(tipos.length, "patrón con casos", "patrones con casos")} en esta entidad`} />
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
      <FuenteDato
        fuente="OECE (SEACE, CONOSCE y Registro Nacional de Proveedores), SUNAT, Contraloría, JNE, ONPE y lo que los agentes de Vigía leyeron en sus documentos"
        href={CONTRATACIONES_ABIERTAS}
      />
      <p className="text-meta">
        <Link href="/app/patrones" prefetch={false} className={ENLACE}>
          Ver todos los patrones, en todo el país
        </Link>
      </p>
    </div>
  );
}
