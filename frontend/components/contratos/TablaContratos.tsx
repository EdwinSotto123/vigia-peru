"use client";

/**
 * Los resultados de /app/contratos sobre la plantilla Listado (DESIGN_SYSTEM.md §14.1):
 * paginación arriba a la derecha y abajo, la `Tabla` del kit y los estados vacío y
 * error. Anatomía de fila, la de todos los listados:
 *
 *   estado (chip y, si lo hay, «posible error de carga») | objeto + entidad, zona y partido con su ícono | tipo y
 *   etapa | valor referencial | convocada | ›
 *
 * La fila abre el resumen del contrato en el panel lateral (`detalle`) y no navega: el
 * panel dice su estado de lectura, qué falta y cómo financiarlo con los datos que la
 * fila ya trae, sin pedir el dossier (pesado) de un contrato que casi siempre está sin
 * leer. El dossier queda en el pie del panel. Una sola acción por fila.
 *
 * El panel es también donde se elige una entidad («Ver sólo los contratos de esta entidad», con los demás filtros): son
 * miles y la barra sólo tiene desplegables nativos; elegida, queda en «Filtros» con su nombre y su ×.
 *
 * Componente cliente porque usa `estadoLecturaDe` (módulo cliente): llamada desde un
 * server component sería una referencia, no una función.
 *
 * También es la lista de contratos de la ficha de una entidad (/entidad/[ruc]): con `ruta` y `ancla` los enlaces de
 * página y "quitar filtros" se quedan en esa ficha, y con `deEntidad` la fila dice quién ganó en vez de repetir la
 * entidad en cada fila.
 *
 * Paginación: por cursor cuando el API lo trae (`siguiente`/`anterior`, tokens opacos que
 * van a la URL como `?cursor=` / `?antes=`), con "Anterior / Siguiente" y sin números de
 * página inventados. COMPAT-API-VIEJA: sin la clave `siguiente` en la respuesta, pagina
 * por número (`Paginacion` con `paramPagina="page"`), como antes.
 */

import Link from "next/link";
import { ArrowRight, Award, Flag, ListFilter } from "lucide-react";
import { Paginacion } from "@/components/ui/Paginacion";
import { PaginacionCursor } from "@/components/ui/PaginacionCursor";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { Llamita } from "@/components/marca/Llamita";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, TablaSkeleton, type Columna, type Fila, type Parametros } from "@/components/listado";
import { numero, oracion, plural } from "@/lib/formato";
import { severidadDeContrato } from "@/lib/severidad";
import { esPersonaNatural, etapaLabel, formatFecha, formatMonto, tipoLabel, totalContratosTexto, type ContratoResumen, type ContratosPagina } from "@/lib/contratos";
import { PersonName } from "@/components/Redact";
import { DetalleContrato } from "./DetalleContrato";
import { CrucesCelda } from "./CrucesCelda";
import { PartidoQueGobierna } from "./PartidoQueGobierna";
import { EstadoContratoChip, estadoLecturaDe } from "./estadoLectura";
import { recortar, limpiarObjeto } from "./recortar";
import { tituloNatural } from "@/lib/landing";
import { Dato } from "@/components/ui/Dato";
import { AvisoContrato, ConBanderaDato } from "./DatoDudosoContrato";
import { CLASE_ACCION_LISTA, EnlaceAccion } from "@/components/ui/EnlaceAccion";

import { urlDesde, conDesde } from "@/lib/desde";

const RUTA = "/app/contratos";

const COLUMNAS: Columna[] = [
  {
    clave: "estado", desde: "md", apilar: true,
    titulo: "Estado",
    // Lo justo para «Riesgo medio», la pastilla más ancha que no se recorta: el resto del ancho es del objeto.
    ancho: "120px",
    // Reemplaza a las dos leyendas que iban al pie de la tabla vieja: el vocabulario, a un clic.
    ayuda: (
      <Ayuda titulo="¿Qué dice el estado?">
        <span className="block">
          Si el contrato ya se leyó, su peso del riesgo: alto, medio o bajo según el puntaje de sus señales; «Sin
          señales» si no se encontró ninguna; «En revisión» mientras una persona revisa el dictamen.
        </span>
        <span className="mt-2 block">
          Si todavía no se leyó, en qué punto está: «En cola» se puede financiar hoy; «Docs listos» tiene el expediente
          descargado y su análisis en preparación; «Sin leer», ninguna de las dos.
        </span>
      </Ayuda>
    ),
  },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1.6fr)" },
  {
    clave: "cruces", titulo: "Antecedentes del ganador", corto: "Antecedentes", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Qué son estos antecedentes?">
        <span className="block">
          Datos oficiales donde aparece quien ganó (o sus socios y representantes): aportes y gastos de campaña (ONPE),
          candidaturas y autoridades (JNE), sanciones y penalidades, visitas a entidades, socios comunes con otros postores y
          órdenes del mismo día que juntas pasan 8 UIT (CONOSCE). No prueban una irregularidad: el dossier trae cada uno con
          su fuente.
        </span>
        <span className="mt-2 block">
          Con el filtro «Datos de la empresa ganadora», la fila muestra además ese dato de la empresa (su estado de hoy en la
          SUNAT, o un hecho de su gente): es de la empresa, no de este contrato.
        </span>
      </Ayuda>
    ),
  },
  { clave: "tipo", titulo: "Tipo y etapa", ancho: "minmax(0,0.6fr)", desde: "xl" },
  // En el celular, el valor y la fecha se apilan con su rótulo: son lo que pregunta el vecino (antes desaparecían).
  { clave: "valor", titulo: "Valor referencial", corto: "Valor", ancho: "128px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "convocada", titulo: "Convocada", ancho: "96px", desde: "lg", apilar: "con-rotulo" },
];

export function TablaContratos({
  pagina,
  parametros,
  actual,
  cursor,
  antes,
  tam,
  ruta = RUTA,
  ancla,
  deEntidad = false,
}: {
  /** La página que trajo el servidor; `null` = el API no respondió. */
  pagina: ContratosPagina | null;
  /** Los filtros actuales de la URL (sin página ni cursor), para armar los enlaces de página. */
  parametros: Parametros;
  actual: number;
  /** El cursor con el que se pidió esta página (`?cursor=` o `?antes=`), si vino por cursor. */
  cursor?: string;
  antes?: string;
  tam: number;
  /** Dónde vive la lista (los enlaces de página y de "quitar filtros" vuelven ahí). */
  ruta?: string;
  /** Id de la sección a la que vuelve cada enlace de página (la ficha de la entidad es larga). */
  ancla?: string;
  /** La lista de UNA entidad: la fila dice quién ganó en vez de la entidad y su zona. */
  deEntidad?: boolean;
}) {
  const hash = ancla ? `#${ancla}` : "";
  // De dónde vino el usuario (esta lista con sus filtros), para las migas de la ficha y para que "volver" la restaure.
  const desde = urlDesde(ruta, parametros);
  /** Los filtros de la URL más un paso de paginación (página por número o token de cursor). */
  const hrefCon = (paso: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(paso)) q.set(k, v);
    const qs = q.toString();
    return `${qs ? `${ruta}?${qs}` : ruta}${hash}`;
  };
  const href = (n: number) => hrefCon(n > 1 ? { page: String(n) } : {});
  // Esta misma página, tal como se pidió (para reintentar sin perder el lugar).
  const hrefActual = cursor ? hrefCon({ cursor }) : antes ? hrefCon({ antes }) : href(actual);
  // El orden no recorta la lista: sólo los demás parámetros cuentan como filtro.
  const filtrado = Object.entries(parametros).some(([k, v]) => k !== "orden" && !!v);

  if (!pagina) {
    return (
      <EstadoError
        titulo="No pudimos cargar la lista de contratos"
        // `<a>` y no `<Link>`: reintentar es pedir la página de nuevo al servidor, con los mismos filtros.
        accion={<a href={hrefActual} className={ACCION}>Reintentar</a>}
      >
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }

  const { total, data } = pagina;
  const paginas = Math.max(1, Math.ceil(total / tam));
  // COMPAT-API-VIEJA: la API vieja no manda `siguiente`; entonces se pagina por número.
  const porCursor = "siguiente" in pagina;

  if (total === 0) {
    return filtrado ? (
      <EstadoVacio titulo="Ningún contrato coincide con tu búsqueda" compacto accion={<Link href={`${ruta}${hash}`} scroll={!ancla} className={ACCION}>Quitar búsqueda y filtros</Link>}>
        Prueba otra palabra del objeto, el código o la entidad. Si usas filtros, se suman: quita el más restrictivo.
      </EstadoVacio>
    ) : (
      <EstadoVacio titulo={deEntidad ? "Todavía no hay contratos de esta entidad en la base" : "Todavía no hay contratos en la base"}>
        Las convocatorias del SEACE aparecen aquí cuando entran a la base de Vigía.
      </EstadoVacio>
    );
  }

  // Un cursor viejo (la lista cambió desde que se copió el enlace): hay contratos, sólo que
  // esa página ya no existe. Se vuelve al principio, no se dice "no hay contratos".
  if (porCursor && data.length === 0) {
    return (
      <EstadoVacio compacto titulo="Esta página de la lista ya no está disponible" accion={<Link href={href(1)} prefetch={false} className={ACCION}>Ir al principio de la lista</Link>}>
        Hay {totalContratosTexto(pagina)} {total === 1 ? "contrato" : "contratos"}{filtrado ? " con estos filtros" : ""}.
      </EstadoVacio>
    );
  }

  // ?page=999 con 368 páginas: hay contratos, sólo que no tantos. "No hay contratos" sería falso.
  if (data.length === 0) {
    return (
      <EstadoVacio
        compacto
        titulo={`Esta página no existe: la lista llega hasta la página ${numero(paginas)}`}
        accion={<Link href={href(paginas)} prefetch={false} className={ACCION}>Ir a la última página</Link>}
      >
        Hay {plural(total, "contrato", "contratos")}
        {filtrado ? " con estos filtros" : ""}, {tam} por página.
      </EstadoVacio>
    );
  }

  // El de abajo lleva `subir`: al cambiar de página vuelve al inicio de los resultados, no al pie de la siguiente.
  let pag: (subir: boolean) => React.ReactNode;
  if (porCursor) {
    // Primera página: se sabe el rango ("1–50 de 18,393"). Después, sólo cuántos se ven
    // de cuántos ("50 contratos de 18,393"; un "50 de 18,393" a secas se leía como el n.º 50):
    // con un cursor no hay número de página que decir.
    // Por la URL, no por la respuesta: con cursor el API puede no mandar `page`.
    const primera = !cursor && !antes && actual <= 1;
    const texto = `${primera ? `1–${numero(data.length)}` : plural(data.length, "contrato", "contratos")} de ${totalContratosTexto(pagina)}`;
    pag = (subir) => (
      <PaginacionCursor
        texto={texto}
        anterior={!primera && pagina.anterior ? hrefCon({ antes: pagina.anterior }) : null}
        siguiente={pagina.siguiente ? hrefCon({ cursor: pagina.siguiente }) : null}
        subir={subir}
      />
    );
  } else {
    pag = (subir) => (
      <Paginacion actual={pagina.page || actual} paginas={paginas} total={total} tam={tam} navegacion="url" hrefBase={ruta} query={parametros} paramPagina="page" cargando={false} nombre="contratos" subir={subir} />
    );
  }
  // «Sólo los de esta entidad» en el panel: la misma lista con sus filtros, más la entidad (que queda en Filtros, con su ×).
  // No en la ficha de una entidad (ya es su lista) ni si la entidad ya es el filtro.
  const hrefEntidad = (ruc: string | null) => (!deEntidad && ruc && parametros.entidad !== ruc ? hrefCon({ entidad: ruc }) : null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={data.map((c) => filaDe(c, deEntidad, desde, hrefEntidad(c.entidadRuc), parametros.ganadora))} etiqueta="Contratos" />
      <div className="flex justify-end">{pag(true)}</div>
    </div>
  );
}

/**
 * Los antecedentes de la fila y, si la lista filtra por un dato de la empresa ganadora (`?ganadora=`), ese dato: así se
 * ve por qué está el contrato en la lista. Sin ese filtro no van (son de la empresa, no del contrato: migración 115).
 */
function crucesDeFila(c: ContratoResumen, datoGanadora?: string) {
  const deLaEmpresa = datoGanadora ? (c.datosGanadora ?? []).filter((d) => d.tipo === datoGanadora) : [];
  return deLaEmpresa.length ? [...deLaEmpresa, ...(c.cruces ?? [])] : c.cruces;
}

function filaDe(c: ContratoResumen, deEntidad: boolean, desde?: string, soloEntidad?: string | null, datoGanadora?: string): Fila {
  // En oración, como los procesos y el presupuesto: el SEACE manda casi todo en mayúsculas.
  const titulo = c.titulo ? oracion(limpiarObjeto(c.titulo)) : "Sin objeto registrado";
  // Con su nombre propio, como en su ficha ("Seguro Social de Salud"), no en las mayúsculas del SEACE.
  const entidad = c.entidad ? tituloNatural(c.entidad) : "Entidad no identificada";
  const monto = formatMonto(c.montoPen, c.moneda);
  // Lo mismo que dice el chip: el peso del riesgo si ya se leyó, si no, el estado de lectura.
  const estado = c.enRevision || c.score != null ? severidadDeContrato(c).etiqueta : estadoLecturaDe(c).label;
  // El peso del riesgo nunca va sin las señales que lo explican (§10.4): la meta dice cuántas hay.
  const nSenales = c.enRevision ? 0 : c.banderas ?? 0;
  // En la ficha de una entidad, la entidad y su zona son las mismas en todas las filas: va quién ganó.
  const ganador = c.proveedor ? (
    <Dato key="ganador" icono={Award} nombre="Ganador">
      Ganó {esPersonaNatural(c.proveedorRuc) ? <PersonName name={c.proveedor} orden="sunat" /> : c.proveedor}
    </Dato>
  ) : null;
  // El partido que gobernaba la entidad cuando se convocó, con su ícono (sin él, las entidades nacionales).
  const partido = c.gobierno ? <PartidoQueGobierna key="partido" g={c.gobierno} /> : null;
  const senales = nSenales > 0 ? <Dato key="senales" icono={Flag} nombre="Señales">{plural(nSenales, "señal", "señales")}</Dato> : null;
  // Cada dato con su ícono: la entidad, el lugar y el partido no se confunden entre sí.
  const meta = deEntidad
    ? [senales, partido, ganador]
    : [senales, <Dato key="entidad" tipo="entidad">{entidad}</Dato>, c.zona ? <Dato key="zona" tipo="lugar">{c.zona}</Dato> : null, partido];
  return {
    id: c.ocid,
    celdas: {
      estado: (
        <ConBanderaDato dato={c.datoDudoso}>
          <EstadoContratoChip c={c} />
        </ConBanderaDato>
      ),
      // Recortado en una palabra: el objeto entero va en el panel (títulos de 300 caracteres en el DOM). Dos líneas en
      // escritorio (tres en el celular): «qué se compra» es el dato de la fila, y en una línea se cortaba a ~30 letras.
      contrato: <CeldaPrincipal titulo={recortar(titulo, 160)} meta={meta} dosLineas />,
      cruces: <CrucesCelda cruces={crucesDeFila(c, datoGanadora)} sinGanador={!c.proveedor} />,
      tipo: <CeldaTexto sub={etapaLabel(c.etapa) ?? undefined}>{tipoLabel(c.tipo) ?? "Sin clasificar"}</CeldaTexto>,
      valor: <CeldaNumero>{c.montoPen ? monto : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      convocada: <CeldaFecha fecha={c.fecha?.slice(0, 10)} />,
    },
    detalle: {
      titulo,
      etiqueta: [
        `Ver el resumen de ${titulo}`,
        entidad,
        c.montoPen ? monto : "sin valor referencial publicado",
        `estado: ${estado}`,
      ].join(". "),
      descripcion: (
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono">{c.codigo}</span>
          {c.fecha && <span className="tabular-nums">Convocada el {formatFecha(c.fecha)}</span>}
          {c.zona && <span>{c.zona}</span>}
        </span>
      ),
      contenido: (
        <div className="space-y-4">
          <AvisoContrato dato={c.datoDudoso} />
          <DetalleContrato c={c} />
          {soloEntidad && (
            <EnlaceAccion href={soloEntidad} prefetch={false} variante="secundario">
              <ListFilter size={15} aria-hidden />
              Ver sólo los contratos de esta entidad
            </EnlaceAccion>
          )}
        </div>
      ),
      pie: (
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-rotulo text-mute">Fuente: SEACE/OECE, vía la API OCDS</span>
          <Link
            href={conDesde(`${RUTA}/${encodeURIComponent(c.ocid)}`, desde)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-1.5 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
          >
            Ver el dossier completo <ArrowRight size={14} aria-hidden />
          </Link>
        </span>
      ),
    },
  };
}

/** Mientras llega la primera página: la misma rejilla, sin saltos cuando entran los datos. */
export function TablaContratosSkeleton() {
  return <TablaSkeleton columnas={COLUMNAS} filas={10} />;
}

/**
 * La espera de la lista en /app/contratos (§10.5): la rejilla en esqueleto y, en el renglón del paginador, qué se espera
 * con la llamita caminando, que aparece pasado 1 s (una carga corta no necesita aviso; una con cruces o un texto amplio
 * tarda varios segundos y el esqueleto mudo parecía colgado). Sin JS ni movimiento, igual se ve: la demora es de CSS.
 */
export function TablaContratosCargando({ texto = "Cargando los contratos…" }: { texto?: string }) {
  return (
    <div className="space-y-3" role="status" aria-busy>
      <p className="flex min-h-[44px] items-center gap-2.5 text-dato text-mute animate-[fadeIn_200ms_ease-out_1s_both] sm:min-h-[36px]">
        <Llamita caminando className="w-6 text-granate/70" />
        {texto}
      </p>
      <TablaSkeleton columnas={COLUMNAS} filas={10} />
    </div>
  );
}

const ACCION = CLASE_ACCION_LISTA;
