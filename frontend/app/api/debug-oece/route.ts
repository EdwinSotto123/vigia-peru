import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
  Referer: "https://contratacionesabiertas.oece.gob.pe/",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ocid = url.searchParams.get("ocid") ?? "ocds-dgv273-seacev3-1203694";
  const useRelay = url.searchParams.get("relay") !== "0";
  const target = `https://contratacionesabiertas.oece.gob.pe/api/v1/record/${encodeURIComponent(ocid)}`;
  const relayBase = process.env.OECE_RELAY_URL || "";
  const fetchUrl =
    useRelay && relayBase
      ? `${relayBase.replace(/\/$/, "")}/?url=${encodeURIComponent(target)}`
      : target;
  const t0 = Date.now();
  try {
    const r = await fetch(fetchUrl, { headers: BROWSER_HEADERS, cache: "no-store" });
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    const text = await r.text();
    return NextResponse.json({
      env_OECE_RELAY_URL: relayBase || null,
      use_relay: useRelay,
      target,
      fetch_url: fetchUrl,
      status: r.status,
      statusText: r.statusText,
      ok: r.ok,
      duration_ms: Date.now() - t0,
      headers,
      body_length: text.length,
      body_snippet: text.slice(0, 1500),
    });
  } catch (e) {
    return NextResponse.json({
      env_OECE_RELAY_URL: relayBase || null,
      target,
      fetch_url: fetchUrl,
      error: (e as Error).message,
      stack: (e as Error).stack?.split("\n").slice(0, 5).join("\n"),
      duration_ms: Date.now() - t0,
    }, { status: 500 });
  }
}
