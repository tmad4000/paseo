// A cold Metro build of the full app bundle can take well over two minutes on a loaded CI
// runner (5,400+ modules); a 120s cap aborted warmups at 99.9% before any test ran.
const DEFAULT_WARMUP_TIMEOUT_MS = 300_000;

function warmupTimeoutMs() {
  const configured = Number(process.env.PASEO_E2E_METRO_WARMUP_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WARMUP_TIMEOUT_MS;
}

/** @param {number} port */
export async function warmMetro(port) {
  const origin = `http://127.0.0.1:${port}`;
  const timeoutMs = warmupTimeoutMs();
  const documentResponse = await fetch(origin, { signal: AbortSignal.timeout(timeoutMs) });
  if (!documentResponse.ok) {
    throw new Error(`Metro document warmup failed with HTTP ${documentResponse.status}`);
  }
  const document = await documentResponse.text();
  const scriptSources = [...document.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (scriptSources.length === 0) {
    throw new Error("Metro document warmup found no scripts to compile");
  }
  for (const source of scriptSources) {
    const scriptUrl = new URL(source, origin);
    if (scriptUrl.origin !== origin) continue;
    const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(
        `Metro bundle warmup failed for ${scriptUrl.pathname}: HTTP ${response.status}`,
      );
    }
    await response.arrayBuffer();
  }
}
