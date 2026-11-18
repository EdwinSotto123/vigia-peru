// Lo de la cuenta de Gobserva: seguir, dejar_de_seguir y mis_seguimientos. Escriben y leen en la API COMO esa persona:
// con el token de refresco que dio al conectar (Firebase o Cognito) se pide un ID token nuevo (acceso.ts) y la API lo verifica
// igual que en la web (requireAuth). Nada de esto existe sin cuenta.
import { z } from "zod";
import { api } from "../api";
import { idTokenDe } from "../acceso";
import { ErrorSesion } from "../firebase";
import { enlaces, ErrorUsuario, recortar, region, rucJuridico } from "../formato";
import { definir, type Contexto } from "../registro";

type Fila = Record<string, any>;

async function tokenDe(cx: Contexto): Promise<string> {
  if (!cx.usuario) throw new ErrorSesion("sin cuenta");
  return idTokenDe(cx.env, cx.usuario);
}

function destino(tipo: "entidad" | "empresa" | "partido" | "region", id: string): { tipo: string; id: string } {
  if (tipo === "region") return { tipo: "zona", id: region(id)!.ubigeo };
  if (tipo === "partido") return { tipo, id: id.trim() };
  if (tipo === "empresa") {
    const ruc = rucJuridico(id, "RUC de la empresa");
    if (!ruc.startsWith("20")) throw new ErrorUsuario("Solo se siguen empresas con RUC 20.");
    return { tipo, id: ruc };
  }
  return { tipo, id: rucJuridico(id, "RUC de la entidad") };
}

const entradaSeguir = {
  tipo: z.enum(["entidad", "empresa", "partido", "region"]),
  id: z.string().min(2).max(100).describe("RUC (entidad o empresa), clave del partido o nombre del departamento."),
};

function resumenSeguidos(p: Fila) {
  return {
    regiones: p.zonas,
    entidades: p.entidades,
    empresas: p.empresasSeguidas?.length ? p.empresasSeguidas : p.empresas,
    partidos: p.partidosSeguidos?.length ? p.partidosSeguidos : p.partidos,
  };
}

/** Escribir en la cuenta pide el permiso «seguimiento» de la conexión (un token con sólo «datos» no sigue ni deja de seguir). */
function conPermisoDeSeguimiento(cx: { usuario?: { scope?: string[] } | null }): void {
  if (!cx.usuario?.scope?.includes("seguimiento")) {
    throw new ErrorUsuario("Esta conexión no tiene el permiso de seguimiento: vuelve a conectar Gobserva y márcalo para seguir o dejar de seguir.");
  }
}

export const seguir = definir({
  nombre: "seguir",
  titulo: "Seguir",
  descripcion:
    "Sigue una entidad, empresa (RUC 20), partido o región desde la cuenta de Gobserva de quien pregunta: lo nuevo aparece " +
    "en mis_seguimientos y en las alertas de la cuenta. Hasta 300 por tipo.",
  cuenta: true,
  escritura: "crear",
  entrada: entradaSeguir,
  async ejecutar({ tipo, id }, cx) {
    conPermisoDeSeguimiento(cx as never);
    const d = destino(tipo, id);
    const p = await api<Fila>(cx.env, "/cuentas/me/seguir", {}, { metodo: "POST", cuerpo: d, token: await tokenDe(cx) });
    return { listo: `Ahora sigues ${tipo} ${id}.`, siguiendo: resumenSeguidos(p) };
  },
});

export const dejarDeSeguir = definir({
  nombre: "dejar_de_seguir",
  titulo: "Dejar de seguir",
  descripcion: "Deja de seguir una entidad, empresa, partido o región en la cuenta de Gobserva de quien pregunta.",
  cuenta: true,
  escritura: "borrar",
  entrada: entradaSeguir,
  async ejecutar({ tipo, id }, cx) {
    conPermisoDeSeguimiento(cx as never);
    const d = destino(tipo, id);
    const p = await api<Fila>(cx.env, "/cuentas/me/seguir", {}, { metodo: "DELETE", cuerpo: d, token: await tokenDe(cx) });
    return { listo: `Ya no sigues ${tipo} ${id}.`, siguiendo: resumenSeguidos(p) };
  },
});

export const misSeguimientos = definir({
  nombre: "mis_seguimientos",
  titulo: "Mis seguimientos",
  descripcion:
    "Lo que sigue la cuenta de Gobserva de quien pregunta (entidades, empresas, partidos, regiones) y lo nuevo de eso: " +
    "contratos, señales y dictámenes recientes.",
  cuenta: true,
  entrada: {},
  async ejecutar(_a, cx) {
    const token = await tokenDe(cx);
    const [perfil, impacto] = await Promise.all([
      api<Fila>(cx.env, "/cuentas/me", {}, { token }),
      api<Fila>(cx.env, "/cuentas/me/impacto", {}, { token }).catch(() => null),
    ]);
    const e = enlaces(cx.env);
    const novedades = (impacto?.novedades ?? []) as Fila[];
    return {
      siguiendo: resumenSeguidos(perfil),
      novedades: novedades.slice(0, 40).map((n) => ({
        ...n,
        titulo: recortar(n.titulo ?? n.objeto, 160) ?? undefined,
        enlace: n.ocid ? e.contrato(n.ocid) : n.ruc ? e.empresa(n.ruc) : undefined,
      })),
      plan: cx.usuario?.planes.length ? cx.usuario.planes : "gratis",
    };
  },
});

const miCupo = definir({
  nombre: "mi_cupo",
  titulo: "Mis créditos del MCP",
  descripcion:
    "Cuántos créditos del MCP le quedan este mes a la cuenta conectada, cuántos usó hoy, cuándo se renuevan y cuánto " +
    "descuenta cada herramienta. No descuenta créditos. Úsala si quien pregunta quiere saber su cupo o antes de una tarea larga.",
  cuenta: true,
  entrada: {},
  async ejecutar(_a, cx) {
    const d = await api<Fila>(cx.env, "/gobserva/cuenta/mcp", {}, { token: await tokenDe(cx) });
    return {
      planes: cx.usuario?.planes ?? [],
      creditos_al_mes: d.creditos,
      usados_este_mes: d.usados,
      quedan: Math.max(0, Number(d.creditos ?? 0) - Number(d.usados ?? 0)),
      se_renuevan: d.renueva,
      hoy: { usados: d.usadosHoy, tope: d.topeDia },
      filas_hoy: { traidas: d.filasHoy, tope: d.topeFilasDia },
      cuanto_descuenta: {
        "0": "mi_cupo, estado_fuentes, seguir, dejar_de_seguir y mis_seguimientos",
        "1": "las búsquedas y las fichas (plazas, licitaciones, contratos, empresas, entidades, proyectos, señales, dictamen)",
        "3": "los análisis: mercado, gasto, red de una empresa, historia, hallazgos, ranking, documentos, planilla, visitas, informes",
        "10": "consultar_datos y documentos_zip",
      },
    };
  },
});

export const HERRAMIENTAS_CUENTA = [seguir, dejarDeSeguir, misSeguimientos, miCupo];
