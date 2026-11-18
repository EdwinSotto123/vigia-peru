/**
 * La red de una persona con cargo público (pestaña «Red» de /app/personas/cargo/<código>), armada con lo que su ficha ya
 * trae: dónde trabajó (planilla y declaraciones juradas), a qué entidades fue (visitas), de qué empresas es socia o
 * representante (RNP), a quién le vendieron esas empresas (los cruces de la ficha), qué empresas la visitaron y le ganaron
 * después a su entidad, las órdenes a su nombre y su familia declarada, con lo que cada familiar obtuvo del Estado.
 *
 * Sin consultas nuevas: es otra forma de leer la misma ficha. Privacidad: los familiares nunca llevan nombre (sólo su
 * parentesco, como en la pestaña Familia) y lo que va reservado sigue sin cifras. Sin importaciones de ejecución (sólo
 * tipos), para probarla con `node --test`: el formato de nombres y montos lo pasa quien la usa.
 */
import type { FichaFuncionario, ItemFamiliar } from "./funcionarios";

export type TipoNodoRed = "persona" | "pariente" | "empresa" | "entidad";
/** trabajo: planilla o cargo declarado; visita: fue a la entidad (o la gente de una empresa la visitó a ella); socio: socio,
 *  representante o directivo; vende: la empresa le vendió a la entidad; cobra: órdenes a nombre de una persona;
 *  pariente: familiar que declaró. */
export type TipoAristaRed = "trabajo" | "visita" | "socio" | "vende" | "cobra" | "pariente";
export type SeveridadRed = "alta" | "media";

export interface NodoRed {
  id: string;
  tipo: TipoNodoRed;
  nombre: string;
  rol: string;
  href?: string | null;
  monto?: number | null;
  severidad?: SeveridadRed | null;
  datos: { etiqueta: string; valor: string }[];
}
export interface AristaRed {
  de: string;
  a: string;
  tipo: TipoAristaRed;
  texto: string;
  severidad?: SeveridadRed | null;
}
export interface RedDePersona {
  nodos: NodoRed[];
  aristas: AristaRed[];
  /** Lo que no entró en el dibujo (está en sus pestañas). */
  fuera: { entidades: number; empresas: number; parientes: number };
}

export interface FormatoRed {
  nombre: (s: string) => string;
  soles: (n: number) => string;
  /** «2026-06» → «jun. 2026». */
  mes: (s: string) => string;
  /** «2026-06-14» → «14 jun. 2026». */
  fecha: (s: string) => string;
}

const FORMATO_SIMPLE: FormatoRed = {
  nombre: (s) => s,
  soles: (n) => `S/ ${Math.round(n).toLocaleString("es-PE")}`,
  mes: (s) => s.slice(0, 7),
  fecha: (s) => s.slice(0, 10),
};

export interface OpcionesRed {
  maxEntidades?: number;
  maxEmpresas?: number;
  maxParientes?: number;
  formato?: Partial<FormatoRed>;
}

const esRuc20 = (r: string | null | undefined): r is string => !!r && /^20\d{9}$/.test(r);
const veces = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;

export const ID_PERSONA = "p";
const idEntidad = (ruc: string) => `e:${ruc}`;
const idEmpresa = (ruc: string) => `m:${ruc}`;

/** La red de la persona; vacía (sólo ella) si la ficha no une nada. */
export function redDePersona(f: FichaFuncionario, opciones: OpcionesRed = {}): RedDePersona {
  const fmt: FormatoRed = { ...FORMATO_SIMPLE, ...opciones.formato };
  const maxEntidades = opciones.maxEntidades ?? 14;
  const maxEmpresas = opciones.maxEmpresas ?? 12;
  const maxParientes = opciones.maxParientes ?? 8;

  const entidades = new Map<string, NodoRed & { peso: number }>();
  const empresas = new Map<string, NodoRed & { peso: number }>();
  const aristas: AristaRed[] = [];
  const vistas = new Set<string>();
  const unir = (a: AristaRed) => {
    const k = `${a.de}|${a.a}|${a.tipo}|${a.texto}`;
    if (vistas.has(k)) return;
    vistas.add(k);
    aristas.push(a);
  };
  const entidad = (ruc: string | null | undefined, nombre: string | null | undefined, peso: number): string | null => {
    if (!esRuc20(ruc)) return null;
    const id = idEntidad(ruc);
    const n = entidades.get(id);
    if (n) {
      n.peso += peso;
      if (n.nombre === "Entidad sin nombre" && nombre) n.nombre = fmt.nombre(nombre);
    } else {
      entidades.set(id, { id, tipo: "entidad", nombre: nombre ? fmt.nombre(nombre) : "Entidad sin nombre", rol: "Entidad pública", href: `/entidad/${ruc}`, datos: [], peso });
    }
    return id;
  };
  const empresa = (ruc: string | null | undefined, nombre: string | null | undefined, rol: string, peso: number): string | null => {
    if (!esRuc20(ruc)) return null;
    const id = idEmpresa(ruc);
    const n = empresas.get(id);
    if (n) {
      n.peso += peso;
      if (n.nombre === "Empresa sin nombre" && nombre) n.nombre = fmt.nombre(nombre);
    } else {
      empresas.set(id, { id, tipo: "empresa", nombre: nombre ? fmt.nombre(nombre) : "Empresa sin nombre", rol, href: `/empresa/${ruc}`, datos: [], peso });
    }
    return id;
  };
  const marcar = (n: NodoRed | undefined, s: SeveridadRed) => {
    if (n && n.severidad !== "alta") n.severidad = s;
  };
  const sumar = (n: (NodoRed & { peso: number }) | undefined, m: number | null | undefined) => {
    if (n && m != null && m > 0) n.monto = (n.monto ?? 0) + m;
  };
  const periodo = (a: string | null | undefined, b: string | null | undefined, f: (s: string) => string) =>
    a && b ? (a === b ? `en ${f(a)}` : `de ${f(a)} a ${f(b)}`) : a ? `desde ${f(a)}` : b ? `hasta ${f(b)}` : "";

  // 1. Donde trabajó: planilla y cargos que declaró.
  for (const p of f.planilla) {
    const e = entidad(p.entidadRuc, p.entidad, 6);
    if (!e) continue;
    const cargo = p.cargo ? fmt.nombre(p.cargo) : "sin cargo publicado";
    unir({ de: ID_PERSONA, a: e, tipo: "trabajo", texto: `${p.situacion === "hoy" ? "en su planilla hoy" : "estuvo en su planilla"} (${cargo}${p.primerMes || p.ultimoMes ? `, ${periodo(p.primerMes, p.ultimoMes, fmt.mes)}` : ""})` });
  }
  for (const c of f.cargos) {
    const e = entidad(c.entidadRuc, c.entidad, 5);
    if (!e) continue;
    const cargo = c.cargoReal || c.cargo;
    unir({ de: ID_PERSONA, a: e, tipo: "trabajo", texto: `declaró el cargo ${cargo ? fmt.nombre(cargo) : "sin detalle"}${c.inicio || c.cese ? ` (${periodo(c.inicio, c.cese, fmt.fecha)})` : ""}` });
  }

  // 2. A qué entidades fue.
  for (const v of f.visitas.filas) {
    const e = entidad(v.entidad_ruc, v.entidad, Math.min(4, 1 + Math.log2(1 + v.visitas)));
    if (!e) continue;
    unir({ de: ID_PERSONA, a: e, tipo: "visita", texto: `la visitó ${veces(v.visitas, "vez", "veces")}${v.primera || v.ultima ? ` (${periodo(v.primera, v.ultima, fmt.fecha)})` : ""}` });
  }

  // 3. Sus empresas (RNP) y a quién le vendieron (los cruces de la ficha).
  for (const m of f.empresas) {
    const id = empresa(m.ruc, m.empresa, "Empresa en que figura", 6);
    if (!id) continue;
    unir({ de: ID_PERSONA, a: id, tipo: "socio", texto: `${m.rol ? m.rol.toLowerCase() : "figura"}${m.desde ? ` desde ${fmt.fecha(m.desde)}` : ""}` });
  }
  const c = f.cruces;
  for (const x of c.visitoYSuEmpresaGano) {
    const m = empresa(x.empresa_ruc, x.empresa, "Empresa en que figura", 4);
    const e = entidad(x.entidad_ruc, x.entidad, 4);
    if (!m || !e) continue;
    const s: SeveridadRed = x.visito_antes_de_ganar ? "alta" : "media";
    sumar(empresas.get(m), x.monto_soles);
    marcar(empresas.get(m), s);
    unir({ de: m, a: e, tipo: "vende", severidad: s, texto: `le ganó ${veces(x.procesos_ganados, "proceso", "procesos")}${x.monto_soles ? ` por ${fmt.soles(x.monto_soles)}` : ""}${x.visito_antes_de_ganar ? "; la persona la visitó antes de alguna buena pro" : ""}` });
  }
  for (const x of c.salioYSuEmpresaGano) {
    const m = empresa(x.empresa_ruc, x.empresa, "Empresa en que figura", 4);
    const e = entidad(x.entidad_ruc, x.entidad, 4);
    if (!m || !e) continue;
    sumar(empresas.get(m), x.monto_soles);
    marcar(empresas.get(m), "alta");
    unir({ de: m, a: e, tipo: "vende", severidad: "alta", texto: `le ganó ${veces(x.procesos_ganados_despues, "proceso", "procesos")}${x.monto_soles ? ` por ${fmt.soles(x.monto_soles)}` : ""} después de que la persona dejó su planilla` });
  }
  for (const x of c.variasEmpresasEnUnaEntidad) {
    const e = entidad(x.entidad_ruc, x.entidad, 3);
    if (!e) continue;
    for (const m0 of x.empresas ?? []) {
      const m = empresa(m0.ruc, m0.nombre, "Empresa en que figura", 2);
      if (!m) continue;
      marcar(empresas.get(m), x.con_90_dias_o_menos_entre_si > 0 ? "alta" : "media");
      unir({ de: m, a: e, tipo: "vende", severidad: x.con_90_dias_o_menos_entre_si > 0 ? "alta" : "media", texto: `una de ${veces((x.empresas ?? []).length, "empresa suya", "empresas suyas")} que ganaron ${veces(x.contratos_con_objeto_parecido, "contrato", "contratos")} de objeto parecido` });
    }
  }
  for (const x of c.empresaInhabilitadaYOtraGano) {
    const a = empresa(x.empresa_inhabilitada_ruc, x.empresa_inhabilitada, "Empresa en que figura", 3);
    const b = empresa(x.empresa_que_gano_ruc, x.empresa_que_gano, "Empresa en que figura", 3);
    if (a) {
      marcar(empresas.get(a), "alta");
      empresas.get(a)!.datos.push({ etiqueta: "Sanción", valor: `${x.sancion ?? "inhabilitación"}${x.sancion_desde ? ` desde ${fmt.fecha(x.sancion_desde)}` : ""}` });
    }
    if (b) {
      marcar(empresas.get(b), "alta");
      empresas.get(b)!.datos.push({ etiqueta: "Durante la sanción de otra empresa suya", valor: `ganó ${veces(x.procesos_ganados_durante_la_sancion, "proceso", "procesos")}${x.monto_soles ? ` por ${fmt.soles(x.monto_soles)}` : ""}` });
    }
  }

  // 4. Las empresas cuya gente la visitó en su entidad y le ganaron después.
  for (const r of f.recibidas?.filas ?? []) {
    if (!r.ganoDespues) continue;
    const m = empresa(r.ruc, r.empresa, "Su gente la visitó", 3);
    const e = entidad(r.entidadRuc, r.entidad, 2);
    if (!m || !e) continue;
    sumar(empresas.get(m), r.montoDespues);
    marcar(empresas.get(m), "media");
    unir({ de: m, a: ID_PERSONA, tipo: "visita", texto: `su gente la visitó ${veces(r.visitas, "vez", "veces")} en ${entidades.get(e)?.nombre ?? "su entidad"}` });
    unir({ de: m, a: e, tipo: "vende", severidad: "media", texto: `le ganó ${veces(r.ganoDespues, "proceso", "procesos")}${r.montoDespues ? ` por ${fmt.soles(r.montoDespues)}` : ""} después de esas visitas` });
  }

  // 5. Órdenes a su nombre, como persona natural.
  for (const o of f.ordenes) {
    const e = entidad(o.entidad_ruc, o.entidad, 3);
    if (!e) continue;
    unir({ de: ID_PERSONA, a: e, tipo: "cobra", texto: `${veces(o.ordenes, "orden", "órdenes")} a su nombre${o.monto ? ` por ${fmt.soles(o.monto)}` : ""}` });
  }
  // Lo que pide revisión de ella: el informe de control y lo que la entidad le pagó después.
  for (const x of c.enInformeYDespuesCobro) {
    const e = entidad(x.entidad_ruc, x.entidad, 3);
    if (e) marcar(entidades.get(e), "media");
  }

  // 6. Su familia declarada: un nodo por parentesco (sin nombre) y lo que obtuvo cada uno.
  const parientes: NodoRed[] = [];
  const fam = f.familia;
  let parientesFuera = 0;
  if (fam) {
    // Primero quienes obtuvieron algo de su entidad, después los que obtuvieron algo, después el resto.
    const orden = [...fam.parientes].sort((a, b) => puntaje(b.items) - puntaje(a.items));
    for (const [i, g] of orden.entries()) {
      if (!g.items.length) continue;
      if (parientes.length >= maxParientes) {
        parientesFuera++;
        continue;
      }
      const id = `f:${i}`;
      const enSu = g.items.some((x) => x.suEntidad);
      // `n` es el número del familiar en su declaración (no una cantidad): sólo se dice si dos comparten parentesco.
      const repetido = orden.filter((o) => o.items.length && o.parentesco === g.parentesco).length > 1;
      const nodo: NodoRed = {
        id, tipo: "pariente", nombre: repetido ? `${g.parentesco} (familiar ${g.n})` : g.parentesco,
        rol: "Familiar que declaró (sin nombre)", severidad: enSu ? (g.cercano ? "alta" : "media") : null, datos: [],
      };
      parientes.push(nodo);
      unir({ de: ID_PERSONA, a: id, tipo: "pariente", texto: `lo declaró como ${g.parentesco.toLowerCase()}` });
      for (const x of g.items) {
        if (x.tipo === "orden") {
          const e = entidad(x.entidadRuc, x.entidad, x.suEntidad ? 4 : 2);
          if (!e) continue;
          unir({ de: id, a: e, tipo: "cobra", severidad: x.suEntidad ? nodo.severidad : null, texto: textoItem(x, fmt, "recibió") });
        } else {
          const m = empresa(x.empresaRuc, x.empresa, "Empresa de un familiar", x.suEntidad ? 4 : 2);
          if (!m) continue;
          unir({ de: id, a: m, tipo: "socio", texto: `${x.rol ? x.rol.toLowerCase() : "figura"}` });
          if (x.suEntidad) marcar(empresas.get(m), nodo.severidad ?? "media");
          const e = entidad(x.entidadRuc, x.entidad, x.suEntidad ? 4 : 1);
          if (e) unir({ de: m, a: e, tipo: "vende", severidad: x.suEntidad ? nodo.severidad : null, texto: textoItem(x, fmt, "le vendió") });
        }
      }
    }
    parientesFuera += fam.masParientes;
  }

  // Lo más unido primero; lo que no entra se cuenta.
  const porPeso = <T extends { peso: number; severidad?: SeveridadRed | null }>(xs: T[]) =>
    [...xs].sort((a, b) => (b.severidad === "alta" ? 1 : 0) - (a.severidad === "alta" ? 1 : 0) || b.peso - a.peso);
  const ents = porPeso([...entidades.values()]);
  const emps = porPeso([...empresas.values()]);
  const quedan = new Set([ID_PERSONA, ...parientes.map((p) => p.id), ...ents.slice(0, maxEntidades).map((n) => n.id), ...emps.slice(0, maxEmpresas).map((n) => n.id)]);
  // Una empresa o un familiar que se quedó sin ninguna línea a lo que sí entró, no se dibuja suelto.
  const aristasDentro = aristas.filter((a) => quedan.has(a.de) && quedan.has(a.a));
  const conLinea = new Set(aristasDentro.flatMap((a) => [a.de, a.a]));
  const limpio = ({ peso: _p, ...n }: NodoRed & { peso: number }): NodoRed => n;
  const persona: NodoRed = {
    id: ID_PERSONA, tipo: "persona", nombre: f.persona.nombre, rol: f.persona.cargo ? fmt.nombre(f.persona.cargo) : "Persona con cargo público", datos: [],
  };
  const nodos: NodoRed[] = [
    persona,
    ...parientes.filter((n) => conLinea.has(n.id)),
    ...emps.slice(0, maxEmpresas).filter((n) => conLinea.has(n.id)).map(limpio),
    ...ents.slice(0, maxEntidades).filter((n) => conLinea.has(n.id)).map(limpio),
  ];
  return {
    nodos,
    aristas: aristasDentro,
    fuera: { entidades: Math.max(0, ents.length - maxEntidades), empresas: Math.max(0, emps.length - maxEmpresas), parientes: parientesFuera },
  };
}

function puntaje(items: ItemFamiliar[]): number {
  return items.reduce((s, x) => s + (x.suEntidad ? 100 : 0) + (x.tipo === "empresa" ? 2 : 1), 0);
}

function textoItem(x: ItemFamiliar, fmt: FormatoRed, verbo: string): string {
  if (x.reservado) return `${verbo === "recibió" ? "recibió órdenes" : "le vendió"} (cifras reservadas)`;
  const n = x.tipo === "orden" ? x.ordenes : x.procesos ?? x.ordenes;
  const m = x.suEntidad ? x.suEntidadMonto ?? x.monto : x.monto;
  const cuenta = n ? (x.tipo === "orden" ? veces(n, "orden", "órdenes") : x.procesos ? veces(n, "proceso", "procesos") : veces(n, "orden", "órdenes")) : null;
  const anios = x.desde && x.hasta ? (x.desde === x.hasta ? ` en ${x.desde}` : ` de ${x.desde} a ${x.hasta}`) : "";
  return `${verbo}${cuenta ? ` ${cuenta}` : ""}${m ? ` por ${fmt.soles(m)}` : ""}${anios}${x.suEntidad ? " (una entidad en que la persona declaró)" : ""}`;
}
