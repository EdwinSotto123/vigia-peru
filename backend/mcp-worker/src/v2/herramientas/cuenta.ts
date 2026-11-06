// Lo de la cuenta de Gobserva: seguir, dejar_de_seguir y mis_seguimientos. Escriben y leen en la API COMO esa persona:
// con el token de refresco de Firebase que dio al conectar se pide un ID token nuevo (firebase.ts) y la API lo verifica
// igual que en la web (requireAuth). Nada de esto existe sin cuenta.
import { z } from "zod";
import { api } from "../api";
import { ErrorSesion, renovarIdToken } from "../firebase";
import { enlaces, ErrorUsuario, recortar, region, rucJuridico } from "../formato";
import { definir, type Contexto } from "../registro";

type Fila = Record<string, any>;

async function tokenDe(cx: Contexto): Promise<string> {
  if (!cx.usuario?.frt) throw new ErrorSesion("sin token de refresco");
  return (await renovarIdToken(cx.env, cx.usuario.frt)).idToken;
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

export const HERRAMIENTAS_CUENTA = [seguir, dejarDeSeguir, misSeguimientos];
