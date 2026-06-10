import type { VercelRequest, VercelResponse } from "@vercel/node";

const FRANKFURTER_BASE = "https://api.frankfurter.app";

// Proxy for Frankfurter currency rates — avoids browser CORS restrictions.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // req.query is set by Vercel; in the Vite dev middleware it's absent — fall back to URL parsing.
  const qs = req.query ?? Object.fromEntries(new URL(req.url ?? "", "http://localhost").searchParams);
  const from = String(qs.from || "EUR").toUpperCase();
  // Validate: only A-Z currency codes (3 chars)
  if (!/^[A-Z]{3}$/.test(from)) {
    return res.status(400).json({ error: "Invalid currency code" });
  }

  try {
    const upstream = await fetch(`${FRANKFURTER_BASE}/latest?from=${from}`, {
      headers: { Accept: "application/json" },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Upstream error" });
    }
    const data = await upstream.json();
    // Cache for 4 hours on CDN edge
    res.setHeader("Cache-Control", "public, s-maxage=14400, stale-while-revalidate=3600");
    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || "Failed to fetch rates" });
  }
}
