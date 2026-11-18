/**
 * La red de una empresa (vista «Red» de «Su gente» en su ficha), con lo que su ficha ya trae: sus socios, representantes
 * y directivos (con un apellido tapado, como los da la API), las otras empresas en que figuran esas mismas personas, las
 * empresas socias de ella y de las que ella es socia, y sus clientes del Estado con lo que le compró cada uno.
 *
 * Mismos tipos que la red de una persona (lib/redPersona.ts): la dibuja el mismo componente. Sin importaciones de
 * ejecución, para probarla con `node --test`.
 */
import type { ClienteEmpresa, SociosEmpresa } from "./empresas";
import type { AristaRed, FormatoRed, NodoRed, RedDePersona, SeveridadRed } from "./redPersona";

export interface OpcionesRedEmpresa {
  maxEntidades?: number;
  maxEmpresas?: number;
  maxPersonas?: number;
  formato?: Partial<FormatoRed>;
}

const FORMATO_SIMPLE: FormatoRed = {
  nombre: (s) => s,
  soles: (n) => `S/ ${Math.round(n).toLocaleString("es-PE")}`,
  mes: (s) => s.slice(0, 7),
  fecha: (s) => s.slice(0, 10),
};
const esRuc20 = (r: string | null | undefined): r is string => !!r && /^20\d{9}$/.test(r);
const veces = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;
const normal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();

export const idEmpresaRed = (ruc: string) => `m:${ruc}`;

export function redDeEmpresa(
  empresa: { ruc: string; nombre: string },
  socios: SociosEmpresa | null,
  clientes: ClienteEmpresa[],
  opciones: OpcionesRedEmpresa = {},
): RedDePersona {
  const fmt: FormatoRed = { ...FORMATO_SIMPLE, ...opciones.formato };
  const maxEntidades = opciones.maxEntidades ?? 12;
  const maxEmpresas = opciones.maxEmpresas ?? 12;
  const maxPersonas = opciones.maxPersonas ?? 10;
  const foco = idEmpresaRed(empresa.ruc);
  const nodos: NodoRed[] = [];
  const aristas: AristaRed[] = [];

  // 1. Sus clientes del Estado: lo adjudicado más lo ordenado, de mayor a menor.
  const cl = [...clientes]
    .map((c) => ({ ...c, total: (c.adjudicado ?? 0) + (c.ordenado ?? 0) }))
    .filter((c) => esRuc20(c.entidadRuc) && c.total > 0)
    .sort((a, b) => b.total - a.total);
  const total = cl.reduce((s, c) => s + c.total, 0);
  nodos.push({
    id: foco, tipo: "empresa", nombre: fmt.nombre(empresa.nombre), rol: "La empresa de esta ficha", href: null,
    monto: total || null, datos: cl.length ? [{ etiqueta: "Clientes del Estado", valor: veces(cl.length, "entidad", "entidades") }] : [],
  });
  for (const c of cl.slice(0, maxEntidades)) {
    const id = `e:${c.entidadRuc}`;
    nodos.push({ id, tipo: "entidad", nombre: c.entidad ? fmt.nombre(c.entidad) : "Entidad sin nombre", rol: "Le compra a la empresa", href: `/entidad/${c.entidadRuc}`, monto: c.total, datos: [] });
    const partes = [
      c.contratos ? `${veces(c.contratos, "contrato", "contratos")}${c.adjudicado ? ` por ${fmt.soles(c.adjudicado)}` : ""}${c.consorcio ? " (alguno en consorcio)" : ""}` : null,
      c.ordenes ? `${veces(c.ordenes, "orden", "órdenes")}${c.ordenado ? ` por ${fmt.soles(c.ordenado)}` : ""}` : null,
    ].filter(Boolean);
    aristas.push({ de: foco, a: id, tipo: "vende", texto: `le vendió ${partes.join(" y ")}${c.visitas ? `; su gente la visitó ${veces(c.visitas, "vez", "veces")}` : ""}` });
  }

  // 2. Su gente: primero quien sigue y quien tiene algo en el Estado; las que ya no figuran, después.
  const gente = [...(socios?.socios ?? [])]
    .sort((a, b) => Number(!!a.salio) - Number(!!b.salio) || Number(!!b.enElEstado) - Number(!!a.enElEstado) || b.otrasEmpresas - a.otrasEmpresas);
  const porNombre = new Map<string, string>();
  for (const [i, s] of gente.slice(0, maxPersonas).entries()) {
    const id = `s:${i}`;
    const estado = s.enElEstado;
    let severidad: SeveridadRed | null = null;
    if (estado?.ventasASuEntidad?.length) severidad = "alta";
    else if (estado?.autoridad || estado?.locador?.clientes) severidad = "media";
    const datos: NodoRed["datos"] = [];
    if (estado?.autoridad?.cargo) datos.push({ etiqueta: "Cargo de elección", valor: `${fmt.nombre(estado.autoridad.cargo)}${estado.autoridad.vigente ? " (vigente)" : ""}` });
    if (estado?.locador) datos.push({ etiqueta: "Locador del Estado", valor: `${veces(estado.locador.entidades, "entidad", "entidades")} por ${fmt.soles(estado.locador.monto)}` });
    if (s.otrasEmpresas) datos.push({ etiqueta: "Otras empresas en que figura", valor: veces(s.otrasEmpresas, "empresa", "empresas") });
    nodos.push({ id, tipo: "persona", nombre: s.nombre, rol: s.salio ? `${s.roles.join(", ")} (ya no figura desde ${fmt.fecha(s.salio)})` : s.roles.join(", ") || "Figura en la empresa", severidad, datos });
    porNombre.set(normal(s.nombre), id);
    aristas.push({ de: id, a: foco, tipo: "socio", texto: `${s.roles.join(", ").toLowerCase() || "figura"}${s.desde ? ` desde ${fmt.fecha(s.desde)}` : ""}${s.salio ? `; ya no figura desde ${fmt.fecha(s.salio)}` : ""}` });
  }

  // 3. Las otras empresas de su gente (y si le venden al Estado), las más grandes primero.
  const vinc = [...(socios?.vinculadas ?? [])].filter((v) => esRuc20(v.ruc) && v.ruc !== empresa.ruc)
    .sort((a, b) => Number(!!b.inhabilitada) - Number(!!a.inhabilitada) || b.graves - a.graves || b.monto - a.monto);
  let empresasFuera = Math.max(0, vinc.length - maxEmpresas);
  for (const v of vinc.slice(0, maxEmpresas)) {
    const id = idEmpresaRed(v.ruc);
    const severidad: SeveridadRed | null = v.inhabilitada ? "alta" : v.graves > 0 ? "media" : null;
    const datos: NodoRed["datos"] = [];
    if (v.inhabilitada) datos.push({ etiqueta: "Sanción", valor: v.inhabilitada });
    if (v.contratos) datos.push({ etiqueta: "Contratos con el Estado", valor: `${veces(v.contratos, "contrato", "contratos")}${v.monto ? ` por ${fmt.soles(v.monto)}` : ""}` });
    if (v.antecedentes) datos.push({ etiqueta: "Antecedentes", valor: `${veces(v.antecedentes, "tipo", "tipos")}${v.graves ? `, ${veces(v.graves, "grave", "graves")}` : ""}` });
    nodos.push({ id, tipo: "empresa", nombre: v.nombre ? fmt.nombre(v.nombre) : `RUC ${v.ruc}`, rol: v.vende ? "Comparte personas y le vende al Estado" : "Comparte personas", href: `/empresa/${v.ruc}`, monto: v.monto || null, severidad, datos });
    let unida = false;
    for (const s of v.socios) {
      const pid = porNombre.get(normal(s.nombre));
      if (!pid) continue;
      unida = true;
      aristas.push({ de: pid, a: id, tipo: "socio", texto: `allá: ${s.rolesAlla.join(", ").toLowerCase() || "figura"}` });
    }
    if (!unida) aristas.push({ de: foco, a: id, tipo: "socio", texto: `comparte ${veces(v.socios.length, "persona", "personas")} con esta empresa` });
  }

  // 4. Empresas socias de ella y de las que ella es socia.
  for (const x of socios?.empresasSocias ?? []) {
    if (!esRuc20(x.ruc) || x.ruc === empresa.ruc || nodos.some((n) => n.id === idEmpresaRed(x.ruc!))) continue;
    if (nodos.filter((n) => n.tipo === "empresa").length > maxEmpresas) { empresasFuera++; continue; }
    nodos.push({ id: idEmpresaRed(x.ruc), tipo: "empresa", nombre: fmt.nombre(x.nombre), rol: "Socia de esta empresa", href: `/empresa/${x.ruc}`, datos: [] });
    aristas.push({ de: idEmpresaRed(x.ruc), a: foco, tipo: "socio", texto: `${x.roles.join(", ").toLowerCase() || "socia"}${x.salio ? `; ya no figura desde ${fmt.fecha(x.salio)}` : ""}` });
  }
  for (const x of socios?.sociaDe ?? []) {
    if (!esRuc20(x.ruc) || x.ruc === empresa.ruc || nodos.some((n) => n.id === idEmpresaRed(x.ruc))) continue;
    if (nodos.filter((n) => n.tipo === "empresa").length > maxEmpresas) { empresasFuera++; continue; }
    nodos.push({ id: idEmpresaRed(x.ruc), tipo: "empresa", nombre: x.nombre ? fmt.nombre(x.nombre) : `RUC ${x.ruc}`, rol: "Esta empresa es su socia", href: `/empresa/${x.ruc}`, datos: [] });
    aristas.push({ de: foco, a: idEmpresaRed(x.ruc), tipo: "socio", texto: `es su ${x.roles.join(", ").toLowerCase() || "socia"}` });
  }

  return {
    nodos,
    aristas,
    fuera: { entidades: Math.max(0, cl.length - maxEntidades), empresas: empresasFuera, parientes: 0, personas: Math.max(0, gente.length - maxPersonas) },
  };
}
