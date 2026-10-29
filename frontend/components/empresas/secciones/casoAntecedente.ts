import { esTipoObra } from "@/lib/cruces";
import { rutaEmpresa, type AntecedenteEmpresa, type ReferenciasAntecedente } from "@/lib/empresas";
import { fechaCorta, hoyLima, numero, oracion, plural, soles } from "@/lib/formato";
import { inversionSsi, obraInfobras } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { fraseBandera, type BanderaObra } from "@/lib/obras";
import { rutaPartido } from "@/lib/partidos";
import { rutaContrato } from "@/lib/rutas";
import { txtONumero } from "@/lib/utils";
import { conAnio } from "./comun";

/**
 * Lo que dice cada antecedente de la empresa, tipo por tipo, con la referencia de cada dato: la persona (a «Su gente»), el
 * partido (a su ficha), la entidad (a su ficha), la otra empresa (a la suya), el proceso (a sus antecedentes), la obra
 * (INFOBRAS) y la inversión (MEF). El usuario (2026-10-29), sobre «Es autoridad electa»: «faltan varias referencias a
 * varios datos, audita todo». Antes un mapeo genérico: las sanciones del Tribunal, los recurrentes, los sobreprecios, el
 * único postor y otros 20 tipos caían en la rama de «organización política / cargo» y su panel decía sólo la fecha; la
 * autoridad no decía dónde ni hasta cuándo.
 *
 * Sin nombres de personas fuera de los que ya trae la API tapados (publicar()); del funcionario que recibió una visita,
 * sólo su cargo y su área; el pariente de un funcionario no se identifica.
 */

/** Un dato del caso: su rótulo, su valor en texto (la fila y la búsqueda) y adónde lleva en el panel. */
export interface DatoCaso {
  etiqueta: string;
  valor: string | null;
  mono?: boolean;
  /** Una ficha de Vigía (la entidad, el partido, otra empresa, el proceso, su gente) o, con `fuera`, un registro oficial. */
  href?: string | null;
  fuera?: boolean;
  /** Varias fichas en un mismo dato (las otras empresas del proceso): cada una con su enlace. */
  lista?: { texto: string; href: string | null }[];
  /** No va en la fila de la tabla (es largo o repite lo que la columna «Proceso» ya dice). */
  soloPanel?: boolean;
}

const txt = txtONumero;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const fechaDe = (v: unknown) => {
  const s = txt(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? fechaCorta(s) : s;
};
const rangoDe = (a: unknown, b: unknown) => {
  const x = fechaDe(a);
  const y = fechaDe(b);
  if (!x && !y) return null;
  return !y || x === y ? x : !x ? `hasta ${y}` : `${x} a ${y}`;
};
const anioDe = (v: unknown) => txt(v)?.match(/\d{4}/)?.[0] ?? null;
const periodoDe = (a: unknown, b: unknown) => {
  const x = anioDe(a);
  const y = anioDe(b);
  return x ? (y && y !== x ? `${x} a ${y}` : x) : null;
};
const pct = (v: number, decimales = 1) => `${v.toLocaleString("es-PE", { maximumFractionDigits: decimales })} %`;
const titulo = (v: unknown) => {
  const s = txt(v);
  return s ? tituloNatural(s) : null;
};
const listaY = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const mayus = (s: string) => s.charAt(0).toLocaleUpperCase("es") + s.slice(1);

const ORDEN_PAPEL = ["titular", "representante legal", "socio", "directivo"];
/** «órgano de administración, representante legal, socio» → «Representante legal, socio y directivo». */
export function papeles(rol: string | null | undefined): string | null {
  if (!rol) return null;
  const xs = [
    ...new Set(
      rol
        .split(/,\s*/)
        .map((r) =>
          r.trim().toLowerCase().replace(/_/g, " ")
            .replace(/^(órgano|organo) (de )?administraci(ó|o)n$/, "directivo")
            .replace(/^socio accionista titular$/, "socio"),
        )
        .filter(Boolean),
    ),
  ].sort((a, b) => (ORDEN_PAPEL.indexOf(a) + 1 || 99) - (ORDEN_PAPEL.indexOf(b) + 1 || 99));
  return xs.length ? mayus(listaY(xs)) : null;
}

/** Si una sanción sigue hoy: por su fecha de fin y, sin ella, por el estado que publica el Tribunal. */
export function hoySancion(tipo: string | null, hasta: string | null, estado: string | null): string | null {
  // El día de Lima, no el UTC: desde las 19:00 de Lima el día UTC ya es mañana.
  const hoy = hoyLima();
  if (hasta) return hasta.slice(0, 10) >= hoy ? "Vigente" : `Ya terminó (el ${fechaCorta(hasta)})`;
  if (estado) return estado.toUpperCase() === "VIGENTE" ? "Vigente" : "No vigente, según el Tribunal";
  return /definitiv/i.test(tipo ?? "") ? "Definitiva, sin fecha de fin" : null;
}

/** Dónde se ejerce (o a qué lugar postuló) un cargo, según su nivel: «La Banda de Shilcayo, provincia de San Martín, San Martín». */
export function lugarDelCargo(l: ReferenciasAntecedente["lugar"], cargo: string | null | undefined): string | null {
  if (!l) return null;
  const dis = l.distrito ? tituloNatural(l.distrito) : null;
  const pro = l.provincia ? tituloNatural(l.provincia) : null;
  const dep = l.departamento ? tituloNatural(l.departamento) : null;
  const c = (cargo ?? "").toUpperCase();
  const partes = /DISTRITAL/.test(c)
    ? [dis, pro && `provincia de ${pro}`, dep]
    : /PROVINCIAL|METROPOLITAN/.test(c)
      ? [pro && `Provincia de ${pro}`, dep]
      : /REGIONAL|GOBERNADOR|CONSEJER/.test(c)
        ? [dep]
        : [dis, pro, dep];
  const xs = partes.filter((x): x is string => !!x);
  return xs.length ? xs.join(", ") : null;
}

/** «Gerente en logística (decide las compras)»: de quien recibió una visita, sólo su cargo y su área; nunca su nombre. */
function recibio(v: Record<string, unknown>): string | null {
  const cargo = txt(v.cargoFuncionario);
  const area = txt(v.areaFuncionario);
  if (!cargo && !area) return null;
  return `${cargo ? oracion(cargo) : "Un funcionario"}${area ? ` en ${area.toLowerCase()}` : ""}${v.decisor === true ? " (decide las compras de la entidad)" : ""}`;
}

/** Cuánto llevaba de fundada: «4 meses», «1 año y 3 meses», «20 días». */
function tiempoDeFundada(meses: number | null, dias: number | null): string | null {
  if (meses == null && dias == null) return null;
  if ((meses ?? 0) < 1) return dias != null ? plural(Math.max(0, Math.round(dias)), "día", "días") : "Menos de un mes";
  const m = Math.round(meses!);
  if (m < 12) return plural(m, "mes", "meses");
  const a = Math.floor(m / 12);
  const r = m % 12;
  return `${plural(a, "año", "años")}${r ? ` y ${plural(r, "mes", "meses")}` : ""}`;
}

/** Las empresas de un dato (otros postores, el mismo domicilio): una persona natural, sin RUC ni nombre (ni enlace). */
function empresas(xs: { ruc: string | null; nombre: string | null }[]): { texto: string; href: string | null }[] {
  return xs.map((o) =>
    o.ruc && o.ruc.startsWith("20")
      ? { texto: o.nombre ? tituloNatural(o.nombre) : `RUC ${o.ruc}`, href: `/empresa/${o.ruc}` }
      : { texto: "Una persona natural", href: null },
  );
}

/**
 * Los datos de un antecedente, por tipo, con sus referencias. Los primeros cuatro van en la fila de la tabla (lo que
 * distingue un caso de otro del mismo tipo); todos, en su panel.
 */
export function datosDe(a: AntecedenteEmpresa, ruc: string): DatoCaso[] {
  const d = a.detalle;
  const r = a.referencias;
  const t = a.tipo;
  const items: DatoCaso[] = [];
  const add = (...xs: (DatoCaso | DatoCaso[] | null | false | undefined | "" | 0)[]) => {
    for (const x of xs) if (Array.isArray(x)) items.push(...x);
    else if (x) items.push(x);
  };

  // ── Referencias de uso común ──
  const quien = (): DatoCaso[] => {
    const p = a.socios[0];
    if (!p?.nombre) return [];
    const papel = papeles(p.rol);
    return [
      { etiqueta: "Quién", valor: p.nombre, href: rutaEmpresa(ruc, "socios") },
      ...(papel ? [{ etiqueta: "Su papel en la empresa", valor: papel }] : []),
    ];
  };
  const laEmpresa = (): DatoCaso => ({ etiqueta: "Quién", valor: "La empresa" });
  const visitante = (): DatoCaso[] => {
    const v = (a.visitas[0] ?? {}) as Record<string, unknown>;
    const nombre = txt(v.visitante);
    if (!nombre) return [];
    const papel = papeles(txt(v.rol));
    return [
      { etiqueta: "Quién fue", valor: nombre, href: rutaEmpresa(ruc, "visitas") },
      ...(papel ? [{ etiqueta: "Su papel en la empresa", valor: papel }] : []),
    ];
  };
  const entidad = (nombre: unknown = a.entidad, rucEntidad: string | null | undefined = a.entidadRuc, etiqueta = "Entidad"): DatoCaso[] => {
    const n = titulo(nombre);
    return n ? [{ etiqueta, valor: n, href: rucEntidad ? `/entidad/${rucEntidad}` : null }] : [];
  };
  const partido = (nombre: unknown, anio: unknown, etiqueta = "Partido"): DatoCaso[] => {
    const n = txt(nombre);
    return n ? [{ etiqueta, valor: tituloNatural(n), href: rutaPartido(n, anioDe(anio)) }] : [];
  };
  const otraEmpresa = (rucOtra: unknown, nombre: unknown, etiqueta: string): DatoCaso[] => {
    const ro = txt(rucOtra);
    if (ro && !ro.startsWith("20")) return [{ etiqueta, valor: "Una persona natural" }];
    const n = titulo(nombre) ?? (ro ? `RUC ${ro}` : null);
    return n ? [{ etiqueta, valor: ro && titulo(nombre) ? `${n} (RUC ${ro})` : n, href: ro ? `/empresa/${ro}` : null }] : [];
  };
  // La entidad del proceso y el proceso: van al panel (la fila ya los dice en su columna «Proceso»).
  const delProceso = (): DatoCaso[] => [
    ...entidad().map((x) => ({ ...x, soloPanel: true })),
    ...(a.ocid
      ? [{ etiqueta: "Pesa sobre el proceso", valor: a.codigo ?? a.ocid, mono: true, href: rutaContrato(a.ocid, "ficha", { seccion: "antecedentes" }), soloPanel: true }]
      : []),
  ];
  const monto = (etiqueta = "Monto"): DatoCaso | null =>
    a.montoSoles != null ? { etiqueta, valor: soles(a.montoSoles), mono: true } : null;

  // ── Política: autoridades, candidaturas, aportes y ventas a campañas ──
  if (t === "autoridad") {
    const cargo = txt(d.cargo) ?? r?.cargo ?? null;
    const desde = r?.periodo?.desde ?? d.desde;
    add(
      quien(),
      cargo && { etiqueta: "Cargo", valor: oracion(cargo) },
      { etiqueta: "Dónde", valor: lugarDelCargo(r?.lugar ?? { distrito: txt(d.distrito), provincia: txt(d.provincia), departamento: txt(d.departamento) }, cargo) },
      partido(d.organizacion, desde),
      { etiqueta: "Periodo", valor: periodoDe(desde, r?.periodo?.hasta ?? d.hasta) },
      r?.vigente != null && { etiqueta: "Hoy", valor: r.vigente ? "Sigue en el cargo" : "Ya dejó el cargo" },
      r?.eleccion && { etiqueta: "Elegido en", valor: r.eleccion },
    );
  } else if (t === "candidato") {
    const cargo = r?.cargo ?? txt(d.cargo);
    add(
      quien(),
      cargo && { etiqueta: "Postuló a", valor: oracion(cargo) },
      { etiqueta: "Dónde", valor: lugarDelCargo(r?.lugar, cargo) ?? titulo(d.departamento) },
      partido(d.organizacion, d.proceso, "Por"),
      { etiqueta: "Elección", valor: r?.eleccion ?? txt(d.proceso) },
      r?.resultado && { etiqueta: "Resultado", valor: /^electo/i.test(r.resultado) ? "Fue elegido" : "No fue elegido" },
    );
  } else if (t === "aporte" || t === "aporte_empresa") {
    const n = num(d.aportes);
    add(
      t === "aporte" ? quien() : laEmpresa(),
      partido(d.partido, d.hasta ?? d.desde, "A quién"),
      n != null && { etiqueta: "Aportes", valor: plural(n, "aporte", "aportes") },
      { etiqueta: "Cuándo", valor: rangoDe(d.desde, d.hasta) },
      monto("Suman"),
    );
  } else if (t === "proveedor_campana") {
    add(
      a.socios.length ? quien() : laEmpresa(),
      partido(d.organizacion, d.proceso, "Le vendió a la campaña de"),
      { etiqueta: "Elección", valor: r?.eleccion ?? txt(d.proceso) },
      monto("Le vendió"),
    );
  } else if (t === "vendio_gobernante" || t === "partido_gobernante") {
    const vendio = t === "vendio_gobernante" || txt(d.via) === "proveedor_campana";
    const n = num(d.aportes);
    const cargoGob = txt(d.cargo_gobernante);
    add(
      a.socios.length ? quien() : laEmpresa(),
      partido(txt(d.partido) ?? txt(d.organizacion), d.proceso ?? d.hasta ?? a.fecha),
      { etiqueta: "Qué hizo", valor: vendio ? "Le vendió a su campaña" : n != null ? `Le aportó (${plural(n, "aporte", "aportes")})` : "Le aportó dinero" },
      !vendio && rangoDe(d.desde, d.hasta) && { etiqueta: "Cuándo", valor: rangoDe(d.desde, d.hasta) },
      r?.eleccion && { etiqueta: "Elección", valor: r.eleccion },
      monto(vendio ? "Le vendió" : "Aportó"),
      { etiqueta: "Quién gobernaba la entidad", valor: `${cargoGob ? `Su ${cargoGob.toLowerCase()}` : "Su autoridad"}, de ese mismo partido` },
      delProceso(),
    );
  }
  // ── Control: sanciones y penalidades ──
  else if (t === "sancion" || t.startsWith("sancion_")) {
    const tipo = txt(d.tipo);
    const que = /multa/i.test(tipo ?? t) ? "Multa" : /definitiv/i.test(tipo ?? t) ? "Inhabilitación definitiva" : "Inhabilitación temporal";
    add(
      { etiqueta: "Sanción", valor: que },
      { etiqueta: "Vigencia", valor: rangoDe(d.desde, d.hasta) },
      { etiqueta: "Hoy", valor: hoySancion(tipo ?? t, txt(d.hasta), txt(d.estado)) },
      { etiqueta: "Infracción", valor: txt(d.infraccion)?.replace(/^[-\s]*(?:[a-z]|i+)\)\s*/i, "") ?? null },
      { etiqueta: "Resolución", valor: txt(d.resolucion), mono: true },
      que === "Multa" && monto("Multa"),
      t === "sancion_vigente" && { etiqueta: "Qué pasó", valor: "Ganó la buena pro mientras la inhabilitación seguía vigente" },
      delProceso(),
    );
  } else if (t === "penalidad") {
    const n = num(d.penalidades);
    const e = num(d.entidades);
    add(
      n != null && { etiqueta: "Penalidades", valor: numero(n) },
      e != null && { etiqueta: "Entidades que las aplicaron", valor: numero(e) },
      { etiqueta: "Entre", valor: rangoDe(d.desde, d.hasta) },
      monto("Suman"),
    );
  }
  // ── Visitas de su gente ──
  else if (t === "visita_previa") {
    const v = (a.visitas[0] ?? {}) as Record<string, unknown>;
    const dias = num(d.dias_antes);
    add(
      visitante(),
      entidad(v.entidad ?? d.entidad_visitada, r?.entidadVisitadaRuc, "Visitó"),
      { etiqueta: "Cuándo", valor: fechaDe(v.fecha) ?? fechaDe(a.fecha) },
      { etiqueta: "Lo recibió", valor: recibio(v) },
      txt(v.motivo) && { etiqueta: "Motivo declarado", valor: `«${txt(v.motivo)}»`, soloPanel: true },
      d.misma_entidad === true && { etiqueta: "¿La misma entidad que contrató?", valor: "Sí" },
      dias != null && { etiqueta: "Después", valor: `${plural(dias, "día", "días")} después ganó la buena pro` },
      delProceso().filter((x) => d.misma_entidad !== true || x.etiqueta !== "Entidad"),
    );
  } else if (t === "visita_repetida" || t === "visita_fuera_horario" || t === "visita_antes_convocatoria") {
    const v = (a.visitas[a.visitas.length - 1] ?? {}) as Record<string, unknown>;
    const n = num(d.visitas_n) ?? a.visitas.length;
    const dias = num(d.dias);
    const antes = num(d.dias_antes_convocatoria);
    add(
      visitante(),
      entidad(d.entidad_visitada ?? v.entidad, r?.entidadVisitadaRuc, "Visitó"),
      { etiqueta: t === "visita_repetida" ? "A quién" : "Lo recibió", valor: recibio(v) },
      t === "visita_repetida" && {
        etiqueta: "Cuántas veces",
        valor: `${plural(dias ?? a.visitas.length, "día distinto", "días distintos")}${n > (dias ?? 0) ? ` (${plural(n, "visita", "visitas")})` : ""}`,
      },
      t === "visita_repetida" && rangoDe(d.primera, d.ultima) && { etiqueta: "Entre", valor: rangoDe(d.primera, d.ultima) },
      t === "visita_fuera_horario" && { etiqueta: "Fuera de horario", valor: `${plural(n, "visita", "visitas")} de noche, de madrugada o en fin de semana` },
      t === "visita_antes_convocatoria" && {
        etiqueta: "Antes de la convocatoria",
        valor: `${antes === 0 ? "El mismo día en que se convocó" : `${plural(antes ?? 0, "día", "días")} antes de que se convocara`}${txt(d.convocatoria) ? ` (el ${fechaCorta(txt(d.convocatoria)!)})` : ""}`,
      },
      t !== "visita_antes_convocatoria" && num(d.dias_antes) != null && { etiqueta: "Después", valor: `${plural(num(d.dias_antes)!, "día", "días")} después ganó la buena pro` },
      d.misma_entidad === true && { etiqueta: "¿La misma entidad que contrató?", valor: "Sí" },
      delProceso().filter((x) => d.misma_entidad !== true || x.etiqueta !== "Entidad"),
    );
  }
  // ── Su gente en otras empresas y en el Estado ──
  else if (t === "socio_comun") {
    const otros = empresas(r?.otros ?? (Array.isArray(d.otros_postores) ? (d.otros_postores as string[]).map((x) => ({ ruc: x, nombre: null })) : []));
    const rolOtro = Array.isArray(d.rol_en_otros) ? papeles((d.rol_en_otros as string[]).join(", ")) : null;
    add(
      quien(),
      otros.length > 0 && { etiqueta: "También está en", valor: otros.map((o) => o.texto).join(", "), lista: otros },
      rolOtro && { etiqueta: "Su papel allá", valor: rolOtro },
      { etiqueta: "Dónde compitieron", valor: "En este mismo proceso", soloPanel: true },
      delProceso(),
    );
  } else if (t === "socio_en_entidad") {
    const mp = num(d.monto_persona);
    const op = num(d.ordenes_persona);
    add(
      quien(),
      entidad(txt(d.entidad) ?? a.entidad, a.entidadRuc, "También le hizo órdenes"),
      txt(d.servicio) && { etiqueta: "Servicio", valor: oracion(txt(d.servicio)!) },
      mp != null && { etiqueta: "Le pagaron", valor: `${soles(mp)}${op ? ` en ${plural(op, "orden", "órdenes")}` : ""}` },
      delProceso().filter((x) => x.etiqueta !== "Entidad"),
    );
  } else if (t === "pariente_funcionario") {
    const par = (txt(d.parentesco) ?? "familiar").toLowerCase().replace(/\((a|o)\)/g, "").replace(/ del declarante$/, "").trim();
    const rolE = papeles(txt(d.rol_en_empresa));
    add(
      { etiqueta: "Quién", valor: `Un ${par} de un funcionario de la entidad (no se identifican)` },
      txt(d.cargo_funcionario) && { etiqueta: "Cargo del funcionario", valor: `${oracion(txt(d.cargo_funcionario)!)}${d.decisor === true ? " (decide las compras)" : ""}` },
      rolE && { etiqueta: "Su papel en la empresa", valor: `${rolE}${txt(d.desde_en_empresa) ? ` desde el ${fechaDe(d.desde_en_empresa)}` : ""}` },
      { etiqueta: "Lo declaró", valor: "El funcionario, en su Declaración Jurada de Intereses (Contraloría)", soloPanel: true },
      delProceso(),
    );
  } else if (t === "interes_declarado" || t === "empleo_declarado") {
    const p = a.socios[0];
    const sec = num(d.seccion);
    const empleo = t === "empleo_declarado";
    const que = empleo
      ? "Haber trabajado para la empresa o haberla asesorado"
      : sec === 1 ? "Tener acciones o participación en la empresa" : sec === 2 ? "Tener un poder o la representación de la empresa" : "Tener un asiento en su directorio";
    add(
      p?.nombre && { etiqueta: "Quién lo declaró", valor: `${p.nombre}${p.rol ? ` (${p.rol.toLowerCase()} de la entidad)` : ""}` },
      { etiqueta: "Qué declaró", valor: que },
      txt(d.detalle) && { etiqueta: "Detalle", valor: oracion(txt(d.detalle)!) },
      txt(d.desde) && { etiqueta: "Periodo", valor: `Desde el ${fechaDe(d.desde)}${txt(d.hasta) ? ` hasta el ${fechaDe(d.hasta)}` : " hasta hoy"}` },
      d.dentro === true && { etiqueta: "Al llegar la buena pro", valor: empleo ? "Todavía trabajaba para la empresa" : "Declaraba ese vínculo" },
      d.dentro === false && { etiqueta: "Al llegar la buena pro", valor: empleo ? "Ya estaba en la entidad" : "Fuera del periodo que declaró" },
      num(d.ejercicio) && { etiqueta: "Declaración del año", valor: String(num(d.ejercicio)), soloPanel: true },
      delProceso(),
    );
  } else if (t === "empresa_espejo") {
    const rolAlla = papeles(txt(d.rol_alla));
    add(
      quien(),
      otraEmpresa(d.sancionada_ruc, d.sancionada, "También está en"),
      rolAlla && { etiqueta: "Su papel allá", valor: rolAlla },
      {
        etiqueta: "Sanción de esa empresa",
        valor: `${d.definitiva === true ? "Inhabilitación definitiva" : "Inhabilitación temporal"}${rangoDe(d.desde, d.hasta) ? ` (${rangoDe(d.desde, d.hasta)})` : ""}`,
      },
      txt(d.resolucion) && { etiqueta: "Resolución", valor: txt(d.resolucion), mono: true, soloPanel: true },
      txt(d.fundada) && { etiqueta: "Esta empresa se fundó", valor: fechaDe(d.fundada), soloPanel: true },
      delProceso(),
    );
  }
  // ── Competencia: postores vinculados, domicilio, único postor, otro postor ──
  else if (t === "turno_postores") {
    const via = txt(d.vinculo) ?? "";
    const comparten = [via.includes("persona") && "un socio, representante o directivo (RNP)", via.includes("domicilio") && "el domicilio fiscal (SUNAT)"].filter(
      (x): x is string => !!x,
    );
    const juntos = num(d.juntos);
    add(
      otraEmpresa(d.otra_ruc, d.otra, "Con"),
      comparten.length > 0 && { etiqueta: "Comparten", valor: mayus(listaY(comparten)) },
      juntos != null && { etiqueta: "Compitieron juntas", valor: `En ${plural(juntos, "proceso", "procesos")} con pocos postores` },
      { etiqueta: "Quién ganó", valor: `Esta empresa, ${numero(num(d.gano_esta) ?? 0)}; la otra, ${numero(num(d.gano_otra) ?? 0)}` },
      delProceso(),
    );
  } else if (t === "domicilio_compartido") {
    const postores = empresas(
      (Array.isArray(d.postores) ? (d.postores as { ruc?: unknown; nombre?: unknown }[]) : [])
        .filter((o) => typeof o.ruc === "string")
        .map((o) => ({ ruc: o.ruc as string, nombre: txt(o.nombre) })),
    );
    const enDir = num(d.empresas_en_domicilio);
    const juntas = num(d.procesos_juntas);
    add(
      txt(d.domicilio) && { etiqueta: "Domicilio fiscal", valor: tituloNatural(txt(d.domicilio)!) },
      postores.length > 0
        ? { etiqueta: "Lo comparte con", valor: postores.map((o) => o.texto).join(", "), lista: postores }
        : { etiqueta: "Lo comparte con", valor: plural(num(d.otros_postores) ?? 1, "otro participante del proceso", "otros participantes del proceso") },
      enDir != null && { etiqueta: "Empresas en esa dirección", valor: numero(enDir) },
      juntas != null && juntas > 0 && { etiqueta: "Otros procesos en que se presentaron juntas", valor: numero(juntas) },
      delProceso(),
    );
  } else if (t === "unico_postor") {
    const razon = num(d.razon);
    const adj = num(d.adjudicado) ?? a.montoSoles;
    add(
      { etiqueta: "Postores", valor: "Uno solo: no hubo competencia" },
      num(d.referencial) != null && { etiqueta: "Valor referencial", valor: soles(num(d.referencial)), mono: true },
      adj != null && { etiqueta: "Ganó por", valor: `${soles(adj)}${razon != null ? ` (el ${pct(razon * 100)} del referencial)` : ""}` },
      delProceso(),
    );
  } else if (t === "otro_postor") {
    const p = num(d.porcentaje);
    add(
      otraEmpresa(d.ruc_original, d.proveedor_original, "Primero ganó"),
      num(d.monto_original) != null && { etiqueta: "Por", valor: soles(num(d.monto_original)), mono: true },
      num(d.monto_contratado) != null && {
        etiqueta: "Se le adjudicó a esta empresa por",
        valor: `${soles(num(d.monto_contratado))}${p ? ` (${p > 0 ? "+" : "−"}${numero(Math.abs(p))} %)` : ""}`,
      },
      delProceso(),
    );
  }
  // ── Su historia con la entidad: recurrente, cautivo, fraccionamiento, adicionales, sobreprecio, recién fundada ──
  else if (t.startsWith("recurrente")) {
    const part = num(d.participacion);
    const procs = num(d.procesos);
    add(
      entidad(),
      procs != null && { etiqueta: "Procesos que ya le había ganado", valor: `${numero(procs)}${rangoDe(d.desde, d.hasta) ? ` (${rangoDe(d.desde, d.hasta)})` : ""}` },
      monto("Por"),
      part != null && {
        etiqueta: "Su parte de lo que adjudicó la entidad",
        valor: `${part > 0 && part < 0.001 ? "Menos del 0.1 %" : pct(part * 100)}${num(d.procesos_entidad) ? ` (de ${plural(num(d.procesos_entidad)!, "proceso", "procesos")})` : ""}`,
      },
      delProceso().filter((x) => x.etiqueta !== "Entidad"),
    );
  } else if (t === "proveedor_cautivo") {
    const parte = num(d.parte);
    const total = num(d.total_empresa);
    add(
      entidad(txt(d.entidad) ?? a.entidad, a.entidadRuc, "Entidad de la que depende"),
      parte != null && { etiqueta: "Parte de lo que le adjudica el Estado", valor: pct(parte * 100, 0) },
      total != null && { etiqueta: "Todo lo que el Estado le adjudicó", valor: `${soles(total)}${num(d.procesos) ? ` en ${plural(num(d.procesos)!, "proceso", "procesos")}` : ""}` },
      monto("En este proceso"),
      delProceso().filter((x) => x.etiqueta !== "Entidad"),
    );
  } else if (t === "fraccionamiento") {
    // Los días con el año siempre: el rango cruza años («10 dic. 2020 al 19 feb.» no decía de qué año era el final).
    const desde = txt(d.desde)?.slice(0, 10);
    const hasta = txt(d.hasta)?.slice(0, 10);
    const rango = desde && hasta ? (desde === hasta ? `el ${conAnio(desde)}` : `del ${conAnio(desde)} al ${conAnio(hasta)}`) : null;
    const dias = num(d.dias);
    const misma = num(d.misma_descripcion);
    add(
      { etiqueta: "Días", valor: [dias != null ? plural(dias, "día", "días") : null, rango].filter(Boolean).join(", ") || null },
      num(d.ordenes) != null && { etiqueta: "Órdenes", valor: numero(num(d.ordenes)!) },
      num(d.total) != null && { etiqueta: "Juntas suman", valor: soles(num(d.total)), mono: true },
      misma ? { etiqueta: "Con la misma descripción", valor: `En ${plural(misma, "de esos días", "de esos días")}, todas las órdenes dicen lo mismo` } : null,
      delProceso(),
    );
  } else if (t.startsWith("adicional")) {
    const p = num(d.porcentaje);
    const adic = num(d.adicional);
    add(
      txt(d.contrato) && { etiqueta: "Contrato", valor: txt(d.contrato), mono: true, href: txt(d.url_contrato), fuera: true },
      num(d.contratado) != null && { etiqueta: "Contratado", valor: soles(num(d.contratado)), mono: true },
      { etiqueta: "Adicionales", valor: adic ? `${soles(adic)}${p != null ? ` (el ${pct(p)} del contrato)` : ""}` : "Ninguno" },
      num(d.reduccion) ? { etiqueta: "Reducciones", valor: soles(num(d.reduccion)), mono: true } : null,
      num(d.prorroga) ? { etiqueta: "Prórrogas", valor: soles(num(d.prorroga)), mono: true } : null,
      num(d.complementario) ? { etiqueta: "Complementarios", valor: soles(num(d.complementario)), mono: true } : null,
      delProceso(),
    );
  } else if (t.startsWith("sobreprecio")) {
    const p = (d.peor ?? {}) as Record<string, unknown>;
    const razon = num(p.razon);
    const items = num(d.items);
    add(
      txt(p.descripcion) && { etiqueta: "Ítem", valor: oracion(txt(p.descripcion)!) },
      num(p.unitario) != null && { etiqueta: "Pagó por unidad", valor: `${soles(num(p.unitario))}${txt(p.unidad) ? ` por ${txt(p.unidad)!.toLowerCase()}` : ""}` },
      num(p.mediana) != null && {
        etiqueta: "Mediana en otras entidades",
        valor: `${soles(num(p.mediana))}${num(p.entidades) ? ` (${plural(num(p.entidades)!, "entidad", "entidades")})` : ""}${razon ? `: ${razon.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces más` : ""}`,
      },
      (num(d.exceso) ?? a.montoSoles) != null && { etiqueta: "Por encima del rango habitual", valor: soles(num(d.exceso) ?? a.montoSoles), mono: true },
      items != null && items > 1 && { etiqueta: "Ítems por encima de lo habitual", valor: numero(items) },
      delProceso(),
    );
  } else if (t.startsWith("recien_fundada")) {
    const m = num(d.monto) ?? a.montoSoles;
    add(
      txt(d.fundada) && { etiqueta: "Alta en la SUNAT", valor: fechaDe(d.fundada) },
      txt(d.buena_pro) && { etiqueta: "Ganó la buena pro", valor: fechaDe(d.buena_pro) },
      { etiqueta: "Tenía de fundada", valor: tiempoDeFundada(num(d.meses), num(d.dias)) },
      m != null && { etiqueta: "Por", valor: `${soles(m)}${d.millonario === true ? " (un contrato millonario)" : ""}` },
      delProceso(),
    );
  }
  // ── La obra (INFOBRAS) y la inversión (Invierte.pe) del contrato ──
  else if (esTipoObra(t)) {
    const obra = txt(d.nombre_obra);
    const inversion = txt(d.nombre_inversion);
    const codObra = txt(d.obra);
    const cui = txt(d.cui);
    add(
      {
        etiqueta: "Lo que registra la fuente",
        valor: fraseBandera({ ...d, tipo: t, severidad: a.severidad } as BanderaObra, d.rol === "supervision" ? "La obra que supervisa" : t.startsWith("inversion_") ? "La inversión" : "La obra"),
      },
      obra && { etiqueta: d.rol === "supervision" ? "Obra que supervisa" : "Obra", valor: `${oracion(obra)}${codObra ? ` (INFOBRAS ${codObra})` : ""}`, href: codObra ? obraInfobras(codObra) : null, fuera: true },
      txt(d.estado_obra) && { etiqueta: "Estado de la obra", valor: oracion(txt(d.estado_obra)!) },
      inversion && { etiqueta: "Inversión", valor: `${oracion(inversion)}${cui ? ` (CUI ${cui})` : ""}`, href: cui ? inversionSsi(cui) : null, fuera: true },
      delProceso(),
    );
  } else {
    // Un tipo nuevo que esta lista todavía no conoce: lo que se pueda decir sin adivinar.
    add(
      quien(),
      partido(txt(d.organizacion) ?? txt(d.partido), d.proceso ?? a.fecha),
      txt(d.cargo) && { etiqueta: "Cargo", valor: oracion(txt(d.cargo)!) },
      monto(),
      delProceso(),
    );
  }

  // La fecha del registro, si ningún dato ya la dice (vigencia, días, periodo, cuándo…).
  const conFecha = ["Vigencia", "Días", "Entre", "Periodo", "Cuándo", "Ganó la buena pro", "Antes de la convocatoria"];
  if (a.fecha && !items.some((i) => conFecha.includes(i.etiqueta))) items.push({ etiqueta: "Fecha del registro", valor: fechaCorta(a.fecha), mono: true, soloPanel: true });
  return items.filter((i) => i.valor);
}

/**
 * La persona del caso para el pie de su panel: a «Su gente» (socios, representantes, directivos) o a sus visitas. Sin
 * persona (sanción, penalidad, proceso), nada.
 */
export function aSuGente(a: AntecedenteEmpresa, ruc: string): { texto: string; href: string } | null {
  if (a.visitas.length) return { texto: "Ver las visitas de su gente", href: rutaEmpresa(ruc, "visitas") };
  if (a.socios.length && a.tipo !== "interes_declarado" && a.tipo !== "empleo_declarado") return { texto: "Ver a su gente", href: rutaEmpresa(ruc, "socios") };
  return null;
}
