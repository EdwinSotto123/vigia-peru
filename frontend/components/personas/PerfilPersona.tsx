import { AlertTriangle } from "lucide-react";
import { AyudaTermino, Seccion, Nota, EnlaceFuente, FuenteDato, EstadoError } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { LineaHitos, type Hito } from "@/components/charts/LineaHitos";
import { Dato } from "@/components/ui/Dato";
import { FECHA_ELECCION, enlaceVisita } from "@/components/personas/EvidenciaSenal";
import { fechaCorta, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { CLARIDAD_ONPE, DATASET_AUTORIDADES_JNE, DATASET_SOCIOS_RNP, DJI_CONSULTA, INFOGOB_JNE, PLATAFORMA_JNE, PORTAL_TRANSPARENCIA, VISITAS_EN_LINEA, djiEntidad, fichaRnp, personalPte, avisoVisitas } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { GRADO_PARIENTE, getPerfilPersona, type PerfilPersona } from "@/lib/personas";
import { REGIMEN, cargoEnOracion, mes, nombrePartido } from "@/lib/planilla";

/**
 * La pestaña «Recorrido» de la ficha de una persona (plan 2026-10-27, fase 1A): lo que es en otros registros públicos,
 * unido por su DNI (que Vigía nunca muestra), y su línea de vida. Sus empresas (RNP), sus candidaturas y cargos de
 * elección (JNE), sus aportes (ONPE), sus visitas a entidades, quién la declaró como pariente (DJI) y su planilla. Cada
 * bloque con su fuente; un registro vacío no se dibuja. Server-safe.
 */
export async function PerfilPersonaSeccion({ codigo }: { codigo: string }) {
  const p = await getPerfilPersona(codigo);
  if (!p) return <EstadoError conLlamita={false} nivel="h3" titulo="No pudimos leer su recorrido">Prueba de nuevo en unos minutos.</EstadoError>;
  const hitos = hitosPerfil(p);
  const vacio = !p.empresas.length && !p.candidaturas.length && !p.autoridades.length && !p.aportes.length && !p.visitas.total
    && !p.familia.length && !p.planilla.length;
  return (
    <div className="space-y-6">
      {hitos.length >= 2 && <LineaHitos hitos={hitos} etiqueta="Su recorrido, en orden" />}
      {vacio && (
        <Nota>
          Fuera de sus órdenes de servicio, no aparece en los otros registros que Vigía cruza: no es socio ni representante de una
          empresa, no postuló ni aportó a un partido, no registra visitas y ningún funcionario lo declaró como pariente.
        </Nota>
      )}
      {p.empresas.length > 0 && <Empresas p={p} />}
      {(p.candidaturas.length > 0 || p.autoridades.length > 0 || p.aportes.length > 0) && <Politica p={p} />}
      {p.familia.length > 0 && <Familia p={p} />}
      {p.planilla.length > 0 && <Planilla p={p} />}
      {p.visitas.total > 0 && <Visitas p={p} />}
    </div>
  );
}

// ─── Línea de vida ────────────────────────────────────────────────────────────────────────────────

/** La elección de una candidatura por su año y su cargo (regionales y municipales en octubre; generales en abril). */
function fechaCandidatura(anio: number | null, cargo: string | null): string | null {
  if (!anio) return null;
  const local = /ALCALDE|REGIDOR|GOBERNADOR|CONSEJERO/i.test(cargo ?? "");
  return FECHA_ELECCION[local ? `ERM${anio}` : anio === 2020 ? "ECE2020" : `EG${anio}`] ?? null;
}

const rolCorto = (rol: string | null) =>
  /SOCIO/i.test(rol ?? "") ? "Socio" : /REPRESENTANTE/i.test(rol ?? "") ? "Representante" : /ADMINISTRACI|DIRECTOR|GERENTE/i.test(rol ?? "") ? "Directivo" : "Integrante";

/**
 * Los hechos con fecha, en orden: aportes, candidaturas, cargos de elección, empresas, planilla y la primera orden de las
 * entidades que más le pagaron (no todas: con decenas de entidades la línea se volvía una lista). Sin fecha no entra.
 */
function hitosPerfil(p: PerfilPersona): Hito[] {
  const h: Hito[] = [];
  for (const a of p.aportes) if (a.fecha) h.push({ fecha: a.fecha, texto: `Aportó ${soles(a.monto ?? 0)} a ${nombrePartido(a.partido) ?? "un partido"}` });
  for (const c of p.candidaturas) {
    const f = fechaCandidatura(c.anio, c.cargo);
    if (f) h.push({ fecha: f, texto: `Postuló${c.cargo ? ` a ${cargoEnOracion(c.cargo) ?? tituloNatural(c.cargo)}` : ""} por ${nombrePartido(c.partido) ?? "un partido"}${c.resultado === "electo" ? ", electo" : ""}` });
  }
  for (const a of p.autoridades) if (a.desde) h.push({ fecha: a.desde, texto: `Asumió como ${cargoEnOracion(a.cargo) ?? "autoridad"}`, destacado: true });
  for (const e of p.empresas) if (e.desde) h.push({ fecha: e.desde, texto: `${rolCorto(e.rol)} de ${e.nombre ? tituloNatural(e.nombre) : "una empresa"}` });
  for (const pl of p.planilla) if (pl.desde) h.push({ fecha: `${pl.desde}-01`, texto: `En la planilla de ${tituloNatural(pl.entidad ?? "una entidad")}` });
  for (const e of p.entidades.slice(0, 4)) if (e.primera) h.push({ fecha: e.primera, texto: `Primera orden de ${tituloNatural(e.entidad ?? "una entidad")}`, destacado: true });
  return h;
}

// ─── Bloques ──────────────────────────────────────────────────────────────────────────────────────

function Lista({ columnas, filas, etiqueta }: { columnas: Columna[]; filas: Fila[]; etiqueta: string }) {
  return <Tabla columnas={columnas} filas={filas} etiqueta={etiqueta} medida="contenedor" densidad="compacta" />;
}

/**
 * Los registros de un pie «Fuente» (uno por empresa o por entidad: las filas son enlaces a la ficha de Vigía y no pueden
 * llevar otro adentro), una vez cada uno y sin el de la portada, que ya es el enlace del nombre de la fuente.
 */
const registros = (xs: { texto: string; href: string }[], portada: string) =>
  xs.filter((x, i) => x.href !== portada && xs.findIndex((y) => y.href === x.href) === i);

function Empresas({ p }: { p: PerfilPersona }) {
  const vende = p.empresas.filter((e) => e.vendido > 0).length;
  const filas: Fila[] = p.empresas.map((e) => ({
    id: e.ruc,
    href: `/empresa/${e.ruc}`,
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={e.nombre ? tituloNatural(e.nombre) : `Empresa con RUC ${e.ruc}`}
          meta={[
            <Dato key="rol" tipo="personas" nombre="Su papel">{rolCorto(e.rol)}</Dato>,
            e.desde ? <Dato key="d" tipo="fecha" nombre="Desde">{`Desde ${fechaCorta(e.desde)}`}</Dato> : null,
            e.inhabilitada ? <Dato key="i" icono={AlertTriangle} nombre="Alerta">Inhabilitada</Dato> : null,
            e.estadoSunat && !/ACTIVO/i.test(e.estadoSunat) ? <Dato key="s" icono={AlertTriangle} nombre="Estado en SUNAT">{tituloNatural(e.estadoSunat)}</Dato> : null,
          ]}
        />
      ),
      vendido: <CeldaNumero sub={e.entidades ? plural(e.entidades, "entidad", "entidades") : undefined}>{e.vendido > 0 ? solesCompacto(e.vendido) : "No vende"}</CeldaNumero>,
    },
  }));
  return (
    <Seccion
      titulo="Sus empresas"
      descripcion={`${plural(p.empresas.length, "empresa", "empresas")} donde figura como socio, representante o directivo${vende ? `; ${numero(vende)} le ${vende === 1 ? "vende" : "venden"} al Estado` : ""}.`}
    >
      <Lista
        etiqueta="Empresas de las que es socio, representante o directivo"
        columnas={[
          { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1fr)" },
          { clave: "vendido", titulo: "Le vendió al Estado", corto: "Al Estado", ancho: "9rem", alinear: "der" },
        ]}
        filas={filas}
      />
      <FuenteDato
        fuente="OECE, Registro Nacional de Proveedores (conformación jurídica)"
        href={DATASET_SOCIOS_RNP}
        // La ficha de cada empresa en el RNP, con sus socios y representantes (sólo RUC 20).
        enlaces={registros(
          p.empresas.filter((e) => /^20\d{9}$/.test(e.ruc)).map((e) => ({ texto: `${e.nombre ? tituloNatural(e.nombre) : `RUC ${e.ruc}`} en el RNP`, href: fichaRnp(e.ruc) })),
          DATASET_SOCIOS_RNP,
        )}
        className="mt-2"
      />
    </Seccion>
  );
}

function Politica({ p }: { p: PerfilPersona }) {
  const totalAportes = p.aportes.reduce((t, a) => t + (a.monto ?? 0), 0);
  const filas: Fila[] = [
    ...p.autoridades.map((a, i) => ({
      id: `aut-${i}`,
      celdas: {
        hecho: (
          <CeldaPrincipal
            titulo={`${a.vigente ? "Es" : "Fue"} ${cargoEnOracion(a.cargo) ?? "autoridad"}`}
            meta={[
              a.partido ? <Dato key="p" tipo="partido">{nombrePartido(a.partido)}</Dato> : null,
              [a.distrito, a.provincia, a.departamento].find(Boolean) ? <Dato key="z" tipo="lugar">{tituloNatural([a.distrito, a.provincia, a.departamento].find(Boolean)!)}</Dato> : null,
            ]}
          />
        ),
        cuando: <span className="text-meta tabular-nums text-inkSoft">{[a.desde?.slice(0, 4), a.hasta?.slice(0, 4)].filter(Boolean).join(" a ") || "Sin fecha"}</span>,
      },
    })),
    ...p.candidaturas.map((c, i) => ({
      id: `cand-${i}`,
      celdas: {
        hecho: (
          <CeldaPrincipal
            titulo={`Postuló${c.cargo ? ` a ${cargoEnOracion(c.cargo) ?? tituloNatural(c.cargo)}` : ""}${c.resultado === "electo" ? " y salió electo" : ""}`}
            meta={[
              c.partido ? <Dato key="p" tipo="partido">{nombrePartido(c.partido)}</Dato> : null,
              [c.distrito, c.provincia, c.region].find(Boolean) ? <Dato key="z" tipo="lugar">{tituloNatural([c.distrito, c.provincia, c.region].find(Boolean)!)}</Dato> : null,
            ]}
          />
        ),
        cuando: <span className="text-meta tabular-nums text-inkSoft">{c.anio ?? "Sin año"}</span>,
      },
    })),
    ...p.aportes.map((a, i) => ({
      id: `ap-${i}`,
      celdas: {
        hecho: (
          <CeldaPrincipal
            titulo={`Aportó ${soles(a.monto ?? 0)} a ${nombrePartido(a.partido) ?? "un partido"}`}
            meta={[a.nivel === "campaña" ? <Dato key="n" tipo="tipo">A la campaña</Dato> : null, a.tipo ? <Dato key="t" tipo="tipo">{tituloNatural(a.tipo)}</Dato> : null]}
          />
        ),
        cuando: <span className="text-meta tabular-nums text-inkSoft">{a.fecha ? fechaCorta(a.fecha) : a.anio ?? "Sin fecha"}</span>,
      },
    })),
  ];
  return (
    <Seccion
      titulo="Política"
      descripcion={[
        p.autoridades.length ? plural(p.autoridades.length, "cargo de elección", "cargos de elección") : null,
        p.candidaturas.length ? plural(p.candidaturas.length, "candidatura", "candidaturas") : null,
        p.aportes.length ? `${plural(p.aportes.length, "aporte", "aportes")} por ${soles(totalAportes)}` : null,
      ].filter(Boolean).join(", ") + "."}
    >
      <Lista
        etiqueta="Cargos de elección, candidaturas y aportes"
        columnas={[
          { clave: "hecho", titulo: "Qué", ancho: "minmax(0,1fr)" },
          { clave: "cuando", titulo: "Cuándo", ancho: "7rem", alinear: "der" },
        ]}
        filas={filas}
      />
      <FuenteDato
        fuente="JNE (candidaturas y autoridades) y ONPE (aportes a organizaciones políticas)"
        // Ni el JNE ni la ONPE tienen un enlace por persona: su consulta, la de cada bloque que se ve arriba.
        enlaces={[
          p.candidaturas.length > 0 && { texto: "Plataforma Electoral del JNE (candidaturas)", href: PLATAFORMA_JNE },
          (p.candidaturas.length > 0 || p.autoridades.length > 0) && { texto: "Infogob del JNE (candidaturas y autoridades de cada elección)", href: INFOGOB_JNE },
          p.autoridades.some((a) => a.vigente) && { texto: "Autoridades vigentes del JNE (datos abiertos)", href: DATASET_AUTORIDADES_JNE },
          p.aportes.length > 0 && { texto: "Claridad de la ONPE (aportes)", href: CLARIDAD_ONPE },
        ]}
        className="mt-2"
      />
    </Seccion>
  );
}

function Familia({ p }: { p: PerfilPersona }) {
  const entidades = new Set(p.familia.map((f) => f.entidadRuc)).size;
  const filas: Fila[] = p.familia.map((f, i) => ({
    id: String(i),
    ...(f.ficha ? { href: `/app/personas/planilla/${f.ficha}` } : {}),
    celdas: {
      quien: (
        <CeldaPrincipal
          titulo={f.cargo ? tituloNatural(f.cargo) : "Funcionario"}
          meta={[
            f.funcionarioApellido ? <Dato key="ap" tipo="personas" nombre="Funcionario">{f.funcionarioApellido}</Dato> : null,
            <Dato key="en" tipo="entidad" nombre="Su entidad">{tituloNatural(f.entidad ?? "Otra entidad")}</Dato>,
          ]}
        />
      ),
      parentesco: <span className="text-meta text-inkSoft">{GRADO_PARIENTE[f.grado ?? "otro"] ?? "Pariente"}</span>,
    },
  }));
  return (
    <Seccion
      titulo="Familia en el Estado"
      descripcion={`${plural(p.familia.length, "funcionario lo declaró", "funcionarios lo declararon")} como pariente en su Declaración Jurada de Intereses, en ${plural(entidades, "entidad", "entidades")}.`}
    >
      <Lista
        etiqueta="Funcionarios que lo declararon como pariente"
        columnas={[
          { clave: "quien", titulo: "Lo declaró", ancho: "minmax(0,1fr)" },
          { clave: "parentesco", titulo: "Parentesco declarado", corto: "Parentesco", ancho: "minmax(0,11rem)", desde: "md", apilar: "con-rotulo" },
        ]}
        filas={filas}
      />
      <Nota>
        Del funcionario se muestra su cargo, su entidad y su primer apellido, nunca su nombre completo. Que un pariente trabaje en
        el Estado no es una falta: lo es que intervenga en su contratación. Ese cruce está en las señales de cada entidad.
      </Nota>
      <FuenteDato
        fuente="Contraloría, Declaraciones Juradas de Intereses"
        href={DJI_CONSULTA}
        // Las declaraciones juradas presentadas en cada entidad (la consulta pública de la Contraloría): la lista de la
        // entidad, nunca algo que nombre al pariente.
        enlaces={registros(
          p.familia.map((f) => ({ texto: `Las declaraciones juradas de ${f.entidad ? tituloNatural(f.entidad) : "su entidad"}`, href: djiEntidad(f.entidadRuc) })),
          DJI_CONSULTA,
        )}
        className="mt-2"
      />
    </Seccion>
  );
}

function Planilla({ p }: { p: PerfilPersona }) {
  const filas: Fila[] = p.planilla.map((pl) => ({
    id: pl.entidadRuc,
    ...(pl.ficha ? { href: `/app/personas/planilla/${pl.ficha}` } : {}),
    celdas: {
      donde: (
        <CeldaPrincipal
          titulo={tituloNatural(pl.entidad ?? "Entidad")}
          meta={[
            pl.cargo ? <Dato key="c" tipo="cargo">{tituloNatural(pl.cargo)}</Dato> : null,
            pl.regimen != null ? <Dato key="r" tipo="tipo">{REGIMEN[pl.regimen] ?? `Régimen ${pl.regimen}`}</Dato> : null,
            pl.desde ? <Dato key="d" tipo="fecha">{pl.desde === pl.hasta ? mes(pl.desde) : `${mes(pl.desde)} a ${mes(pl.hasta)}`}</Dato> : null,
          ]}
        />
      ),
      sueldo: <CeldaNumero sub="sueldo del último mes">{pl.base != null ? soles(pl.base) : "Sin dato"}</CeldaNumero>,
    },
  }));
  return (
    <Seccion titulo="En planilla" descripcion={`Además de sus órdenes, figura en la planilla de ${plural(p.planilla.length, "entidad", "entidades")}.`}>
      <Lista
        etiqueta="Planillas donde figura"
        columnas={[
          { clave: "donde", titulo: "Entidad", ancho: "minmax(0,1fr)" },
          { clave: "sueldo", titulo: "Sueldo", ancho: "9rem", alinear: "der" },
        ]}
        filas={filas}
      />
      <FuenteDato
        fuente="Portal de Transparencia Estándar, personal y planilla"
        href={PORTAL_TRANSPARENCIA}
        // La página de personal de cada entidad en el portal, por su id (la que no lo tiene queda en la portada).
        enlaces={registros(
          p.planilla.map((pl) => ({ texto: `El personal de ${pl.entidad ? tituloNatural(pl.entidad) : "la entidad"}`, href: personalPte(pl.idPte) })),
          PORTAL_TRANSPARENCIA,
        )}
        className="mt-2"
      />
    </Seccion>
  );
}

function Visitas({ p }: { p: PerfilPersona }) {
  const filas: Fila[] = p.visitas.ultimas.map((v, i) => {
    // Cada visita con su registro oficial, por el registro del que salió (el del Congreso, el reporte de la PNDA o el
    // registro en línea): las filas no llevan a otra parte, el enlace va en la fila.
    const fuente = enlaceVisita(v.fecha, v.fuente);
    return {
      id: String(i),
      celdas: {
        visita: (
          <CeldaPrincipal
            titulo={tituloNatural(v.entidad ?? "Entidad")}
            meta={[
              v.cargo ? <Dato key="c" tipo="cargo" nombre="Visitó a">{tituloNatural(v.cargo)}</Dato> : null,
              v.area ? <Dato key="a" tipo="dependencia" nombre="Oficina">{tituloNatural(v.area)}</Dato> : null,
            ]}
          />
        ),
        motivo: <span className="text-meta text-inkSoft">{v.motivo ? tituloNatural(v.motivo) : "Sin motivo"}</span>,
        fecha: <span className="text-meta tabular-nums text-inkSoft">{v.fecha ? fechaCorta(v.fecha) : "Sin fecha"}</span>,
        fuente: <EnlaceFuente href={fuente.href} className="text-meta">{fuente.texto}</EnlaceFuente>,
      },
    };
  });
  const mostradas = p.visitas.ultimas.length;
  return (
    <Seccion
      titulo="Visitas a entidades"
      descripcion={`${plural(p.visitas.total, "visita registrada", "visitas registradas")}${mostradas < p.visitas.total ? `; las ${numero(mostradas)} más recientes` : ""}.`}
      ayuda={<AyudaTermino clave="registro-visitas" />}
    >
      <Lista
        etiqueta="Visitas a entidades del Estado"
        columnas={[
          { clave: "visita", titulo: "Entidad y a quién visitó", ancho: "minmax(0,1fr)" },
          { clave: "motivo", titulo: "Motivo", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo" },
          { clave: "fecha", titulo: "Fecha", ancho: "6.5rem", alinear: "der" },
          { clave: "fuente", titulo: "Fuente", ancho: "9rem", desde: "lg", apilar: "con-rotulo" },
        ]}
        filas={filas}
      />
      {avisoVisitas(p.visitas.hasta) && <Nota className="mt-2">{avisoVisitas(p.visitas.hasta)}</Nota>}
      <FuenteDato fuente="Registro de visitas en línea de las entidades" href={VISITAS_EN_LINEA} className="mt-2" />
    </Seccion>
  );
}
