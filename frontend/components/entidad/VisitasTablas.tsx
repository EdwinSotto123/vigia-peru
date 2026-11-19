import { CeldaFecha, CeldaNumero, CeldaPrincipal, CeldaTexto, type Columna, type Fila } from "@/components/listado";
import { Ayuda, CuerpoDetalle, DatosClave, FuenteDato, Nota, PieDetalle, type DatoClave } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { fecha, fechaConAnio, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { VISITAS_EN_LINEA, registroVisita } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { P_CONTRATOS, P_ORDENES } from "@/lib/parametrosEmpresa";
import { rutaEmpresa } from "@/lib/empresas";
import { rutaContrato } from "@/lib/rutas";
import { P_VISITAS, parentescoLlano, type AreaVisitada, type EmpresaVisitante, type OrganizacionVisitante, type TipoDespues, type VisitaEntidad, type VisitaPariente } from "@/lib/visitas";

/**
 * Las filas de las cinco listas de la pestaña «Visitas» de una entidad (rediseño del 2026-11-18: «mucho scroll, varias
 * tablas… no tiene sentido»). Cada fila mide una línea en escritorio (tabla `compacta`, título y su dato en la misma
 * línea): lo que la distingue a la vista (quién, cuánto, cuándo, una marca) y el resto en su panel. Antes una empresa
 * ocupaba tres renglones («quién la visitó», «dijo venir de…», «nunca le había vendido») y cinco tablas se apilaban.
 * Server-safe: las arman las listas (visitas/ListasVisitas.tsx) con la página que mandó la API.
 */

/** Cómo se reconoce a quien visita (empresa_visita.via): su papel en la empresa según el RNP, o que dijo venir de ella. */
export const ROLES = [
  { clave: "representante", corto: "representante legal", filtro: "Su representante legal" },
  { clave: "socio", corto: "socio", filtro: "Un socio" },
  { clave: "directivo", corto: "directivo", filtro: "Un directivo" },
  { clave: "porNombre", corto: "alguien que dijo venir de ella", filtro: "Alguien que dijo venir de ella" },
] as const;

export const TIPO_DESPUES: Record<TipoDespues, string> = { contrato: "Contrato", consorcio: "Contrato en consorcio", orden: "Orden" };

/** «Orden de servicio N.° 4505540510» / «Contrato CP SER-SM-1-2026-ESSALUD/GCL-1»: CUÁL fue lo primero que le dio. */
function cual(tipo: TipoDespues, num?: string | null, tipoOrden?: string | null): string {
  const t = (tipoOrden ?? "").toLowerCase();
  const base = tipo === "orden" ? (t.includes("servicio") ? "Orden de servicio" : t.includes("compra") ? "Orden de compra" : "Orden") : TIPO_DESPUES[tipo];
  return num ? `${base} ${tipo === "orden" ? "N.° " : ""}${num}` : base;
}

/** Dónde verlo: la orden en la lista de órdenes de la empresa (por su número, en esta entidad) o la ficha del contrato. */
function enlaceDespues(x: EmpresaVisitante, entidadRuc: string): { texto: string; href: string } | null {
  if (x.despuesTipo === "orden") {
    return x.despuesNumero ? { texto: "Ver la orden", href: rutaEmpresa(x.ruc, "ordenes", { [P_ORDENES.entidad]: entidadRuc, [P_ORDENES.q]: x.despuesNumero }) } : null;
  }
  if (x.despuesOcid) return { texto: "Ver el contrato", href: rutaContrato(x.despuesOcid) };
  const q = x.despuesCodigo ?? x.despuesNumero;
  return q ? { texto: "Ver el contrato", href: rutaEmpresa(x.ruc, "contratos", { [P_CONTRATOS.entidad]: entidadRuc, [P_CONTRATOS.q]: q }) } : null;
}

/** «Representante legal y socio»: los papeles de quienes la visitaron. */
function quienes(x: EmpresaVisitante): string {
  const r = ROLES.filter((v) => x[v.clave] > 0).map((v) => v.corto);
  const t = r.length > 1 ? `${r.slice(0, -1).join(", ")} y ${r[r.length - 1]}` : r[0] ?? "su gente";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Qué organización declararon, si no fue la empresa. */
function declaro(x: EmpresaVisitante): string {
  if (x.declaradas >= x.visitas) return "Que venía de la empresa";
  if (x.declaradas > 0) return `Que venía de la empresa en ${numero(x.declaradas)} de ${plural(x.visitas, "visita", "visitas")}`;
  if (x.otraOrg) return `Que venía de ${tituloNatural(x.otraOrg)}`;
  return x.personal > 0 ? "Que iba a título personal" : "No dijo venir de la empresa";
}

/** Del primer día al último: «el 4 de marzo de 2025» o «del 4 mar. 2025 al 9 ene. 2026». */
const periodo = (a: string | null, b: string | null) => (!a ? null : a === b || !b ? `el ${fecha(a)}` : `del ${fechaConAnio(a)} al ${fechaConAnio(b)}`);

/** La URL de la ficha en la lista de todas las visitas, sólo las de una organización («Ver sus visitas»). */
export const hrefVisitasDe = (entidadRuc: string, org: string) =>
  `/entidad/${entidadRuc}?${new URLSearchParams({ seccion: "visitas", [P_VISITAS.sub]: "visitas", [P_VISITAS.visitas.org]: org })}`;

const AVISO_INDICIO = (
  <Nota>Es un indicio para revisar, no una acusación: una visita puede ser un trámite. Pesa más si nunca le había vendido, si la recibió quien decide las compras y si lo que ganó llegó a los pocos días.</Nota>
);

// ─── Empresas que ganaron algo después ──────────────────────────────────────────

export const COLUMNAS_EMPRESAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa y quién la visitó", ancho: "minmax(0,1fr)" },
  {
    clave: "antes", titulo: "Antes de la visita", corto: "Antes", ancho: "9.5rem", desde: "md", apilar: true,
    igual: { frases: { "Nunca le vendía": "Ninguna le había vendido antes de la visita", "Ya le vendía": "Todas ya le vendían antes de la visita" } },
  },
  { clave: "visitas", titulo: "Visitas", ancho: "4.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "despues", titulo: "Ganó después", ancho: "7.5rem", alinear: "der" },
];

export function filaEmpresa(x: EmpresaVisitante, entidadRuc: string): Fila {
  const nombre = x.empresa ? tituloNatural(x.empresa) : `Empresa con RUC ${x.ruc}`;
  const nueva = x.antes === 0;
  const desde = [
    x.contratos > 0 ? plural(x.contratos, "contrato", "contratos") : null,
    x.consorcios > 0 ? plural(x.consorcios, "contrato en consorcio", "contratos en consorcio") : null,
    x.ordenes > 0 ? plural(x.ordenes, "orden", "órdenes") : null,
  ].filter(Boolean);
  const datos: DatoClave[] = [
    { etiqueta: "Visitas", valor: `${plural(x.visitas, "visita", "visitas")} de ${plural(x.visitantes, "persona", "personas")}, ${periodo(x.primera, x.ultima)}` },
    { etiqueta: "Quién la visitó", valor: ROLES.filter((v) => x[v.clave] > 0).map((v) => `${v.filtro}: ${plural(x[v.clave], "visita", "visitas")}`).join("; ") },
    { etiqueta: "Qué declaró", valor: declaro(x) },
    ...(x.decisores > 0 ? [{ etiqueta: "A quien decide", valor: plural(x.decisores, "visita a quien decide las compras", "visitas a quien decide las compras") }] : []),
    {
      etiqueta: "Antes de la primera visita",
      valor: nueva ? "La entidad nunca le había dado un contrato ni una orden (en lo que tenemos cargado)" : plural(x.antes, "contrato u orden", "contratos u órdenes"),
    },
    {
      etiqueta: "Lo primero después",
      valor: `${cual(x.despuesTipo, x.despuesNumero, x.despuesOrden)}, del ${fechaConAnio(x.despues)}${
        x.dias == null ? "" : x.dias === 0 ? ", el día de una visita" : `, a ${plural(x.dias, "día", "días")} de una visita`}`,
    },
    ...(x.despuesDetalle ? [{ etiqueta: "Qué se compró", valor: `«${oracion(x.despuesDetalle)}»` }] : []),
    ...(x.despuesMonto != null
      ? [{ etiqueta: x.despuesTipo === "consorcio" ? "Adjudicado al consorcio" : x.despuesTipo === "orden" ? "Monto de esa orden" : "Adjudicado a la empresa", valor: soles(x.despuesMonto), mono: true }]
      : []),
    { etiqueta: "Desde la primera visita", valor: desde.join(", ") },
    {
      etiqueta: "Suman",
      valor: x.monto > 0 ? `${soles(x.monto)} (sus contratos sola y sus órdenes)` : "Sin monto propio: lo ganó en consorcio o con un monto mal cargado",
      mono: x.monto > 0,
    },
  ];
  const ir = enlaceDespues(x, entidadRuc);
  return {
    id: `e${x.ruc}`,
    celdas: {
      empresa: <CeldaPrincipal enLinea titulo={nombre} meta={[<Dato key="q" tipo="personas" nombre="Quién la visitó">{quienes(x)}</Dato>]} />,
      antes: nueva ? <Badge variant="amber">Nunca le vendía</Badge> : <Badge>Ya le vendía</Badge>,
      visitas: <CeldaNumero>{numero(x.visitas)}</CeldaNumero>,
      despues: (
        <CeldaNumero sub={fechaConAnio(x.despues)}>
          {x.monto > 0 ? solesCompacto(x.monto) : x.consorcios > 0 ? "En consorcio" : "Sin monto"}
        </CeldaNumero>
      ),
    },
    textos: { antes: nueva ? "Nunca le vendía" : "Ya le vendía" },
    detalle: {
      titulo: nombre,
      etiqueta: `Visitas de la gente de ${nombre} y lo que ganó después`,
      contenido: (
        <CuerpoDetalle>
          <DatosClave items={datos} />
          {x.compartidas > 0 && (
            <Nota>
              {x.compartidas >= x.visitas ? "Todas sus visitas son" : plural(x.compartidas, "visita es", "visitas son")} de alguien que figura en más
              de una empresa: no se sabe por cuál de ellas fue.
            </Nota>
          )}
          {AVISO_INDICIO}
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <>
              {ir && <EnlaceAccion href={ir.href} flecha>{ir.texto}</EnlaceAccion>}
              <EnlaceAccion href={rutaEmpresa(x.ruc, "visitas")} variante="secundario">Ver sus visitas</EnlaceAccion>
              {x.contratos + x.consorcios > 0 && (
                <EnlaceAccion href={rutaEmpresa(x.ruc, "contratos", { [P_CONTRATOS.entidad]: entidadRuc })} variante="secundario">
                  Sus contratos con la entidad
                </EnlaceAccion>
              )}
              {x.ordenes > 0 && (
                <EnlaceAccion href={rutaEmpresa(x.ruc, "ordenes", { [P_ORDENES.entidad]: entidadRuc })} variante="secundario">
                  Sus órdenes de la entidad
                </EnlaceAccion>
              )}
            </>
          }
        />
      ),
    },
  };
}

// ─── Quiénes la visitan ─────────────────────────────────────────────────────────

const tipoOrg = (o: OrganizacionVisitante) => (o.tipo === "publica" ? "Entidad pública" : o.ruc ? "Empresa" : "Organización privada");

export const COLUMNAS_ORGANIZACIONES: Columna[] = [
  { clave: "org", titulo: "Quién la visita", ancho: "minmax(0,1fr)" },
  { clave: "visitas", titulo: "Visitas", ancho: "4.5rem", alinear: "der" },
  {
    clave: "despues", titulo: "Ganó después", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Qué es «Ganó después»?">
        Lo que la entidad le dio a la empresa que se reconoce en esas visitas desde la primera de ellas: lo que suman sus contratos y
        órdenes, y la fecha del primero. Una entidad pública o una organización sin empresa reconocida no tiene esta cifra.
      </Ayuda>
    ),
    igual: { frases: { "Nada después": "Ninguna ganó algo después de visitarla", "Sin empresa": "Ninguna es una empresa reconocida" } },
  },
];

export function filaOrganizacion(o: OrganizacionVisitante, entidadRuc: string, i: number): Fila {
  const titulo = o.empresa ? tituloNatural(o.empresa) : tituloNatural(o.org);
  const despues = o.despues && o.despuesTipo ? o.despues : null;
  const datos: DatoClave[] = [
    { etiqueta: "Qué es", valor: tipoOrg(o) },
    ...(o.empresa && tituloNatural(o.org) !== titulo ? [{ etiqueta: "Lo que declararon", valor: tituloNatural(o.org) }] : []),
    { etiqueta: "Visitas", valor: `${plural(o.visitas, "visita", "visitas")} de ${plural(o.visitantes, "persona", "personas")}${o.primera ? `, ${periodo(o.primera, o.ultima)}` : ""}` },
    { etiqueta: "A quien decide", valor: o.decisores > 0 ? plural(o.decisores, "visita a quien decide las compras", "visitas a quien decide las compras") : "Ninguna" },
    ...(o.ruc ? [{ etiqueta: "RUC de la empresa", valor: o.ruc, mono: true }] : []),
    ...(o.ruc
      ? [{
          etiqueta: "Después de la primera visita",
          valor: despues
            ? `${cual(o.despuesTipo!, o.despuesNumero)}, del ${fechaConAnio(despues)}${o.despuesMonto != null ? ` (${soles(o.despuesMonto)})` : ""}`
            : "La entidad no le dio un contrato ni una orden",
        }]
      : []),
    ...(despues ? [{ etiqueta: "Suman desde entonces", valor: soles(o.montoDespues), mono: true }] : []),
  ];
  const textoDespues = !o.ruc ? "Sin empresa" : despues ? `${solesCompacto(o.montoDespues)} ${despues}` : "Nada después";
  return {
    // Su lugar en la lista y no su nombre: el id va al DOM y una «organización» puede ser el nombre de una persona.
    id: `o${i}`,
    celdas: {
      org: <CeldaPrincipal enLinea titulo={titulo} meta={[<Dato key="t" tipo="tipo" nombre="Qué es">{tipoOrg(o)}</Dato>]} />,
      visitas: <CeldaNumero>{numero(o.visitas)}</CeldaNumero>,
      // Una entidad pública o una organización sin empresa reconocida no puede «ganar»: la celda va vacía (y en el celular
      // no se apila una línea más); una empresa que no ganó nada lo dice.
      despues: despues ? (
        <CeldaNumero sub={fechaConAnio(despues)}>{solesCompacto(o.montoDespues)}</CeldaNumero>
      ) : o.ruc ? (
        <span className="block text-right text-meta text-mute">Nada después</span>
      ) : null,
    },
    textos: { despues: textoDespues },
    detalle: {
      titulo,
      etiqueta: `Ver las visitas de ${titulo}`,
      contenido: (
        <CuerpoDetalle>
          <DatosClave items={datos} />
          {despues && AVISO_INDICIO}
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <>
              <EnlaceAccion href={hrefVisitasDe(entidadRuc, o.org)} flecha>Ver sus visitas</EnlaceAccion>
              {o.ruc && <EnlaceAccion href={rutaEmpresa(o.ruc, "visitas")} variante="secundario">La ficha de la empresa</EnlaceAccion>}
            </>
          }
        />
      ),
    },
  };
}

// ─── A qué oficinas ─────────────────────────────────────────────────────────────

export const COLUMNAS_AREAS: Columna[] = [
  { clave: "area", titulo: "Oficina y cargo de quien recibe", ancho: "minmax(0,1fr)" },
  { clave: "decide", titulo: "Compras", ancho: "8.5rem", desde: "md", apilar: true, igual: { vacia: "Ninguna de estas oficinas decide las compras" } },
  { clave: "privadas", titulo: "De empresas", ancho: "6rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "visitas", titulo: "Visitas", ancho: "4.5rem", alinear: "der" },
];

export function filaArea(a: AreaVisitada, i: number): Fila {
  return {
    id: `a${i}`,
    celdas: {
      area: (
        <CeldaPrincipal
          enLinea
          titulo={tituloNatural(a.area)}
          meta={[a.cargo ? <Dato key="c" tipo="cargo" nombre="Cargo de quien recibe">{tituloNatural(a.cargo)}</Dato> : null]}
        />
      ),
      decide: a.decisor ? <Badge variant="marca">Decide las compras</Badge> : null,
      privadas: <CeldaNumero>{numero(a.privadas)}</CeldaNumero>,
      visitas: <CeldaNumero>{numero(a.visitas)}</CeldaNumero>,
    },
    textos: { decide: a.decisor ? "Decide las compras" : null },
  };
}

// ─── Familiares de sus funcionarios ─────────────────────────────────────────────

export const COLUMNAS_PARIENTES: Columna[] = [
  { clave: "quien", titulo: "Quién la visitó y a quién", ancho: "minmax(0,1fr)" },
  { clave: "marcas", titulo: "Para mirar", ancho: "13rem", desde: "md", apilar: true, igual: { vacia: "Ninguno le vende a la entidad ni lo recibió quien decide las compras" } },
  { clave: "fecha", titulo: "Fecha", ancho: "6.5rem", alinear: "der" },
];

export function filaPariente(p: VisitaPariente): Fila {
  const recibio = [p.cargo, p.area].filter(Boolean).map((x) => tituloNatural(x!)).join(", ");
  const marcas = [p.proveedor && "También le vende", p.decisor && "A quien decide"].filter(Boolean) as string[];
  return {
    id: p.clave,
    celdas: {
      quien: (
        <CeldaPrincipal
          enLinea
          titulo={oracion(parentescoLlano(p.parentesco))}
          meta={[recibio ? <Dato key="a" tipo="cargo" nombre="La recibió">{recibio}</Dato> : null]}
        />
      ),
      marcas: marcas.length ? (
        <span className="flex flex-wrap justify-start gap-1">
          {p.proveedor && <Badge variant="amber">También le vende</Badge>}
          {p.decisor && <Badge variant="marca">A quien decide</Badge>}
        </span>
      ) : null,
      fecha: <CeldaFecha fecha={p.fecha} />,
    },
    textos: { marcas: marcas.length ? marcas.join(" ") : null },
  };
}

// ─── Todas las visitas ──────────────────────────────────────────────────────────

/** De dónde dijo venir quien visita: la organización que declaró o, sin ella, qué clase de visita fue. */
function deDonde(v: VisitaEntidad): string {
  if (v.organizacion) return tituloNatural(v.organizacion);
  if (v.tipo === "privada") return "Una organización privada, sin su nombre en el registro";
  if (v.tipo === "publica") return "Una entidad pública, sin su nombre en el registro";
  return "A título personal";
}

/** El registro del que salió una visita: el del Congreso, el reporte mensual de la PNDA o el registro en línea de la PCM. */
function FuenteVisita({ v }: { v: VisitaEntidad }) {
  const r = registroVisita(v.fecha, v.fuente);
  const href = v.enlace ?? r.href;
  return <FuenteDato fuente={r.fuente} href={href} enlaces={[href !== VISITAS_EN_LINEA && { texto: "Registro de visitas en línea", href: VISITAS_EN_LINEA }]} />;
}

export const COLUMNAS_VISITAS: Columna[] = [
  { clave: "visita", titulo: "De dónde y quién", ancho: "minmax(0,1.3fr)" },
  { clave: "recibio", titulo: "A quién visitó", ancho: "minmax(0,1fr)", desde: "lg", igual: { vacia: "El registro no dice el cargo de quien recibió estas visitas" } },
  { clave: "marcas", titulo: "Para mirar", ancho: "9rem", desde: "md", apilar: true, igual: { vacia: "Ninguna de estas fue a quien decide ni fuera del horario" } },
  { clave: "fecha", titulo: "Fecha", ancho: "6.5rem", alinear: "der" },
];

export function filaVisita(v: VisitaEntidad): Fila {
  const titulo = v.pariente ? "Un familiar de un funcionario" : deDonde(v);
  const recibio = v.cargo ? tituloNatural(v.cargo) : v.area ? tituloNatural(v.area) : null;
  const marcas = [v.decisor && "A quien decide", v.fueraDeHora && "Fuera de horario"].filter(Boolean) as string[];
  return {
    id: v.clave,
    celdas: {
      visita: (
        <CeldaPrincipal
          enLinea
          titulo={titulo}
          meta={[!v.pariente && v.visitante ? <Dato key="q" tipo="personas" nombre="Quién visitó">{v.visitante}</Dato> : null]}
        />
      ),
      recibio: recibio ? <CeldaTexto>{recibio}</CeldaTexto> : null,
      marcas: marcas.length ? (
        <span className="flex flex-wrap gap-1">
          {v.decisor && <Badge variant="marca">A quien decide</Badge>}
          {v.fueraDeHora && <Badge variant="amber">Fuera de horario</Badge>}
        </span>
      ) : null,
      fecha: <CeldaFecha fecha={v.fecha} />,
    },
    textos: { marcas: marcas.length ? marcas.join(" ") : null, recibio },
    // De quien la recibió, sólo su cargo y su área; del familiar de un funcionario, nada.
    detalle: {
      titulo: v.pariente ? "Visita de un familiar de un funcionario" : titulo,
      etiqueta: "Ver la visita",
      contenido: (
        <CuerpoDetalle>
          <DatosClave
            items={[
              { etiqueta: "Cuándo", valor: v.fecha ? `${fecha(v.fecha)}${v.hora ? `, a las ${v.hora}` : ""}` : null },
              ...(v.duracion ? [{ etiqueta: "Duración", valor: plural(v.duracion, "minuto", "minutos") }] : []),
              ...(v.fueraDeHora ? [{ etiqueta: "Horario", valor: "Fuera del horario de oficina" }] : []),
              { etiqueta: "Quién visitó", valor: v.pariente ? "Un familiar de un funcionario de la entidad" : v.visitante },
              ...(v.pariente ? [] : [{ etiqueta: "Dijo venir de", valor: deDonde(v) }]),
              { etiqueta: "Cargo de quien la recibió", valor: v.cargo ? tituloNatural(v.cargo) : null },
              { etiqueta: "Área", valor: v.area ? tituloNatural(v.area) : null },
              ...(v.decisor ? [{ etiqueta: "Decide las compras", valor: "Sí, por su cargo o su área" }] : []),
              { etiqueta: "Motivo declarado", valor: v.motivo ? `«${oracion(v.motivo)}»` : null },
              ...(v.empresa
                ? [{ etiqueta: "Se reconoce como gente de", valor: v.empresa.nombre ? tituloNatural(v.empresa.nombre) : `La empresa con RUC ${v.empresa.ruc}` }]
                : []),
            ]}
          />
          {v.pariente && (
            <Nota>Su documento es el de un pariente que un funcionario de la entidad declaró en su Declaración Jurada de Intereses. No se dice quién es.</Nota>
          )}
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            // `empresa` llega sólo con RUC 20 (la API descarta lo demás): su ficha, en la lista de visitas de su gente.
            v.empresa ? <EnlaceAccion href={rutaEmpresa(v.empresa.ruc, "visitas")} flecha>Ver las visitas de la empresa</EnlaceAccion> : undefined
          }
          secundarias={<FuenteVisita v={v} />}
        />
      ),
    },
  };
}
