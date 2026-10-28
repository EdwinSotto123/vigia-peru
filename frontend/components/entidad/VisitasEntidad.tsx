import { CloudOff, DoorOpen } from "lucide-react";
import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaFiltrable, type Columna, type FilaFiltrable, type Indicador } from "@/components/listado";
import { Ayuda, EnlaceFuente, FuenteDato, Nota } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { fecha, fechaCorta, numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getVisitasEntidad, parentescoLlano, type VisitasEntidad as Datos } from "@/lib/visitas";

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
  const ganaron = orgs.filter((o) => o.despues).length;
  const cifras: Indicador[] = [
    {
      valor: numero(d.total),
      etiqueta: d.total === 1 ? "visita registrada" : "visitas registradas",
      contexto: d.desde && d.hasta ? `del ${fechaCorta(d.desde)} al ${fechaCorta(d.hasta)}` : undefined,
    },
    {
      valor: numero(r.privadas),
      etiqueta: "de empresas y organizaciones privadas",
      contexto: `${porcentaje((r.privadas / d.total) * 100, { decimales: 0 })} del total; ${plural(ganaron, "ganó algo después", "ganaron algo después")}`,
    },
    {
      valor: numero(r.decisores),
      etiqueta: "a quien decide las compras",
      contexto: "titular, gerencia, administración, logística o un comité",
      ayuda: (
        <Ayuda titulo="¿Quién decide una compra?">
          Por el cargo o el área de quien recibió la visita en el registro: la titular, la gerencia general o municipal, la
          administración, logística, abastecimiento, contrataciones o un comité de selección. Una reunión con ellos no es ilegal;
          antes de una buena pro, merece revisión.
        </Ayuda>
      ),
    },
    r.parientes > 0
      ? { valor: numero(r.parientes), etiqueta: r.parientes === 1 ? "visita de un familiar de un funcionario" : "visitas de familiares de funcionarios", contexto: "declarados en su DJI; no se dice quiénes" }
      : { valor: numero(r.fueraDeHora), etiqueta: "fuera del horario de oficina", contexto: "antes de las 7, desde las 19 o en fin de semana" },
  ];

  return (
    <div className="space-y-6">
      <Indicadores items={cifras} />
      <Nota>
        Las visitas vienen de los reportes que publicó la entidad o la PCM y, en el Congreso, de su propio registro; llegan hasta el{" "}
        {d.hasta ? fecha(d.hasta) : "último día cargado"}. De quien recibe la visita se muestra sólo su cargo y su área; de quien visita,
        su nombre con un apellido tapado, y nada si es familiar de un funcionario.
      </Nota>
      {orgs.length > 0 && <Organizaciones orgs={orgs} />}
      {(d.parientes ?? []).length > 0 && <Parientes d={d} />}
      {(d.areas ?? []).length > 0 && <Areas d={d} />}
      <Lista d={d} />
      <FuenteDato fuente="El registro de visitas de cada entidad" enlaces={d.fuentes ?? []} />
    </div>
  );
}

function Organizaciones({ orgs }: { orgs: NonNullable<Datos["organizaciones"]> }) {
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
          {o.despues ? solesCompacto(o.montoDespues) : "Nada después"}
        </CeldaNumero>
      ),
    },
    buscable: `${o.org} ${o.empresa ?? ""} ${o.ruc ?? ""}`,
    valores: { tipo: o.tipo === "publica" ? "publica" : "privada", despues: o.despues ? "si" : "no", decisor: o.decisores > 0 ? "si" : "no" },
    claves: { visitas: o.visitas, monto: o.montoDespues },
  }));
  return (
    <section aria-labelledby="visitas-quienes" className="space-y-2">
      <h3 id="visitas-quienes" className="font-display text-bloque font-bold text-ink">
        Quiénes la visitan
      </h3>
      <p className="text-meta text-inkSoft">
        Cada organización que declaró quien visitó. Si es una empresa que se reconoce, «Después» dice lo primero que le dio la entidad
        tras su primera visita (un contrato o una orden) y cuánto suma desde entonces.
      </p>
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Organizaciones que la visitan (toca una empresa para ver sus visitas)"
        tam={15}
        nombre="organizaciones"
        buscar={{ placeholder: "Buscar una empresa u organización…", etiqueta: "Buscar entre quienes la visitan" }}
        filtros={[
          { clave: "tipo", etiqueta: "Tipo", corta: "Tipo", opciones: [{ valor: "privada", etiqueta: "Privada" }, { valor: "publica", etiqueta: "Entidad pública" }] },
          { clave: "despues", etiqueta: "Ganó algo después", corta: "Después", opciones: [{ valor: "si", etiqueta: "Ganó algo después" }, { valor: "no", etiqueta: "Nada después" }] },
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
