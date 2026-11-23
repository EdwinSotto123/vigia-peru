import { Building2, CalendarRange, CloudOff, History, List, Siren } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Nota, Pestanas, type Pestana } from "@/components/patrones";
import { PieFuentes } from "@/components/entidad/PieFuentes";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { fechaConAnio, numero, solesCompacto } from "@/lib/formato";
import { getHistoria, type Carril, type Historia } from "@/lib/historia";
import { hallazgosDe } from "@/lib/historiaGrave";
import { AccionesHecho, DetalleHecho } from "./DetalleHecho";
import { Destacados } from "./Destacados";
import { HilosHistoria } from "./HilosHistoria";
import { LineaDeTiempo } from "./LineaDeTiempo";
import { TextoPaso } from "./TextoPaso";

/**
 * La pestaña «Historia» de una entidad, una empresa, un partido o un contrato (fase 3 del plan del 2026-10-27). Son
 * formas de ver LOS MISMOS hechos, en pestañas (`?hv=`) y de a una (pedido del usuario del 2026-11-18: «scrolleamos y hay
 * secciones de texto… tenerlo ordenado, sin scroll infinito»; antes «Lo que llama la atención» iba apilado sobre la
 * línea, y sólo traía picos de visitas y de planilla):
 *
 *   1. Lo más grave (`Destacados`, `?hv=grave`): todo lo que tiene gravedad (contratos con banderas, informes de control,
 *      obras paralizadas, visitas que terminaron en compra, secuencias, meses fuera de lo normal) en una lista con su
 *      detalle al lado, con filtros por clase, por gestión y por gravedad, y las cifras del periodo arriba.
 *   2. En el tiempo: la línea con todos sus renglones.
 *   3. Empresa por empresa: los hilos, en una entidad.
 *   4. Todos los hechos, en una lista con su buscador, sus filtros y su CSV (también es la versión accesible).
 *
 * En un contrato la cronología es lo principal: «En el tiempo» va primero.
 *
 * El detalle de cada hecho (`DetalleHecho`) es el mismo en la línea y en la lista. Server component: pide
 * GET /historia/... una vez (CDN de una hora) y le pasa todo a la línea.
 */
export async function HistoriaFicha({
  tipo,
  id,
  nombre,
  vista,
}: {
  tipo: Historia["sujeto"]["tipo"];
  id: string;
  nombre: string;
  /** La forma de verla al abrir (`?hv=`): «grave», «tiempo», «empresas» o «lista». */
  vista?: string;
}) {
  const h = await getHistoria(tipo, id);
  if (!h) {
    return (
      <VacioEnLinea variante="compacta" tono="error" icono={<CloudOff size={16} />}>
        No pudimos armar su historia ahora. Vuelve a intentarlo en un momento.
      </VacioEnLinea>
    );
  }
  if (!h.carriles.length) {
    return (
      <VacioEnLinea variante="compacta" icono={<History size={16} />}>
        Todavía no hay hechos con fecha de {nombre} en las fuentes que cruza Vigía.
      </VacioEnLinea>
    );
  }
  const omitidos = Object.entries(h.omitidos).filter(([, n]) => (n ?? 0) > 0) as [Carril, number][];
  const titulo = (c: Carril) => h.carriles.find((x) => x.clave === c)?.titulo ?? c;
  // La historia en la página: con ella se hablan las tarjetas de arriba y su línea.
  const clave = `${tipo}-${id}`;
  const hilos = h.hilos ?? [];
  // Antes decía que los que faltan estaban en «Todos los hechos»: esa lista usa los mismos hechos que la línea (la API
  // pone un tope por renglón). Lo completo es la lista de la pestaña de cada renglón, enlazada si la tiene. Va bajo la
  // línea y bajo la lista: las dos llevan lo mismo.
  const notaOmitidos =
    omitidos.length > 0 ? (
      <Nota>
        En la línea y en «Todos los hechos» van los hechos más graves y los más grandes de cada renglón. Quedaron fuera{" "}
        {omitidos.map(([c, n], i) => {
          const href = h.series.find((s) => s.carril === c)?.href;
          const texto = `${numero(n)} de «${titulo(c)}»`;
          return (
            <Fragment key={c}>
              {i > 0 && (i === omitidos.length - 1 ? " y " : ", ")}
              {href ? (
                <Link href={href} prefetch={false} className="font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                  {texto}
                </Link>
              ) : (
                texto
              )}
            </Fragment>
          );
        })}
        : el registro completo de cada uno está en su pestaña de la ficha.
      </Nota>
    ) : null;

  const graves = hallazgosDe(h);
  const loMasGrave: Pestana[] = graves.length
    ? [
        {
          clave: "grave",
          etiqueta: "Lo más grave",
          conteo: graves.length,
          icono: <Siren size={15} aria-hidden />,
          contenido: <Destacados clave={clave} h={h} />,
        },
      ]
    : [];
  const enElTiempo: Pestana[] = [
    {
      clave: "tiempo",
      etiqueta: "En el tiempo",
      icono: <CalendarRange size={15} aria-hidden />,
      contenido: (
        <div className="space-y-2">
          <LineaDeTiempo h={h} etiqueta={`Historia de ${nombre}`} clave={clave} />
          {notaOmitidos}
        </div>
      ),
    },
  ];
  const formas: Pestana[] = [
    // En un contrato manda su cronología; en lo demás, lo más grave va primero.
    ...(tipo === "contrato" ? [...enElTiempo, ...loMasGrave] : [...loMasGrave, ...enElTiempo]),
    ...(hilos.length
      ? [
          {
            clave: "empresas",
            etiqueta: "Empresa por empresa",
            conteo: hilos.length,
            icono: <Building2 size={15} aria-hidden />,
            contenido: (
              <section aria-labelledby="hilos-titulo" className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
                <h3 id="hilos-titulo" className="font-display text-bloque font-bold text-ink">Lo que pasó con cada empresa</h3>
                <p className="mb-3 mt-0.5 max-w-prose text-meta text-inkSoft">
                  Cada fila une, en el tiempo, lo que pasó entre una misma empresa y la entidad: las visitas de su gente, lo que le
                  dieron, sus banderas, sus obras y sus sanciones.
                </p>
                <HilosHistoria hilos={hilos} desde={h.desde} hasta={h.hasta} marcas={h.marcas} gestiones={h.eventos.filter((e) => e.carril === "gobierno" && !!e.hasta)} />
              </section>
            ),
          },
        ]
      : []),
    {
      clave: "lista",
      etiqueta: "Todos los hechos",
      conteo: h.eventos.length + h.secuencias.length,
      icono: <List size={15} aria-hidden />,
      contenido: (
        <div className="space-y-2">
          <ListaHechos h={h} titulo={titulo} />
          {notaOmitidos}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <section aria-label="Sus hechos" className="space-y-2">
        <Pestanas param="hv" variante="segunda" etiqueta="Cómo ver sus hechos" activa={vista} pestanas={formas} />
      </section>
      <PieFuentes fuente="Las fuentes oficiales de cada hecho (en su detalle)" enlaces={h.fuentes} />
    </div>
  );
}

/** Todos los hechos y las secuencias, de lo más reciente a lo más viejo, con su buscador, sus filtros y su fuente. */
function ListaHechos({ h, titulo }: { h: Historia; titulo: (c: Carril) => string }) {
  const columnas: Columna[] = [
    { clave: "que", titulo: "Qué pasó", ancho: "minmax(0,1fr)" },
    { clave: "monto", titulo: "Monto", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const sev = (s: string | null | undefined) => (s === "alta" ? "Grave" : s === "media" ? "Medio" : s === "baja" ? "Leve" : null);
  const filas: FilaFiltrable[] = [
    ...h.secuencias.map((s) => ({
      id: `s-${s.id}`,
      celdas: {
        que: (
          <CeldaPrincipal
            titulo={s.titulo}
            meta={[
              <Dato key="f" tipo="fecha" nombre="Cuándo">{`${fechaConAnio(s.pasos[0].fecha)} a ${fechaConAnio(s.pasos[s.pasos.length - 1].fecha)}`}</Dato>,
              <Dato key="c" tipo="tipo" nombre="Renglón">Una cosa lleva a otra</Dato>,
              sev(s.severidad) ? <Severidad key="s" bandera={s.severidad as "alta" | "media" | "baja"} /> : null,
            ]}
          />
        ),
        monto: <CeldaNumero>Sin monto</CeldaNumero>,
      },
      detalle: {
        titulo: s.titulo,
        etiqueta: "Secuencia",
        contenido: (
          <div className="space-y-3">
            <p className="text-meta text-inkSoft">{s.explica}</p>
            <ol className="space-y-1.5">
              {s.pasos.map((p, i) => (
                <li key={i} className="text-meta text-ink">
                  <span className="font-mono text-rotulo tabular-nums text-inkSoft">{fechaConAnio(p.fecha)}</span> <TextoPaso texto={p.texto} href={p.href} />
                </li>
              ))}
            </ol>
            <p className="text-rotulo text-mute">Fuente: {s.fuente}</p>
          </div>
        ),
        pie: s.href ? (
          <Link href={s.href} prefetch={false} className="text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2">
            Ver la evidencia
          </Link>
        ) : undefined,
      },
      buscable: `${s.titulo} ${s.explica} ${s.pasos.map((p) => p.texto).join(" ")}`,
      valores: { carril: "secuencias", severidad: s.severidad },
      claves: { fecha: s.pasos[s.pasos.length - 1].fecha },
      csv: { fecha: s.pasos[0].fecha, hasta: s.pasos[s.pasos.length - 1].fecha, renglon: "Una cosa lleva a otra", hecho: s.titulo, detalle: s.pasos.map((p) => `${p.fecha}: ${p.texto}`).join(" | "), gravedad: s.severidad, monto: null, fuente: s.fuente, enlace: s.href ?? null },
    })),
    ...h.eventos.map((e) => ({
      id: `e-${e.id}`,
      celdas: {
        que: (
          <CeldaPrincipal
            titulo={e.titulo}
            meta={[
              // Quién fue (una persona de la empresa o la entidad), sin abrir el detalle.
              e.quien ? (
                <Dato key="q" tipo={e.quien.tipo === "persona" ? "personas" : "entidad"} nombre={e.quien.rol}>
                  {e.quien.nombre}
                </Dato>
              ) : null,
              <Dato key="f" tipo="fecha" nombre="Cuándo">{e.hasta ? `${fechaConAnio(e.fecha)} a ${fechaConAnio(e.hasta)}` : fechaConAnio(e.fecha)}</Dato>,
              <Dato key="c" tipo="tipo" nombre="Renglón">{titulo(e.carril)}</Dato>,
              // La gravedad en su pastilla con ícono: era una palabra más entre los datos y la lista era puro texto.
              sev(e.severidad) && e.carril !== "gobierno" ? <Severidad key="s" bandera={e.severidad as "alta" | "media" | "baja"} /> : null,
            ]}
          />
        ),
        monto: <CeldaNumero>{e.monto ? solesCompacto(e.monto) : "Sin monto"}</CeldaNumero>,
      },
      detalle: {
        titulo: e.titulo,
        etiqueta: titulo(e.carril),
        contenido: <DetalleHecho e={e} renglon={titulo(e.carril)} conPie={false} />,
        pie: <AccionesHecho e={e} />,
      },
      buscable: `${e.titulo} ${e.detalle ?? ""} ${e.quien?.nombre ?? ""} ${(e.datos ?? []).map((d) => d.valor).join(" ")} ${(e.banderas ?? []).map((b) => b.texto).join(" ")} ${e.fuente} ${titulo(e.carril)}`,
      valores: { carril: e.carril, severidad: e.severidad ?? "ninguna" },
      claves: { fecha: e.hasta ?? e.fecha, monto: e.monto ?? 0 },
      csv: { fecha: e.fecha, hasta: e.hasta ?? null, renglon: titulo(e.carril), hecho: e.titulo, quien: e.quien ? `${e.quien.nombre} (${e.quien.rol})` : null, detalle: e.detalle ?? null, gravedad: e.severidad ?? null, monto: e.monto ?? null, fuente: e.fuente, enlace: e.enlace ?? null },
    })),
  ];
  const carriles = [...new Set(filas.map((f) => String(f.valores?.carril)))];
  // En su tarjeta: antes el buscador, los filtros y la tabla iban sueltos sobre el fondo.
  return (
    <section aria-label="Todos los hechos" className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Hechos de su historia (toca uno para ver su fuente)"
        tam={10}
        nombre="hechos"
        descargar={{ archivo: `historia-${h.sujeto.tipo}-${h.sujeto.id}` }}
        buscar={{ placeholder: "Buscar un hecho, una entidad, una fuente…", etiqueta: "Buscar entre los hechos" }}
        filtros={[
          {
            clave: "carril",
            etiqueta: "Renglón",
            corta: "Renglón",
            opciones: carriles.map((c) => ({ valor: c, etiqueta: c === "secuencias" ? "Una cosa lleva a otra" : titulo(c as Carril) })),
          },
          {
            clave: "severidad",
            etiqueta: "Gravedad",
            corta: "Gravedad",
            opciones: [
              { valor: "alta", etiqueta: "Grave" },
              { valor: "media", etiqueta: "Medio" },
              { valor: "baja", etiqueta: "Leve" },
            ].filter((o) => filas.some((f) => f.valores?.severidad === o.valor)),
          },
        ]}
        ordenes={[
          { valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" },
          { valor: "antiguo", etiqueta: "Lo más antiguo", clave: "fecha", dir: "asc" },
          { valor: "monto", etiqueta: "Mayor monto", clave: "monto", dir: "desc" },
        ]}
      />
    </section>
  );
}
