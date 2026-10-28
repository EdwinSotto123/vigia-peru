import { CloudOff, DoorOpen } from "lucide-react";
import Link from "next/link";
import { P_CONTRATOS } from "@/components/empresas/secciones/contratos";
import { P_ORDENES } from "@/components/empresas/secciones/ordenes";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaFiltrable, type Columna, type FilaFiltrable, type Indicador } from "@/components/listado";
import { Ayuda, AyudaTermino, CuerpoDetalle, DatosClave, EnlaceFuente, FuenteDato, Nota, PieDetalle, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { rutaEmpresa } from "@/lib/empresas";
import { fecha, fechaCorta, numero, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getVisitasEntidad, parentescoLlano, type EmpresaVisitante, type VisitasEntidad as Datos } from "@/lib/visitas";

/**
 * La pestaña «Visitas» de una entidad (fase 2.3 del plan del 2026-10-27): quiénes la visitan y qué ganaron después, a qué
 * oficinas, las visitas de familiares declarados de sus funcionarios (sin decir quiénes) y la lista con sus filtros (quien
 * decide, fuera del horario, familiares). Antes las visitas sólo se veían desde la ficha de una empresa. Server component.
 */
export async function VisitasEntidad({ ruc }: { ruc: string }) {
  const d = await getVisitasEntidad(ruc);
  if (!d) {
    return (
      <EstadoVacio variante="compacta" tono="error" icono={<CloudOff size={16} />}>
        No pudimos leer sus visitas ahora. Vuelve a intentarlo en un momento.
      </EstadoVacio>
    );
  }
  if (!d.total || !d.resumen) {
    return (
      <EstadoVacio variante="compacta" icono={<DoorOpen size={16} />}>
        No tenemos visitas registradas de esta entidad. El registro de la PCM no se puede consultar de forma automática: cargamos
        sus reportes publicados y el registro del Congreso.
      </EstadoVacio>
    );
  }
  const r = d.resumen;
  const orgs = d.organizaciones ?? [];
  const sinDespues = d.despuesSinCalcular === true;
  // Las empresas que ganaron algo después de una visita de su gente (migración 203: también por su socio, representante o
  // directivo); sin ese bloque, las organizaciones que declararon venir de una empresa reconocida.
  const emp = d.empresas;
  const ganaron = emp ? emp.ganaron : orgs.filter((o) => o.despues).length;
  const cifras: Indicador[] = [
    {
      valor: numero(d.total),
      etiqueta: d.total === 1 ? "visita registrada" : "visitas registradas",
      contexto: d.desde && d.hasta ? `del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)}` : undefined,
      ayuda: <AyudaTermino clave="registro-visitas" />,
    },
    {
      valor: numero(r.privadas),
      etiqueta: "de empresas y organizaciones privadas",
      contexto: sinDespues && !emp
        ? `${porcentaje((r.privadas / d.total) * 100, { decimales: 0 })} del total`
        : `${porcentaje((r.privadas / d.total) * 100, { decimales: 0 })} del total; ${plural(ganaron, "empresa ganó algo después", "empresas ganaron algo después")}`,
      href: emp && emp.ganaron > 0 ? "#visitas-empresas" : undefined,
    },
    {
      valor: numero(r.decisores),
      etiqueta: "a quien decide las compras",
      contexto: "titular, gerencia, administración, logística o un comité",
      ayuda: <AyudaTermino clave="visita-decisor" />,
    },
    r.parientes > 0
      ? {
          valor: numero(r.parientes),
          etiqueta: r.parientes === 1 ? "visita de un familiar de un funcionario" : "visitas de familiares de funcionarios",
          contexto: "declarados en su DJI; no se dice quiénes",
          ayuda: <AyudaTermino clave="dji" />,
        }
      : {
          valor: numero(r.fueraDeHora),
          etiqueta: "fuera del horario de oficina",
          contexto: "antes de las 7, desde las 19 o en fin de semana",
          ayuda: <AyudaTermino clave="visita-fuera-horario" />,
        },
  ];

  return (
    <div className="space-y-6">
      <Indicadores items={cifras} />
      <Nota>
        Las visitas vienen de los reportes que publicó la entidad o la PCM y, en el Congreso, de su propio registro; llegan hasta el{" "}
        {d.hasta ? fecha(d.hasta) : "último día cargado"}. De quien recibe la visita se muestra sólo su cargo y su área; de quien visita,
        su nombre con un apellido tapado, y nada si es familiar de un funcionario.
      </Nota>
      {emp && emp.lista.length > 0 && <EmpresasDeSuGente e={emp} entidadRuc={ruc} />}
      {orgs.length > 0 && <Organizaciones orgs={orgs} sinDespues={sinDespues} />}
      {(d.parientes ?? []).length > 0 && <Parientes d={d} />}
      {(d.areas ?? []).length > 0 && <Areas d={d} />}
      <Lista d={d} />
      <FuenteDato fuente="El registro de visitas de cada entidad" enlaces={d.fuentes ?? []} />
    </div>
  );
}

/** Cómo se reconoce a quien visita (empresa_visita.via): su papel en la empresa según el RNP, o que dijo venir de ella. */
const ROLES = [
  { clave: "representante", corto: "representante legal", filtro: "Su representante legal" },
  { clave: "socio", corto: "socio", filtro: "Un socio" },
  { clave: "directivo", corto: "directivo", filtro: "Un directivo" },
  { clave: "porNombre", corto: "alguien que dijo venir de ella", filtro: "Alguien que dijo venir de ella" },
] as const;

const TIPO_DESPUES: Record<EmpresaVisitante["despuesTipo"], string> = { contrato: "Contrato", consorcio: "Contrato en consorcio", orden: "Orden" };

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

/** «Orden el 12 mar. 2024, a 3 días de una visita». */
function cuandoDespues(x: EmpresaVisitante): string {
  const base = `${TIPO_DESPUES[x.despuesTipo]} el ${fechaCorta(x.despues)}`;
  if (x.dias == null) return base;
  return x.dias === 0 ? `${base}, el día de una visita` : `${base}, a ${plural(x.dias, "día", "días")} de una visita`;
}

/**
 * Las empresas cuya gente visitó la entidad y que después recibieron algo de ella (migración 203). A diferencia de
 * «Quiénes la visitan», la empresa se reconoce también por el documento de quien visita (su socio, representante o
 * directivo en el RNP) aunque haya dicho venir de otra organización o a título personal. Sin nombres de quienes visitan:
 * la ficha de la empresa muestra sus visitas con sus reglas.
 */
function EmpresasDeSuGente({ e, entidadRuc }: { e: NonNullable<Datos["empresas"]>; entidadRuc: string }) {
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
      { etiqueta: "Lo primero después", valor: cuandoDespues(x) },
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
          <CeldaNumero sub={cuandoDespues(x)}>
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
                <EnlaceAccion href={rutaEmpresa(x.ruc, "visitas")} flecha>Ver sus visitas</EnlaceAccion>
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
        lo_primero_despues: x.despuesTipo, fecha: x.despues, dias_desde_una_visita: x.dias, contratos: x.contratos,
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

function Organizaciones({ orgs, sinDespues = false }: { orgs: NonNullable<Datos["organizaciones"]>; sinDespues?: boolean }) {
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
        <CeldaNumero sub={o.despues ? `${o.despuesTipo === "contrato" ? "Contrato" : "Orden"} desde el ${fechaCorta(o.despues)}` : undefined}>
          {o.despues ? solesCompacto(o.montoDespues) : sinDespues ? "Sin calcular" : "Nada después"}
        </CeldaNumero>
      ),
    },
    buscable: `${o.org} ${o.empresa ?? ""} ${o.ruc ?? ""}`,
    valores: { tipo: o.tipo === "publica" ? "publica" : "privada", despues: o.despues ? "si" : "no", decisor: o.decisores > 0 ? "si" : "no" },
    claves: { visitas: o.visitas, monto: o.montoDespues },
    csv: { organizacion: o.org, empresa: o.empresa, ruc: o.ruc, tipo: o.tipo, visitas: o.visitas, personas: o.visitantes, primera: o.primera, ultima: o.ultima, a_quien_decide: o.decisores, despues: o.despues, despues_tipo: o.despuesTipo, monto_despues: o.montoDespues },
  }));
  return (
    <section aria-labelledby="visitas-quienes" className="space-y-2">
      <h3 id="visitas-quienes" className="font-display text-bloque font-bold text-ink">
        Quiénes la visitan
      </h3>
      <p className="text-meta text-inkSoft">
        Cada organización que declaró quien visitó. «Después»: lo primero que la entidad le dio tras su primera visita y cuánto suma.
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

function Parientes({ d }: { d: Datos }) {
  const ps = d.parientes ?? [];
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

function Areas({ d }: { d: Datos }) {
  const columnas: Columna[] = [
    { clave: "area", titulo: "Oficina y cargo de quien recibe", ancho: "minmax(0,1fr)" },
    { clave: "visitas", titulo: "Visitas", ancho: "6rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = (d.areas ?? []).map((a, i) => ({
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

function Lista({ d }: { d: Datos }) {
  const vs = d.visitas ?? [];
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
        {vs.length < d.total ? `Las ${numero(vs.length)} visitas más recientes` : "Todas sus visitas"}
      </h3>
      {vs.length < d.total && (
        <p className="text-meta text-inkSoft">
          De {numero(d.total)} en total: las cifras de arriba cuentan todas; aquí van las más recientes. Para buscar en todas, el registro
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
