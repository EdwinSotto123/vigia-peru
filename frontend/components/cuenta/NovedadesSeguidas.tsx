"use client";

/**
 * Lo nuevo de lo que sigues (Mi impacto, migración 191): los contratos con antecedentes de las entidades, empresas y
 * partidos que sigues (buena pro en los últimos días con datos), los informes de la Contraloría de esas entidades y las
 * sanciones del Tribunal a esas empresas. Cada contrato dice por qué está (qué sigues que lo trae) y lleva a su
 * evidencia; cada lista se filtra y se descarga en CSV. Del ganador, el nombre sólo si es una empresa (RUC 20).
 */

import Link from "next/link";
import { ArrowRight, Briefcase, Building2, Landmark, type LucideIcon } from "lucide-react";
import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import type { NovedadesSeguidas as Novedades, PorQueSeguido } from "@/lib/cuentas";
import { fechaCorta, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";

const NOMBRE_CRUCE = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t.chip ?? t.corto] as const)));
const RESP: Record<string, string> = { penal: "penal", civil: "civil", administrativa_entidad: "administrativa", administrativa_pas: "administrativa (PAS)", administrativa: "administrativa" };
const GRAVEDAD: Record<string, string> = { alta: "Grave", media: "Para revisar" };
const ICONO_POR: Record<PorQueSeguido["tipo"], LucideIcon> = { entidad: Building2, empresa: Briefcase, partido: Landmark };
const QUE_POR: Record<PorQueSeguido["tipo"], string> = { entidad: "Entidad que sigues", empresa: "Empresa que sigues", partido: "Partido que sigues" };
const ENLACE = "inline-flex min-h-[24px] items-center gap-1 text-meta font-medium text-granate underline-offset-2 hover:underline";

const nombrePor = (p: PorQueSeguido) => (p.tipo === "partido" ? p.nombre : tituloNatural(p.nombre));

/** Por qué está: un dato por cada cosa que sigues y lo trae (la entidad y la empresa ya se nombran en la fila). */
const datosPor = (por: PorQueSeguido[]) =>
  por.map((p) => (
    <Dato key={`${p.tipo}-${p.id}`} icono={ICONO_POR[p.tipo]} nombre={QUE_POR[p.tipo]}>
      {p.tipo === "partido" ? `Gobierno de ${nombrePor(p)}` : p.tipo === "entidad" ? "Sigues esta entidad" : "Sigues esta empresa"}
    </Dato>
  ));

export function NovedadesSeguidas({ d, sigueAlgo }: { d: Novedades | undefined; sigueAlgo: boolean }) {
  if (!sigueAlgo || !d) {
    return (
      <EstadoVacio
        variante="compacta"
        accion={
          <span className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            <Link href="/app/entidades" className={ENLACE}>Entidades <ArrowRight size={13} aria-hidden /></Link>
            <Link href="/app/empresas" className={ENLACE}>Empresas <ArrowRight size={13} aria-hidden /></Link>
            <Link href="/app/partidos" className={ENLACE}>Partidos <ArrowRight size={13} aria-hidden /></Link>
          </span>
        }
      >
        Sigue una entidad, una empresa o un partido desde su ficha (botón «Seguir») y aquí verás lo nuevo de cada uno: los
        contratos con antecedentes, los informes de control y las sanciones.
      </EstadoVacio>
    );
  }
  return (
    <div className="space-y-8">
      <Contratos d={d} />
      {d.informes.length > 0 && <Informes d={d} />}
      {d.sanciones.length > 0 && <Sanciones d={d} />}
      <p className="text-rotulo text-mute">
        Un antecedente es un dato oficial que coincide con el ganador (una sanción, un vínculo, un aporte): es un indicio para
        revisar, no prueba una irregularidad. Fuentes: OECE (SEACE y CONOSCE), Tribunal de Contrataciones y Contraloría.
      </p>
    </div>
  );
}

function Contratos({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
    { clave: "monto", titulo: "Monto", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: FilaFiltrable[] = d.contratos.map((c) => {
    const tipos = (c.tipos ?? []).map((t) => NOMBRE_CRUCE.get(t) ?? t.replace(/_/g, " "));
    return {
      id: `${c.ocid}-${c.ruc ?? c.entidadRuc}`,
      href: rutaContrato(c.ocid),
      celdas: {
        contrato: (
          <CeldaPrincipal
            titulo={c.objeto ? `${c.objeto.charAt(0).toUpperCase()}${c.objeto.slice(1).toLowerCase()}` : "Contrato sin objeto registrado"}
            meta={[
              <Dato key="s" tipo="tipo" nombre="Gravedad">{GRAVEDAD[c.severidad] ?? c.severidad}</Dato>,
              <Dato key="e" tipo="entidad" nombre="Entidad">{c.entidad ? tituloNatural(c.entidad) : "Sin entidad"}</Dato>,
              <Dato key="g" tipo="personas" nombre="Ganó">{c.proveedor ? tituloNatural(c.proveedor) : "Una persona natural"}</Dato>,
              <Dato key="f" tipo="fecha" nombre="Buena pro">{fechaCorta(c.fecha)}</Dato>,
              tipos.length ? <Dato key="t" tipo="tipo" nombre="Antecedentes">{tipos.slice(0, 3).join(", ")}{tipos.length > 3 ? ` y ${tipos.length - 3} más` : ""}</Dato> : null,
              ...datosPor(c.por),
            ]}
          />
        ),
        monto: <CeldaNumero>{c.monto ? solesCompacto(c.monto) : "Sin monto"}</CeldaNumero>,
      },
      buscable: `${c.objeto ?? ""} ${c.entidad ?? ""} ${c.proveedor ?? ""} ${tipos.join(" ")} ${c.por.map((p) => p.nombre).join(" ")}`,
      valores: { por: c.por.map((p) => `${p.tipo}:${p.id}`), gravedad: c.severidad },
      claves: { fecha: c.fecha, monto: c.monto ?? 0 },
      csv: {
        buena_pro: c.fecha, gravedad: GRAVEDAD[c.severidad] ?? c.severidad, objeto: c.objeto, entidad: c.entidad, ruc_entidad: c.entidadRuc,
        ganador: c.proveedor, ruc_ganador: c.ruc, monto: c.monto, antecedentes: tipos.join("; "),
        lo_sigues_por: c.por.map((p) => `${QUE_POR[p.tipo]}: ${p.nombre}`).join("; "), ficha: rutaContrato(c.ocid),
      },
    };
  });
  // Un filtro por lo que trae cada contrato: cada cosa que sigues, con su nombre.
  const opcionesPor = [...new Map(d.contratos.flatMap((c) => c.por).map((p) => [`${p.tipo}:${p.id}`, p] as const)).entries()]
    .map(([valor, p]) => ({ valor, etiqueta: nombrePor(p) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  return (
    <section aria-labelledby="sigo-contratos" className="space-y-2">
      <h2 id="sigo-contratos" className="font-display text-bloque font-bold text-ink">
        Contratos con antecedentes
      </h2>
      {d.hasta && (
        <p className="text-meta text-inkSoft">
          De lo que sigues, con buena pro en los {d.dias} días hasta el {fechaCorta(d.hasta)}, el último con buenas pro y cruces
          calculados (el OECE las publica una vez por semana). De un partido, los de los gobiernos que ganó en el período vigente.
        </p>
      )}
      {filas.length === 0 ? (
        <EstadoVacio variante="compacta">
          En esos {d.dias} días no hubo contratos con antecedentes graves o para revisar en lo que sigues.
        </EstadoVacio>
      ) : (
        <TablaFiltrable
          columnas={columnas}
          filas={filas}
          etiqueta={`${plural(filas.length, "contrato", "contratos")} de lo que sigues (toca uno para ver su evidencia)`}
          tam={10}
          nombre="sigo-contratos"
          buscar={{ placeholder: "Buscar una entidad, una empresa, un objeto…", etiqueta: "Buscar entre los contratos de lo que sigues" }}
          filtros={[
            ...(opcionesPor.length > 1 ? [{ clave: "por", etiqueta: "Lo que sigues", corta: "Sigues", opciones: opcionesPor }] : []),
            { clave: "gravedad", etiqueta: "Gravedad", corta: "Gravedad", opciones: [{ valor: "alta", etiqueta: "Grave" }, { valor: "media", etiqueta: "Para revisar" }] },
          ]}
          ordenes={[
            { valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" },
            { valor: "monto", etiqueta: "Mayor monto", clave: "monto", dir: "desc" },
          ]}
          descargar={{ archivo: "lo-que-sigo-contratos" }}
        />
      )}
    </section>
  );
}

function Informes({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "informe", titulo: "Informe", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Emitido", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = d.informes.map((i) => ({
    id: i.codigo,
    href: `/entidad/${i.entidadRuc}?seccion=control`,
    celdas: {
      informe: (
        <CeldaPrincipal
          titulo={i.titulo ?? `Informe ${i.numero ?? i.codigo}`}
          meta={[
            <Dato key="e" tipo="entidad" nombre="Entidad">{i.entidad ? tituloNatural(i.entidad) : "Sin entidad"}</Dato>,
            i.responsabilidades?.length ? <Dato key="r" tipo="tipo" nombre="Responsabilidad">{i.responsabilidades.map((x) => RESP[x] ?? x).join(", ")}</Dato> : null,
          ]}
        />
      ),
      fecha: <CeldaNumero>{fechaCorta(i.fecha)}</CeldaNumero>,
    },
    buscable: `${i.titulo ?? ""} ${i.entidad ?? ""} ${i.numero ?? ""}`,
    claves: { fecha: i.fecha },
    csv: { emitido: i.fecha, informe: i.numero ?? i.codigo, titulo: i.titulo, entidad: i.entidad, ruc_entidad: i.entidadRuc, responsabilidades: (i.responsabilidades ?? []).join("; "), documento: i.url },
  }));
  return (
    <section aria-labelledby="sigo-informes" className="space-y-2">
      <h2 id="sigo-informes" className="font-display text-bloque font-bold text-ink">
        Informes de control de las entidades que sigues
      </h2>
      <p className="text-meta text-inkSoft">Los que emitió la Contraloría en los últimos {d.diasInformes} días; cada uno abre los de su entidad, con su documento.</p>
      <TablaFiltrable columnas={columnas} filas={filas} etiqueta={plural(filas.length, "informe", "informes")} tam={10} nombre="sigo-informes" descargar={{ archivo: "lo-que-sigo-informes" }} />
    </section>
  );
}

function Sanciones({ d }: { d: Novedades }) {
  const columnas: Columna[] = [
    { clave: "empresa", titulo: "Empresa sancionada", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Resolución", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = d.sanciones.map((s) => ({
    id: String(s.id),
    href: `/empresa/${s.ruc}?seccion=antecedentes`,
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={s.nombre ? tituloNatural(s.nombre) : `Empresa con RUC ${s.ruc}`}
          meta={[
            <Dato key="t" tipo="tipo" nombre="Sanción">{s.tipo === "multa" ? `Multa${s.multa ? ` de ${solesCompacto(s.multa)}` : ""}` : s.tipo === "definitivo" ? "Inhabilitación definitiva" : "Inhabilitación temporal"}</Dato>,
            s.desde ? <Dato key="p" tipo="fecha" nombre="Vigencia">{s.hasta ? `${fechaCorta(s.desde)} a ${fechaCorta(s.hasta)}` : `Desde ${fechaCorta(s.desde)}`}</Dato> : null,
            s.resolucion ? <Dato key="r" tipo="documento" nombre="Resolución">{s.resolucion}</Dato> : null,
          ]}
        />
      ),
      fecha: <CeldaNumero>{fechaCorta(s.fecha)}</CeldaNumero>,
    },
    buscable: `${s.nombre ?? ""} ${s.ruc} ${s.resolucion ?? ""}`,
    claves: { fecha: s.fecha },
    csv: { resolucion_fecha: s.fecha, empresa: s.nombre, ruc: s.ruc, tipo: s.tipo, resolucion: s.resolucion, desde: s.desde, hasta: s.hasta, multa: s.multa },
  }));
  return (
    <section aria-labelledby="sigo-sanciones" className="space-y-2">
      <h2 id="sigo-sanciones" className="font-display text-bloque font-bold text-ink">
        Sanciones a las empresas que sigues
      </h2>
      <p className="text-meta text-inkSoft">Las del Tribunal de Contrataciones del último año; cada una abre los antecedentes de su empresa.</p>
      <TablaFiltrable columnas={columnas} filas={filas} etiqueta={plural(filas.length, "sanción", "sanciones")} tam={10} nombre="sigo-sanciones" descargar={{ archivo: "lo-que-sigo-sanciones" }} />
    </section>
  );
}
