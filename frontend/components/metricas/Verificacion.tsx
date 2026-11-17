import { BadgeCheck, BellRing, FileCheck2, ShieldQuestion } from "lucide-react";
import { BarraSegmentada, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { Nota } from "@/components/patrones";
import { numero, plural, porcentaje } from "@/lib/formato";
import type { HechosLeidos, Transparencia } from "@/lib/transparencia";
import { Caja, Metrica, MideNoMide, NoMedido, RenglonMedidor } from "./piezas";

const FUENTE_DICTAMEN = "Control automático de cada dictamen (verificacion_dictamen y self_evals de cada análisis), resumido en la tabla transparencia_analisis.";

/** Las falsas alarmas de cada red en su última prueba de oro: 100 menos la precisión. */
function FalsasAlarmas({ agentes }: { agentes: NonNullable<Transparencia["agentes"]> }) {
  const redes = agentes.redes.filter((r) => r.ultima.precision != null);
  if (!redes.length) return null;
  return (
    <Caja
      titulo="Falsas alarmas en las pruebas de oro"
      icono={<BellRing size={16} aria-hidden />}
      fecha={agentes.fecha}
      fuente="Última corrida de cada red en las pruebas de oro (golden_corrida): 100 menos su precisión."
    >
      <ul className="space-y-2.5">
        {redes.map((r) => {
          const falsas = 100 - (r.ultima.precision as number);
          return (
            <RenglonMedidor
              key={r.clave}
              nombre={r.nombre}
              parte={falsas / 100}
              texto={porcentaje(falsas, { decimales: 1 })}
              sub={`Versión ${r.ultima.version ?? "sin registrar"}, ${plural(r.ultima.contratos, "contrato", "contratos")}`}
            />
          );
        })}
      </ul>
      <MideNoMide
        mide="De cada 100 señales que la red levantó sobre contratos leídos a mano, cuántas no debían salir."
        noMide="Las falsas alarmas de los contratos publicados: sólo se pueden contar donde una persona ya leyó el contrato."
      />
    </Caja>
  );
}

const NOMBRE_HECHO: Record<string, string> = {
  "monto_contratado|contrato": "Monto del contrato firmado",
  "valor_referencial|buena_pro": "Valor referencial, leído del acta",
  "valor_referencial|bases": "Valor referencial, leído de las bases",
  "experiencia_exigida_monto|bases": "Experiencia que se exige al postor",
  "postores|buena_pro": "Cuántos postores figuran en el acta",
  "fecha_suscripcion|contrato": "Fecha de firma del contrato",
  "consultas|consultas": "Consultas y observaciones del pliego",
  "plazo_dias|contrato": "Plazo, leído del contrato",
  "plazo_dias|bases": "Plazo, leído de las bases",
  "adelanto_directo_pct|contrato": "Adelanto directo",
  "penalidad_mora_tope_pct|contrato": "Tope de la penalidad por mora",
  "experiencia_exigida_anios|bases": "Años en que se cuenta la experiencia",
};

/**
 * Los datos que los lectores sacaron de los documentos y cuántos se pudieron comprobar sin modelo (hecho_documento,
 * migración 323). Nació de un error del 2026-11-16: un monto de experiencia exigida se presentó como la cuantía de un
 * proceso. Desde entonces cada dato dice qué es y contra qué se midió, y aquí se ve cuánto falta por comprobar.
 */
function DatosComprobados({ hechos }: { hechos: HechosLeidos[] }) {
  const vistos = hechos.filter((h) => NOMBRE_HECHO[`${h.tipo}|${h.clase}`] && h.total >= 100);
  if (!vistos.length) return null;
  const total = vistos.reduce((s, h) => s + h.total, 0);
  const comprobados = vistos.reduce((s, h) => s + h.comprobados, 0);
  return (
    <Caja
      titulo="Datos leídos de los documentos que se pudieron comprobar"
      icono={<FileCheck2 size={16} aria-hidden />}
      bajada={`${numero(comprobados)} de ${plural(total, "dato", "datos")} (${porcentaje((comprobados / total) * 100)}) coinciden con un registro oficial, con la cita del propio documento o con una segunda lectura.`}
      fecha={vistos.map((h) => h.hasta).filter(Boolean).sort().pop()}
      fuente="Tabla hecho_documento: cada dato de las bases, el acta, el contrato y el pliego de consultas, con su tipo y su comprobación."
    >
      <ul className="space-y-2.5">
        {vistos.map((h) => (
          <RenglonMedidor
            key={`${h.tipo}|${h.clase}`}
            nombre={NOMBRE_HECHO[`${h.tipo}|${h.clase}`]}
            parte={h.total ? h.comprobados / h.total : null}
            texto={porcentaje(h.total ? (h.comprobados / h.total) * 100 : 0, { decimales: 1 })}
            sub={`${plural(h.total, "lectura", "lecturas")}${h.contradicen ? `; ${numero(h.contradicen)} no coinciden con el registro` : ""}${h.sinComprobar ? `; ${numero(h.sinComprobar)} sin contra qué medir` : ""}`}
          />
        ))}
      </ul>
      <MideNoMide
        mide="De cada dato que un lector sacó de un documento, si coincide con el registro oficial del proceso (el referencial, lo adjudicado, los postores), si la frase que copió del documento trae ese mismo valor, o si dos lecturas independientes dan lo mismo."
        noMide="Que el dato esté bien cuando no hay contra qué medirlo: el plazo, los adelantos y las penalidades todavía no traen su cita. «No coincide» puede ser un error de lectura o una diferencia real entre el documento y el registro."
      />
    </Caja>
  );
}

/** Las citas del analista legal en la última corrida de cada red: válidas, de la otra ley o inexistentes. */
function CitasLegales({ agentes }: { agentes: NonNullable<Transparencia["agentes"]> }) {
  const con = agentes.legal.filter((l) => l.ultima.citas);
  if (!con.length) return null;
  const suma = con.reduce((t, l) => ({ total: t.total + l.ultima.citas!.total, ok: t.ok + l.ultima.citas!.ok, otro: t.otro + l.ultima.citas!.otroRegimen, no: t.no + l.ultima.citas!.noExiste }), { total: 0, ok: 0, otro: 0, no: 0 });
  const partes = [
    { clave: "ok", nombre: "Existen y regían en la fecha", valor: suma.ok },
    { clave: "otro", nombre: "Existen, pero son de la otra ley", valor: suma.otro },
    { clave: "no", nombre: "No existen en el corpus", valor: suma.no },
  ];
  return (
    <Caja
      titulo="Normas que cita el analista legal"
      icono={<BadgeCheck size={16} aria-hidden />}
      bajada={`${plural(suma.total, "cita", "citas")} en la última corrida de las ${numero(con.length)} redes, comprobadas una por una contra el corpus de normas.`}
      fecha={con.map((l) => l.ultima.fecha).sort().pop()}
      fuente="Conjunto «legal» de las pruebas de oro (métricas de citas de golden_corrida)."
    >
      <BarraSegmentada etiqueta="Citas legales según si existen y regían" partes={partes.map((p) => ({ ...p, texto: plural(p.valor, "cita", "citas") }))} />
      <ul className="space-y-1.5">
        {partes.map((p, i) => (
          <li key={p.clave} className="flex items-center gap-2 text-meta">
            <MuestraSerie i={i} />
            <span className="min-w-0 flex-1 text-ink">{p.nombre}</span>
            <span className="font-mono tabular-nums text-ink">{numero(p.valor)}</span>
            <span className="w-14 text-right font-mono text-rotulo tabular-nums text-mute">{porcentaje((100 * p.valor) / suma.total, { decimales: 1 })}</span>
          </li>
        ))}
      </ul>
      <MideNoMide
        mide="Si cada artículo, directiva u opinión que el agente cita existe de verdad y era la ley vigente cuando se convocó el proceso. Una cita que no existe es una norma inventada."
        noMide="Si la norma citada es la que mejor aplica al caso: eso lo decide quien revisa el expediente."
      />
    </Caja>
  );
}

/**
 * Pestaña «Verificación»: lo más cerca que la base llega de un «porcentaje de alucinación». No hay un número único:
 * hay varias medidas, cada una con lo que mide y lo que no. Arriba las que salen de comparar contra la lectura humana;
 * después las del control automático que pasa cada dictamen.
 */
export function Verificacion({ verificacion, agentes, generado }: { verificacion: Transparencia["verificacion"]; agentes: Transparencia["agentes"]; generado: string | null }) {
  const s = verificacion.senales;
  const d = verificacion.dictamenes;
  return (
    <div className="space-y-5">
      <Nota icono={<ShieldQuestion size={15} aria-hidden />}>
        No existe un solo «porcentaje de alucinación». Aquí va cada control que sí se guarda, con lo que mide y lo que no. Ninguno reemplaza
        revisar el expediente: una señal es un indicio, no una conclusión.
      </Nota>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {agentes && <FalsasAlarmas agentes={agentes} />}
        {agentes && <CitasLegales agentes={agentes} />}

        {s ? (
          <Metrica
            titulo="Señales publicadas marcadas como cotejadas"
            parte={s.cotejadas}
            de={s.total}
            unidad="señales"
            fecha={generado}
            fuente={`Vista senales_publicas (sin las repetidas), en ${numero(s.contratos)} contratos. La fecha es la de esta consulta.`}
            mide="Que el análisis guardó, junto a la señal, el dato de la fuente oficial que la sostiene (el registro del proceso, la SUNAT o el documento del expediente)."
            noMide="Que una persona la haya revisado, ni que la interpretación sea correcta. La marca la pone el mismo análisis."
          />
        ) : (
          <NoMedido titulo="Señales cotejadas">La vista de señales publicadas no respondió.</NoMedido>
        )}

        {d ? (
          <>
            <Metrica
              titulo="Señales que un segundo modelo dio por respaldadas"
              parte={d.respaldoOk}
              de={d.respaldoN}
              unidad="señales"
              fecha={d.hasta}
              fuente={FUENTE_DICTAMEN}
              mide="Un modelo distinto lee cada señal y responde si trae datos comprobables: un RUC, un monto, una fecha o un artículo."
              noMide="Si la señal es cierta. El juez también es un modelo y se puede equivocar en los dos sentidos."
            />
            <Metrica
              titulo="Señales con su norma y su fuente oficial"
              parte={d.citaOk}
              de={d.citaN}
              unidad="señales"
              fecha={d.hasta}
              fuente={FUENTE_DICTAMEN}
              mide="Una regla fija del código comprueba que cada señal traiga la norma que invoca y el enlace a su fuente oficial."
              noMide="Que la norma sea la correcta. Eso se mide en «Normas que cita el analista legal»."
            />
            <Metrica
              titulo="Reglas que el redactor nombró sin que hubiera señal"
              parte={d.reglasSinSenal}
              de={d.reglasCitadas}
              unidad="menciones"
              fecha={d.hasta}
              fuente={FUENTE_DICTAMEN}
              mide="El texto del dictamen nombra una regla que en ese contrato no quedó guardada como señal. El control la detecta y marca el dictamen."
              noMide="Señales inventadas en la lista de señales: esa lista sale de las reglas y de los agentes, no del redactor."
            />
            <Metrica
              titulo="Dictámenes que el control marcó o corrigió"
              parte={d.degradados}
              de={d.conVerificacion}
              unidad="dictámenes"
              fecha={d.hasta}
              fuente={FUENTE_DICTAMEN}
              mide="Dictámenes donde el control automático encontró algo sin respaldo (una regla sin señal, un RUC o un enlace) y lo marcó o lo quitó antes de guardar."
              noMide="Dictámenes con errores que el control no sabe detectar, como una mala interpretación."
            />
            <Caja
              titulo="Datos sin respaldo que se quitaron del texto"
              icono={<BadgeCheck size={16} aria-hidden />}
              fecha={d.hasta}
              fuente={FUENTE_DICTAMEN}
            >
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-paperSoft px-3 py-2">
                  <dt className="text-rotulo text-mute">RUC sin respaldo, reemplazados por «no verificado»</dt>
                  <dd className="font-display text-cifra font-bold tabular-nums leading-tight text-ink">{numero(d.rucsSustituidos)}</dd>
                </div>
                <div className="rounded-xl bg-paperSoft px-3 py-2">
                  <dt className="text-rotulo text-mute">Enlaces sin respaldo, quitados</dt>
                  <dd className="font-display text-cifra font-bold tabular-nums leading-tight text-ink">{numero(d.urlsQuitadas + d.urlsSinRespaldo)}</dd>
                </div>
                <div className="col-span-2 rounded-xl bg-paperSoft px-3 py-2">
                  <dt className="text-rotulo text-mute">Piezas que un agente entregó mal formadas y el código descartó</dt>
                  <dd className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-cifra font-bold tabular-nums leading-tight text-ink">{numero(d.descartes)}</span>
                    <span className="text-meta tabular-nums text-inkSoft">en {plural(d.n, "análisis", "análisis")}</span>
                  </dd>
                </div>
              </dl>
              <MideNoMide
                mide="Lo que el código borró o descartó antes de publicar: un RUC o un enlace que no aparece en ninguna fuente del análisis, o una respuesta que no cumple el formato pedido."
                noMide="Un dato equivocado que sí aparece en alguna fuente consultada (por ejemplo, una noticia con un error)."
              />
            </Caja>
            {d.precioN > 0 && (
              <Metrica
                titulo="Comparaciones de precio que el juez dio por sostenidas"
                parte={d.precioOk}
                de={d.precioN}
                unidad="ítems con precio de mercado"
                fecha={d.hasta}
                fuente={FUENTE_DICTAMEN}
                mide="Un modelo juez revisa cada ítem comparado con el mercado y responde si el veredicto de precio se sostiene con la mediana observada."
                noMide="El precio justo del bien. Un precio de catálogo no es el precio de una compra pública, y el juez es un modelo."
              />
            )}
          </>
        ) : (
          <NoMedido titulo="Control automático de los dictámenes">
            Cada análisis guarda su control, pero el resumen que lo suma (tabla transparencia_analisis, migración 300) todavía no está en la base.
          </NoMedido>
        )}
        {verificacion.hechos?.length ? <DatosComprobados hechos={verificacion.hechos} /> : null}
      </div>
    </div>
  );
}
