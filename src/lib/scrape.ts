import { getMlSessionCookie } from "@/lib/session";
import type { ExtractedItem } from "@/lib/types";

const ITEM_ID_REGEX = /(ML[A-Z])-?(\d{6,})/i;

/**
 * URLs para onde o Mercado Livre redireciona quando exige login/verificação.
 * Sem um cookie de sessão válido caímos aqui em vez da página do anúncio.
 */
const LOGIN_WALL_REGEX =
  /account-verification|\/gz\/|\/login|login-portal|signin|challenge|captcha/i;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/**
 * Normaliza um valor monetário para número, aceitando "1.234,56",
 * "1234.56", "R$ 1.234,56" etc.
 */
function parsePrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  let normalized: string;
  if (/,\d{1,2}$/.test(raw) && raw.includes(".")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (/,\d{1,2}$/.test(raw)) {
    normalized = raw.replace(",", ".");
  } else {
    normalized = raw.replace(/,/g, "");
  }

  const n = Number.parseFloat(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) {
    attrs[match[1].toLowerCase()] = (match[3] ?? match[4] ?? "").trim();
  }
  return attrs;
}

function metaContent(html: string, keys: string[]): string | null {
  const wanted = keys.map((k) => k.toLowerCase());
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    const key = (attrs.property || attrs.name || attrs["itemprop"] || "").toLowerCase();
    if (key && wanted.includes(key)) {
      const content = attrs.content;
      if (content) return content;
    }
  }
  return null;
}

function jsonLdObjects(html: string): JsonObject[] {
  const objects: JsonObject[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of list) {
        if (isRecord(entry)) objects.push(entry);
      }
    } catch {
      // JSON-LD malformado, ignora
    }
  }
  return objects;
}

function typeIncludes(value: unknown, type: string): boolean {
  return asArray(value).some((t) => asString(t)?.toLowerCase() === type);
}

function findProduct(html: string): JsonObject | null {
  for (const obj of jsonLdObjects(html)) {
    if (typeIncludes(obj["@type"], "product")) return obj;
  }
  return null;
}

function findById(html: string, id: string): unknown {
  const re = new RegExp(
    `<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
  const match = html.match(re);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function findWindowState(html: string): unknown {
  const re = /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i;
  const match = html.match(re);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function walk(value: unknown, visit: (obj: JsonObject) => boolean): void {
  if (!isRecord(value)) return;
  if (visit(value)) return;
  for (const child of Object.values(value)) {
    if (isRecord(child) || Array.isArray(child)) walk(child, visit);
  }
}

function deepFindString(root: unknown, key: string): string | null {
  let found: string | null = null;
  walk(root, (obj) => {
    if (found) return true;
    const value = asString(obj[key]);
    if (value) {
      found = value;
      return true;
    }
    return false;
  });
  return found;
}

function deepFindArray(root: unknown, key: string): unknown[] | null {
  let found: unknown[] | null = null;
  walk(root, (obj) => {
    if (found) return true;
    if (Array.isArray(obj[key])) {
      found = obj[key] as unknown[];
      return true;
    }
    return false;
  });
  return found;
}

function looksLikeChallenge(html: string): boolean {
  return (
    html.includes("suspicious-traffic") ||
    /captcha|Are you a human|verifique que você não é um robô/i.test(html)
  );
}

async function fetchProductHtml(url: string): Promise<string> {
  const cookie = await getMlSessionCookie();
  const res = await fetch(url, {
    headers: cookie ? { ...BROWSER_HEADERS, Cookie: cookie } : BROWSER_HEADERS,
    redirect: "follow",
    cache: "no-store",
  });
  const html = await res.text();

  const landedOnLogin = LOGIN_WALL_REGEX.test(res.url);
  if (landedOnLogin) {
    throw new Error(
      cookie
        ? "A sessão do Mercado Livre expirou ou é inválida. Atualize o cookie em “Sessão ML”."
        : "O Mercado Livre exige login para acessar este anúncio. Configure o cookie de sessão em “Sessão ML”.",
    );
  }
  if (!res.ok) {
    throw new Error(
      `Não foi possível acessar a página do anúncio (HTTP ${res.status}).`,
    );
  }
  if (looksLikeChallenge(html)) {
    throw new Error(
      cookie
        ? "O Mercado Livre bloqueou o acesso automático à página (verificação anti-bot). Tente novamente em instantes."
        : "O Mercado Livre bloqueou o acesso automático à página. Configure o cookie de sessão em “Sessão ML” para liberar o acesso.",
    );
  }
  return html;
}

function extractImages(product: JsonObject | null, html: string): string[] {
  const fromJsonLd = asArray(product?.image)
    .map((entry) => (isRecord(entry) ? asString(entry.url) : asString(entry)))
    .filter((src): src is string => Boolean(src));

  if (fromJsonLd.length > 0) return Array.from(new Set(fromJsonLd));

  const og = metaContent(html, ["og:image", "twitter:image"]);
  return og ? [og] : [];
}

function extractCategoryId(state: unknown): string | null {
  const id = deepFindString(state, "category_id");
  if (id && /^ML[A-Z]\d+$/i.test(id)) return id.toUpperCase();

  const nested = deepFindString(state, "categoryId");
  if (nested && /^ML[A-Z]\d+$/i.test(nested)) return nested.toUpperCase();

  return null;
}

function extractAttributes(state: unknown): ExtractedItem["attributes"] {
  const raw = deepFindArray(state, "attributes");
  if (!raw) return [];

  const out: ExtractedItem["attributes"] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id);
    if (!id) continue;
    out.push({
      id,
      name: asString(entry.name) ?? undefined,
      value_id: asString(entry.value_id),
      value_name: asString(entry.value_name),
    });
  }
  return out;
}

function deriveItemId(url: string, product: JsonObject | null): string {
  const fromUrl = url.match(ITEM_ID_REGEX);
  if (fromUrl) return `${fromUrl[1].toUpperCase()}${fromUrl[2]}`;

  const sku = asString(product?.sku) || asString(product?.productID);
  if (sku) return sku.replace("-", "").toUpperCase();

  return "unknown";
}

/**
 * Extrai os dados do anúncio diretamente da página pública do Mercado Livre.
 * Não usa a API autenticada — combina JSON-LD, meta tags e o estado embutido
 * na página (__PRELOADED_STATE__). Suporta links de anúncio (/MLB-xxxxxxx) e
 * de catálogo (/p/MLBxxxx).
 */
export async function scrapeItemData(url: string): Promise<ExtractedItem> {
  const html = await fetchProductHtml(url);

  const product = findProduct(html);
  const state = findById(html, "__PRELOADED_STATE__") ?? findWindowState(html);

  const offers = isRecord(product?.offers)
    ? product?.offers
    : asArray(product?.offers).find(isRecord) ?? null;

  const title =
    asString(product?.name) ||
    metaContent(html, ["og:title", "twitter:title"]) ||
    deepFindString(state, "title");

  const price =
    parsePrice(offers?.price) ??
    parsePrice(offers?.lowPrice) ??
    parsePrice(metaContent(html, ["product:price:amount", "og:price:amount"])) ??
    parsePrice(deepFindString(state, "price"));

  if (!title) {
    throw new Error("Não foi possível localizar o título do anúncio na página.");
  }
  if (price === null) {
    throw new Error("Não foi possível localizar o preço do anúncio na página.");
  }

  const currencyId =
    asString(offers?.priceCurrency) ||
    metaContent(html, ["product:price:currency", "og:price:currency"]) ||
    "BRL";

  const description =
    asString(product?.description) ||
    metaContent(html, ["og:description", "description"]) ||
    "";

  const condition =
    (asString(product?.itemCondition)?.replace(/^https?:\/\/schema\.org\//, "") ??
      deepFindString(state, "condition")) ||
    "new";

  const pictures = extractImages(product, html);
  const attributes = extractAttributes(state);
  const categoryId = extractCategoryId(state) ?? "";

  return {
    id: deriveItemId(url, product),
    title,
    price,
    currencyId,
    categoryId,
    condition,
    permalink: url,
    availableQuantity: 1,
    listingTypeId: undefined,
    siteId: "MLB",
    pictures,
    attributes,
    description,
  };
}
