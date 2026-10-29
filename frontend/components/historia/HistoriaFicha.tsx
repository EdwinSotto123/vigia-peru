import { Building2, CalendarRange, CloudOff, History, List } from "lucide-react";
import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { FuenteDato, Nota, Pestanas, type Pestana } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { getHistoria, type Carril, type Historia } from "@/lib/historia";
import { AccionesHecho, DetalleHecho } from "./DetalleHecho";
import { Destacados } from "./Destacados";
import { HilosHistoria } from "./HilosHistoria";
import { LineaDeTiempo } from "./LineaDeTiempo";

/**
 * La pestaña «Historia» de una entidad, una empresa, un partido o un contrato (fase 3 del plan del 2026-10-27), ordenada
 * para no repetir (pedido del usuario del 2026-10-28: «ordénalo más adecuadamente, parece que se repite información»):
 *
 *   1. Lo que llama la atención (`Destacados`): las secuencias y los meses fuera de lo normal, juntos y lo más grave
 *      primero (antes eran dos grillas de tarjetas seguidas).
 *   2. Tres formas de ver LOS MISMOS hechos, en pestañas (`?hv=`) en vez de apiladas: en el tiempo (la línea con todos
 *      sus renglones), empresa por empresa (los hilos, en una entidad) y todos los hechos en una lista con su buscador,
 *      sus filtros y su CSV (también es la versión accesible).
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
  /** La forma de verla al abrir (`?hv=`): «tiempo», «empresas» o «lista». */
  vista?: string;
}) {
  const h = await getHistoria(tipo, id);
  if (!h) {
    return (
      <EstadoVacio variante="compacta" tono="error" icono={<CloudOff size={16} />}>
        No pudimos armar su historia ahora. Vuelve a intentarlo en un momento.
      </EstadoVacio>
    );
  }
  if (!h.carriles.length) {
    return (
      <EstadoVacio variante="compacta" icono={<History size={16} />}>
        Todavía no hay hechos con fecha de {nombre} en las fuentes que cruza Vigía.
      </EstadoVacio>
    );
  }
  const omitidos = Object.entries(h.omitidos).filter(([, n]) => (n ?? 0) > 0) as [Carril, number][];
  const titulo = (c: Carril) => h.carriles.find((x) => x.clave === c)?.titulo ?? c;
  // La historia en la página: con ella se hablan las tarjetas de arriba y su línea.
  const clave = `${tipo}-${id}`;
  const hilos = h.hilos ?? [];

  const formas: Pestana[] = [
    {
      clave: "tiempo",
      etiqueta: "En el tiempo",
      icono: <CalendarRange size={15} aria-hidden />,
      contenido: (
        <div className="space-y-2">
          <LineaDeTiempo h={h} etiqueta={`Historia de ${nombre}`} clave={clave} />
          {omitidos.length > 0 && (
            <Nota>
              En la línea van los hechos más graves y los más grandes de cada renglón:{" "}
              {omitidos.map(([c, n]) => `${numero(n)} más en «${titulo(c)}»`).join(", ")}. Están todos en «Todos los hechos» y en su pestaña.
            </Nota>
          )}
        </div>
      ),
    },
    ...(hilos.length
      ? [
          {
            clave: "empresas",
            etiqueta: "Empresa por empresa",
            conteo: hilos.length,
            icono: <Building2 size={15} aria-hidden />,
            contenido: (
              <div className="space-y-2">
                <p className="max-w-prose text-meta text-inkSoft">
                  Cada fila une, en el tiempo, lo que pasó entre una misma empresa y la entidad: las visitas de su gente, lo que le
                  dieron, sus banderas, sus obras y sus sanciones.
                </p>
                <HilosHistoria hilos={hilos} desde={h.desde} hasta={h.hasta} marcas={h.marcas} gestiones={h.eventos.filter((e) => e.carril === "gobierno" && !!e.hasta)} />
              </div>
            ),
          },
        ]
      : []),
    {
      clave: "lista",
      etiqueta: "Todos los hechos",
      conteo: h.eventos.length + h.secuencias.length,
      icono: <List size={15} aria-hidden />,
      contenido: <ListaHechos h={h} titulo={titulo} />,
    },
  ];

  return (
    <div className="space-y-6">
      <Destacados clave={clave} secuencias={h.secuencias} patrones={h.patrones ?? []} />
      <section aria-label="Sus hechos" className="space-y-2">
        <Pestanas param="hv" variante="segunda" etiqueta="Cómo ver sus hechos" activa={vista} pestanas={formas} />
      </section>
      <FuenteDato fuente="Las fuentes oficiales de cada hecho (en su detalle)" enlaces={h.fuentes} />
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
              <Dato key="f" tipo="fecha" nombre="Cuándo">{`${fechaCorta(s.pasos[0].fecha)} a ${fechaCorta(s.pasos[s.pasos.length - 1].fecha)}`}</Dato>,
              <Dato key="c" tipo="tipo" nombre="Renglón">Una cosa lleva a otra</Dato>,
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
                  <span className="font-mono text-rotulo tabular-nums text-inkSoft">{fechaCorta(p.fecha)}</span> {p.texto}
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
              <Dato key="f" tipo="fecha" nombre="Cuándo">{e.hasta ? `${fechaCorta(e.fecha)} a ${fechaCorta(e.hasta)}` : fechaCorta(e.fecha)}</Dato>,
              <Dato key="c" tipo="tipo" nombre="Renglón">{titulo(e.carril)}</Dato>,
              sev(e.severidad) && e.carril !== "gobierno" ? <Dato key="s" tipo="tipo" nombre="Gravedad">{sev(e.severidad)}</Dato> : null,
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
      csv: { fecha: e.fecha, hasta: e.hasta ?? null, renglon: titulo(e.carril), hecho: e.titulo, detalle: e.detalle ?? null, gravedad: e.severidad ?? null, monto: e.monto ?? null, fuente: e.fuente, enlace: e.enlace ?? null },
    })),
  ];
  const carriles = [...new Set(filas.map((f) => String(f.valores?.carril)))];
  return (
    <section aria-label="Todos los hechos" className="space-y-2">
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Hechos de su historia (toca uno para ver su fuente)"
        tam={20}
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
