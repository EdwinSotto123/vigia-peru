"use client";

import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Ayuda, CuerpoDetalle, DatosClave, EnlaceFuente, PieDetalle, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { rutaEmpresa } from "@/lib/empresas";
import { fecha, fechaCorta, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { P_CONTRATOS, P_ORDENES } from "@/lib/parametrosEmpresa";
import { rutaContrato } from "@/lib/rutas";
import { parentescoLlano, type EmpresaVisitante, type VisitasEntidad as Datos } from "@/lib/visitas";

/**
 * Las tablas de la pestaña «Visitas» de una entidad, armadas en el navegador: el servidor manda las filas como datos (las
 * mismas de la API, que ya es pública) y no cada fila hecha, con su detalle, su CSV y sus íconos. En el Minsa eran 12 MB
 * (428 empresas, 301 organizaciones, 501 visitas de familiares y las 1,000 más recientes); como datos, una fracción.
 */

/** Cómo se reconoce a quien visita (empresa_visita.via): su papel en la empresa según el RNP, o que dijo venir de ella. */
const ROLES = [
  { clave: "representante", corto: "representante legal", filtro: "Su representante legal" },
  { clave: "socio", corto: "socio", filtro: "Un socio" },
  { clave: "directivo", corto: "directivo", filtro: "Un directivo" },
  { clave: "porNombre", corto: "alguien que dijo venir de ella", filtro: "Alguien que dijo venir de ella" },
] as const;

const TIPO_DESPUES: Record<EmpresaVisitante["despuesTipo"], string> = { contrato: "Contrato", consorcio: "Contrato en consorcio", orden: "Orden" };

/** «Orden de servicio N.° 4505540510» / «Contrato CP SER-SM-1-2026-ESSALUD/GCL-1»: CUÁL fue lo primero que le dio. */
function cual(tipo: EmpresaVisitante["despuesTipo"], numero?: string | null, tipoOrden?: string | null): string {
  const t = (tipoOrden ?? "").toLowerCase();
  const base = tipo === "orden" ? (t.includes("servicio") ? "Orden de servicio" : t.includes("compra") ? "Orden de compra" : "Orden") : TIPO_DESPUES[tipo];
  return numero ? `${base} ${tipo === "orden" ? "N.° " : ""}${numero}` : base;
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

/** Qué organización declararon, si no fue la empresa (null: todas las visitas dijeron venir de ella). */
function declaro(x: EmpresaVisitante): string | null {
  if (x.declaradas >= x.visitas) return null;
  if (x.declaradas > 0) return `Dijo venir de la empresa en ${numero(x.declaradas)} de ${numero(x.visitas)}`;
  if (x.otraOrg) return `Dijo venir de ${tituloNatural(x.otraOrg)}`;
  return x.personal > 0 ? "Fue a título personal" : "No dijo venir de la empresa";
}

/**
 * Las empresas cuya gente visitó la entidad y que después recibieron algo de ella (migración 203). A diferencia de
 * «Quiénes la visitan», la empresa se reconoce también por el documento de quien visita (su socio, representante o
 * directivo en el RNP) aunque haya dicho venir de otra organización o a título personal. Sin nombres de quienes visitan:
 * la ficha de la empresa muestra sus visitas con sus reglas.
 */
export function EmpresasDeSuGente({ e, entidadRuc }: { e: NonNullable<Datos["empresas"]>; entidadRuc: string }) {
  const columnas: Columna[] = [
    { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1fr)" },
    { clave: "visitas", titulo: "Visitas", ancho: "6rem", alinear: "der" },
    { clave: "despues", titulo: "Después", ancho: "13rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: FilaFiltrable[] = e.lista.map((x) => {
    const nombre = x.empresa ? tituloNatural(x.empresa) : `Empresa con RUC ${x.ruc}`;
    const dijo = declaro(x);
    const desde = [
      x.contratos > 0 ? plural(x.contratos, "contrato", "contratos") : null,
      x.consorcios > 0 ? plural(x.consorcios, "contrato en consorcio", "contratos en consorcio") : null,
      x.ordenes > 0 ? plural(x.ordenes, "orden", "órdenes") : null,
    ].filter(Boolean);
    const datos: DatoClave[] = [
      {
        etiqueta: "Visitas",
        valor: `${plural(x.visitas, "visita", "visitas")} de ${plural(x.visitantes, "persona", "personas")}, ${x.primera === x.ultima ? `el ${fecha(x.primera)}` : `del ${fechaCorta(x.primera)} al ${fechaCorta(x.ultima)}`}`,
      },
      {
        etiqueta: "Quién la visitó",
        valor: ROLES.filter((v) => x[v.clave] > 0).map((v) => `${v.filtro}: ${plural(x[v.clave], "visita", "visitas")}`).join("; "),
      },
      { etiqueta: "Qué declaró", valor: dijo ?? "Que venía de la empresa" },
      ...(x.decisores > 0 ? [{ etiqueta: "A quien decide", valor: plural(x.decisores, "visita a quien decide las compras", "visitas a quien decide las compras") }] : []),
      {
        etiqueta: "Antes de la primera visita",
        valor: x.antes === 0
          ? "La entidad nunca le había dado un contrato ni una orden (en lo que tenemos cargado)"
          : plural(x.antes, "contrato u orden", "contratos u órdenes"),
      },
      {
        etiqueta: "Lo primero después",
        valor: `${cual(x.despuesTipo, x.despuesNumero, x.despuesOrden)}, del ${fechaCorta(x.despues)}${
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
    return {
      id: `e${x.ruc}`,
      celdas: {
        empresa: (
          <CeldaPrincipal
            titulo={nombre}
            meta={[
              <Dato key="q" tipo="personas" nombre="Quién la visitó">{quienes(x)}</Dato>,
              dijo ? <Dato key="o" tipo="entidad" nombre="Qué declaró">{dijo}</Dato> : null,
              x.antes === 0 ? <Dato key="n" tipo="tipo" nombre="Antes de la visita">Nunca le había vendido</Dato> : null,
              x.decisores > 0 ? <Dato key="d" tipo="cargo" nombre="A quien decide">{plural(x.decisores, "visita a quien decide", "visitas a quien decide")}</Dato> : null,
            ]}
          />
        ),
        visitas: <CeldaNumero sub={plural(x.visitantes, "persona", "personas")}>{numero(x.visitas)}</CeldaNumero>,
        despues: (
          <CeldaNumero sub={`${cual(x.despuesTipo, x.despuesNumero, x.despuesOrden)}, ${fechaCorta(x.despues)}`}>
            {x.monto > 0 ? solesCompacto(x.monto) : x.consorcios > 0 ? plural(x.consorcios, "en consorcio", "en consorcio") : "Sin monto"}
          </CeldaNumero>
        ),
      },
      detalle: {
        titulo: nombre,
        etiqueta: `Visitas de la gente de ${nombre} y lo que ganó después`,
        contenido: (
          <CuerpoDetalle>
            <DatosClave items={datos} />
            {x.compartidas > 0 && (
              <p className="text-meta text-inkSoft">
                {x.compartidas >= x.visitas ? "Todas sus visitas son" : `${plural(x.compartidas, "visita es", "visitas son")}`} de alguien que figura
                en más de una empresa: no se sabe por cuál de ellas fue.
              </p>
            )}
            <p className="text-rotulo leading-relaxed text-mute">
              Es un indicio para revisar, no una acusación: una visita puede ser un trámite. Pesa más si la empresa nunca le había vendido,
              si la recibió quien decide las compras y si lo que ganó llegó pocos días después.
            </p>
          </CuerpoDetalle>
        ),
        pie: (
          <PieDetalle
            principal={
              <>
                {(() => {
                  const e = enlaceDespues(x, entidadRuc);
                  return e ? <EnlaceAccion href={e.href} flecha>{e.texto}</EnlaceAccion> : null;
                })()}
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
      buscable: `${x.empresa ?? ""} ${x.ruc} ${x.otraOrg ?? ""}`,
      valores: {
        via: ROLES.filter((v) => x[v.clave] > 0).map((v) => v.clave),
        declaro: x.declaradas > 0 ? "si" : "no",
        antes: x.antes > 0 ? "si" : "no",
        decisor: x.decisores > 0 ? "si" : "no",
        tipo: x.despuesTipo,
      },
      // «nueva»: primero las que nunca le habían vendido y, entre ellas, por lo que ganaron.
      claves: { nueva: (x.antes === 0 ? 1e15 : 0) + x.monto, monto: x.monto, visitas: x.visitas, dias: x.dias ?? 1e9, despues: x.despues },
      csv: {
        empresa: x.empresa, ruc: x.ruc, visitas: x.visitas, personas: x.visitantes, representante_legal: x.representante, socio: x.socio,
        directivo: x.directivo, dijo_venir_de_ella: x.porNombre, declararon_la_empresa: x.declaradas, otra_organizacion: x.otraOrg,
        a_quien_decide: x.decisores, primera_visita: x.primera, ultima_visita: x.ultima, antes_de_la_visita: x.antes,
        lo_primero_despues: x.despuesTipo, numero: x.despuesNumero, que_se_compro: x.despuesDetalle, monto_de_eso: x.despuesMonto,
        fecha: x.despues, dias_desde_una_visita: x.dias, contratos: x.contratos,
        en_consorcio: x.consorcios, ordenes: x.ordenes, monto: x.monto,
      },
    };
  });
  return (
    <section aria-labelledby="visitas-empresas" className="space-y-2">
      <div className="flex items-center gap-1">
        <h3 id="visitas-empresas" className="scroll-mt-24 font-display text-bloque font-bold text-ink">
          Empresas que ganaron algo después de una visita de su gente
        </h3>
        <Ayuda titulo="¿Cómo se reconoce a la empresa?">
          Por el documento de quien visita: es su socio, su representante legal o un directivo en el Registro Nacional de Proveedores
          (OECE), aunque haya dicho venir de otra organización o a título personal. También cuenta quien dijo venir de la empresa.
          «Después» es lo primero que la entidad le dio desde la primera de esas visitas: un contrato (sola o en consorcio) o una orden.
        </Ayuda>
      </div>
      {/* Corto (menos de 140 caracteres, la guardia visual): el cómo va en el «?» del título. */}
      <p className="text-meta text-inkSoft">
        {numero(e.ganaron)} de {plural(e.empresas, "empresa", "empresas")} cuya gente la visitó {e.ganaron === 1 ? "recibió" : "recibieron"} algo
        después: {numero(e.ganaronSoloSuGente)} sin decir que venían de ella, {numero(e.primeraVez)} por primera vez.
      </p>
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Empresas que ganaron algo después de una visita de su gente (toca una para ver el detalle)"
        tam={15}
        nombre="empresas"
        descargar={{ archivo: "visitas-empresas-ganaron-despues" }}
        buscar={{ placeholder: "Buscar una empresa o su RUC…", etiqueta: "Buscar entre las empresas que ganaron después" }}
        filtros={[
          { clave: "via", etiqueta: "Quién la visitó", corta: "Quién", opciones: ROLES.map((v) => ({ valor: v.clave, etiqueta: v.filtro })) },
          { clave: "declaro", etiqueta: "Dijo venir de la empresa", corta: "La declaró", opciones: [{ valor: "no", etiqueta: "No: sólo por su gente" }, { valor: "si", etiqueta: "Sí" }] },
          { clave: "antes", etiqueta: "Antes le vendía", corta: "Antes", opciones: [{ valor: "no", etiqueta: "Nunca le había vendido" }, { valor: "si", etiqueta: "Ya le vendía" }] },
          { clave: "decisor", etiqueta: "Visitó a quien decide", corta: "A quien decide", opciones: [{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }] },
          {
            clave: "tipo", etiqueta: "Lo primero que le dio", corta: "Lo primero",
            opciones: (["contrato", "consorcio", "orden"] as const).map((t) => ({ valor: t, etiqueta: TIPO_DESPUES[t] })),
          },
        ]}
        ordenes={[
          { valor: "nueva", etiqueta: "Primero las que nunca le vendían", clave: "nueva", dir: "desc" },
          { valor: "monto", etiqueta: "Más ganado después", clave: "monto", dir: "desc" },
          { valor: "visitas", etiqueta: "Más visitas", clave: "visitas", dir: "desc" },
          { valor: "dias", etiqueta: "Más cerca de una visita", clave: "dias", dir: "asc" },
          { valor: "reciente", etiqueta: "Lo más reciente", clave: "despues", dir: "desc" },
        ]}
      />
    </section>
  );
}

export function Organizaciones({ orgs, sinDespues = false }: { orgs: NonNullable<Datos["organizaciones"]>; sinDespues?: boolean }) {
  const columnas: Columna[] = [
    { clave: "org", titulo: "Quién la visita", ancho: "minmax(0,1fr)" },
    { clave: "visitas", titulo: "Visitas", ancho: "6rem", alinear: "der" },
    { clave: "despues", titulo: "Después", ancho: "11rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: FilaFiltrable[] = orgs.map((o, i) => ({
    id: `o${i}`,
    href: o.ruc ? `/empresa/${o.ruc}?seccion=gente&vista=visitas` : undefined,
    celdas: {
      org: (
        <CeldaPrincipal
          titulo={o.empresa ? tituloNatural(o.empresa) : tituloNatural(o.org)}
          meta={[
            <Dato key="t" tipo="tipo" nombre="Tipo">{o.tipo === "publica" ? "Entidad pública" : o.ruc ? "Empresa" : "Organización privada"}</Dato>,
            <Dato key="p" tipo="personas" nombre="Personas">{plural(o.visitantes, "persona", "personas")}</Dato>,
            o.primera ? <Dato key="f" tipo="fecha" nombre="Cuándo">{o.primera === o.ultima ? fechaCorta(o.primera) : `${fechaCorta(o.primera)} a ${fechaCorta(o.ultima)}`}</Dato> : null,
            o.decisores > 0 ? <Dato key="d" tipo="cargo" nombre="A quien decide">{plural(o.decisores, "a quien decide", "a quien decide")}</Dato> : null,
          ]}
        />
      ),
      visitas: <CeldaNumero>{numero(o.visitas)}</CeldaNumero>,
      despues: (
        <CeldaNumero sub={o.despues && o.despuesTipo ? `${cual(o.despuesTipo, o.despuesNumero)}, ${fechaCorta(o.despues)}` : undefined}>
          {o.despues ? solesCompacto(o.montoDespues) : sinDespues ? "Sin calcular" : "Nada después"}
        </CeldaNumero>
      ),
    },
    buscable: `${o.org} ${o.empresa ?? ""} ${o.ruc ?? ""}`,
    valores: { tipo: o.tipo === "publica" ? "publica" : "privada", despues: o.despues ? "si" : "no", decisor: o.decisores > 0 ? "si" : "no" },
    claves: { visitas: o.visitas, monto: o.montoDespues },
    csv: { organizacion: o.org, empresa: o.empresa, ruc: o.ruc, tipo: o.tipo, visitas: o.visitas, personas: o.visitantes, primera: o.primera, ultima: o.ultima, a_quien_decide: o.decisores, despues: o.despues, despues_tipo: o.despuesTipo, despues_numero: o.despuesNumero, monto_despues: o.montoDespues },
  }));
  return (
    <section aria-labelledby="visitas-quienes" className="space-y-2">
      <h3 id="visitas-quienes" className="font-display text-bloque font-bold text-ink">
        Quiénes la visitan
      </h3>
      <p className="text-meta text-inkSoft">
        Cada organización que declaró quien visitó. «Después»: lo primero que la entidad le dio a su empresa y cuánto suma desde entonces.
      </p>
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Organizaciones que la visitan (toca una empresa para ver sus visitas)"
        tam={15}
        nombre="organizaciones"
        descargar={{ archivo: "visitas-organizaciones" }}
        buscar={{ placeholder: "Buscar una empresa u organización…", etiqueta: "Buscar entre quienes la visitan" }}
        filtros={[
          { clave: "tipo", etiqueta: "Tipo", corta: "Tipo", opciones: [{ valor: "privada", etiqueta: "Privada" }, { valor: "publica", etiqueta: "Entidad pública" }] },
          ...(sinDespues
            ? []
            : [{ clave: "despues", etiqueta: "Ganó algo después", corta: "Después", opciones: [{ valor: "si", etiqueta: "Ganó algo después" }, { valor: "no", etiqueta: "Nada después" }] }]),
          { clave: "decisor", etiqueta: "Visitó a quien decide", corta: "A quien decide", opciones: [{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }] },
        ]}
        ordenes={[
          { valor: "visitas", etiqueta: "Más visitas", clave: "visitas", dir: "desc" },
          { valor: "monto", etiqueta: "Más ganado después", clave: "monto", dir: "desc" },
        ]}
      />
    </section>
  );
}

export function Parientes({ ps }: { ps: NonNullable<Datos["parientes"]> }) {
  const columnas: Columna[] = [
    { clave: "quien", titulo: "Visita", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Fecha", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = ps.map((p, i) => ({
    id: `p${i}`,
    celdas: {
      quien: (
        <CeldaPrincipal
          titulo={`La visitó ${parentescoLlano(p.parentesco)}`}
          meta={[
            p.cargo || p.area ? <Dato key="a" tipo="cargo" nombre="La recibió">{[p.cargo, p.area].filter(Boolean).join(", ")}</Dato> : null,
            p.decisor ? <Dato key="d" tipo="tipo" nombre="Decide compras">Decide las compras</Dato> : null,
            p.proveedor ? <Dato key="v" tipo="tipo" nombre="Proveedor">También le vende a la entidad</Dato> : null,
          ]}
        />
      ),
      fecha: <CeldaNumero>{fechaCorta(p.fecha)}</CeldaNumero>,
    },
    buscable: `${p.parentesco ?? ""} ${p.cargo ?? ""} ${p.area ?? ""}`,
    valores: { proveedor: p.proveedor ? "si" : "no", decisor: p.decisor ? "si" : "no" },
    claves: { fecha: p.fecha },
  }));
  return (
    <section aria-labelledby="visitas-parientes" className="space-y-2">
      <div className="flex items-center gap-1">
        <h3 id="visitas-parientes" className="font-display text-bloque font-bold text-ink">
          Visitas de familiares de sus funcionarios
        </h3>
        <Ayuda titulo="¿Cómo se sabe que es un familiar?">
          Su documento es el de un pariente que un funcionario de esta misma entidad declaró en su Declaración Jurada de Intereses
          (Contraloría). No se dice quién es el pariente ni quién el funcionario. Un familiar puede ir por un trámite propio: es
          para revisar, sobre todo si además le vende a la entidad.
        </Ayuda>
      </div>
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Visitas de familiares declarados de sus funcionarios"
        tam={10}
        nombre="parientes"
        filtros={[
          { clave: "proveedor", etiqueta: "También le vende", corta: "Le vende", opciones: [{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }] },
          { clave: "decisor", etiqueta: "Lo recibió quien decide", corta: "A quien decide", opciones: [{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }] },
        ]}
        ordenes={[{ valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" }]}
      />
    </section>
  );
}

export function Areas({ areas }: { areas: NonNullable<Datos["areas"]> }) {
  const columnas: Columna[] = [
    { clave: "area", titulo: "Oficina y cargo de quien recibe", ancho: "minmax(0,1fr)" },
    { clave: "visitas", titulo: "Visitas", ancho: "6rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = areas.map((a, i) => ({
    id: `a${i}`,
    celdas: {
      area: (
        <CeldaPrincipal
          titulo={tituloNatural(a.area)}
          meta={[
            a.cargo ? <Dato key="c" tipo="cargo" nombre="Cargo">{tituloNatural(a.cargo)}</Dato> : null,
            a.decisor ? <Dato key="d" tipo="tipo" nombre="Decide compras">Decide las compras</Dato> : null,
          ]}
        />
      ),
      visitas: <CeldaNumero sub={a.privadas ? plural(a.privadas, "de una empresa", "de empresas") : undefined}>{numero(a.visitas)}</CeldaNumero>,
    },
    buscable: `${a.area} ${a.cargo ?? ""}`,
    valores: { decisor: a.decisor ? "si" : "no" },
    claves: { visitas: a.visitas },
  }));
  return (
    <section aria-labelledby="visitas-areas" className="space-y-2">
      <h3 id="visitas-areas" className="font-display text-bloque font-bold text-ink">
        A qué oficinas
      </h3>
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Oficinas que reciben visitas"
        tam={10}
        nombre="areas"
        buscar={{ placeholder: "Buscar una oficina o un cargo…", etiqueta: "Buscar entre las oficinas" }}
        filtros={[{ clave: "decisor", etiqueta: "Decide las compras", corta: "Decide", opciones: [{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }] }]}
      />
    </section>
  );
}

export function ListaVisitas({ vs, total }: { vs: NonNullable<Datos["visitas"]>; total: number }) {
  const columnas: Columna[] = [
    { clave: "visita", titulo: "Visita", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Fecha", ancho: "7rem", alinear: "der" },
  ];
  const tipo = (t: string | null) => (t === "privada" ? "Privada" : t === "publica" ? "Entidad pública" : "A título personal");
  const filas: FilaFiltrable[] = vs.map((v) => ({
    id: v.clave,
    celdas: {
      visita: (
        <CeldaPrincipal
          titulo={v.pariente ? "Un familiar de un funcionario" : v.organizacion ? tituloNatural(v.organizacion) : tipo(v.tipo)}
          meta={[
            !v.pariente && v.visitante ? <Dato key="q" tipo="personas" nombre="Quién">{v.visitante}</Dato> : null,
            v.cargo || v.area ? <Dato key="a" tipo="cargo" nombre="La recibió">{[v.cargo, v.area].filter(Boolean).map((x) => tituloNatural(x!)).join(", ")}</Dato> : null,
            v.decisor ? <Dato key="d" tipo="tipo" nombre="Decide compras">Decide las compras</Dato> : null,
            v.fueraDeHora ? <Dato key="h" tipo="fecha" nombre="Horario">Fuera del horario{v.hora ? `, ${v.hora}` : ""}</Dato> : null,
          ]}
        />
      ),
      fecha: <CeldaNumero sub={v.hora && !v.fueraDeHora ? v.hora : undefined}>{v.fecha ? fechaCorta(v.fecha) : "Sin fecha"}</CeldaNumero>,
    },
    detalle: {
      titulo: v.pariente ? "Visita de un familiar de un funcionario" : v.organizacion ? tituloNatural(v.organizacion) : "Visita",
      etiqueta: "Visita",
      contenido: (
        <div className="space-y-2 text-meta text-ink">
          <p>
            {v.fecha ? fecha(v.fecha) : "Sin fecha"}
            {v.hora ? `, a las ${v.hora}` : ""}
            {v.duracion ? `; duró ${plural(v.duracion, "minuto", "minutos")}` : ""}.
          </p>
          {(v.cargo || v.area) && <p>La recibió quien tiene el cargo de {[v.cargo, v.area].filter(Boolean).join(", en ").toLowerCase()}.</p>}
          {v.motivo && <p>Motivo declarado: «{v.motivo}».</p>}
          {v.pariente && <p>Su documento es el de un pariente que un funcionario de la entidad declaró en su DJI. No se dice quién es.</p>}
          {v.empresa && (
            <p>
              Se reconoce como gente de{" "}
              <Link href={`/empresa/${v.empresa.ruc}?seccion=gente&vista=visitas`} prefetch={false} className="font-semibold text-granate underline decoration-granate/40 underline-offset-2">
                {v.empresa.nombre ? tituloNatural(v.empresa.nombre) : `la empresa ${v.empresa.ruc}`}
              </Link>
              .
            </p>
          )}
          {v.enlace && (
            <p className="text-rotulo text-mute">
              Fuente: <EnlaceFuente href={v.enlace}>{v.fuente === "congreso_visitas" ? "Registro de visitas del Congreso" : "Registro de Visitas en Línea"}</EnlaceFuente>
            </p>
          )}
        </div>
      ),
    },
    buscable: `${v.organizacion ?? ""} ${v.pariente ? "" : v.visitante ?? ""} ${v.cargo ?? ""} ${v.area ?? ""} ${v.motivo ?? ""} ${v.empresa?.nombre ?? ""}`,
    valores: {
      tipo: v.pariente ? "pariente" : v.tipo ?? "persona_natural",
      decisor: v.decisor ? "si" : "no",
      hora: v.fueraDeHora ? "fuera" : "dentro",
    },
    claves: { fecha: v.fecha ?? "" },
    // Sin el nombre de quien visita: el CSV sale de la página y circula; la organización y la oficina bastan.
    csv: { fecha: v.fecha, hora: v.hora, duracion_min: v.duracion, organizacion: v.pariente ? "Familiar de un funcionario" : v.organizacion, tipo: v.pariente ? "pariente" : v.tipo, cargo_recibio: v.cargo, area_recibio: v.area, decide_compras: v.decisor ? "sí" : "no", fuera_de_horario: v.fueraDeHora ? "sí" : "no", motivo: v.motivo, empresa: v.empresa?.nombre ?? null, ruc_empresa: v.empresa?.ruc ?? null, fuente: v.enlace },
  }));
  return (
    <section aria-labelledby="visitas-lista" className="space-y-2">
      <h3 id="visitas-lista" className="font-display text-bloque font-bold text-ink">
        {vs.length < total ? `Las ${numero(vs.length)} visitas más recientes` : "Todas sus visitas"}
      </h3>
      {vs.length < total && (
        <p className="text-meta text-inkSoft">
          De {numero(total)} en total: las cifras de arriba cuentan todas; aquí van las más recientes. Para buscar en todas, el registro
          oficial (al pie).
        </p>
      )}
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Visitas (toca una para ver su detalle y su fuente)"
        tam={20}
        nombre="visitas"
        descargar={{ archivo: "visitas" }}
        buscar={{ placeholder: "Buscar una empresa, una oficina, un motivo…", etiqueta: "Buscar entre las visitas" }}
        filtros={[
          {
            clave: "tipo", etiqueta: "Quién visita", corta: "Quién",
            opciones: [
              { valor: "privada", etiqueta: "Empresa u organización privada" },
              { valor: "publica", etiqueta: "Entidad pública" },
              { valor: "persona_natural", etiqueta: "A título personal" },
              { valor: "pariente", etiqueta: "Familiar de un funcionario" },
            ].filter((o) => filas.some((f) => f.valores?.tipo === o.valor)),
          },
          { clave: "decisor", etiqueta: "Lo recibió quien decide", corta: "A quien decide", opciones: [{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }] },
          { clave: "hora", etiqueta: "Horario", corta: "Horario", opciones: [{ valor: "fuera", etiqueta: "Fuera del horario" }, { valor: "dentro", etiqueta: "En horario de oficina" }] },
        ]}
        ordenes={[
          { valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" },
          { valor: "antiguo", etiqueta: "Lo más antiguo", clave: "fecha", dir: "asc" },
        ]}
      />
    </section>
  );
}
