/**
 * Ayudas de las pruebas: una cuenta de servicio falsa (llave RSA generada acá) y un `fetch` simulado
 * que anota cada pedido.
 */

import { generateKeyPairSync } from "node:crypto";

export function cuentaFalsa(email = "vigia-api@proyecto-prueba.iam.gserviceaccount.com") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pemPrivado = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pemPublico = publicKey.export({ type: "spki", format: "pem" }).toString();
  const json = JSON.stringify({
    type: "service_account",
    project_id: "proyecto-prueba",
    private_key_id: "abc123",
    private_key: pemPrivado,
    client_email: email,
    token_uri: "https://oauth2.googleapis.com/token",
  });
  return { json, email, pemPrivado, pemPublico, privateKey, publicKey };
}

export interface Pedido { url: string; init?: RequestInit }

/** Reemplaza `globalThis.fetch` por `responder`; devuelve la lista de pedidos y cómo restaurar. */
export function simularFetch(responder: (p: Pedido) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const pedidos: Pedido[] = [];
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const p = { url: typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url, init };
    pedidos.push(p);
    return responder(p);
  }) as typeof fetch;
  return { pedidos, restaurar: () => { globalThis.fetch = original; } };
}
