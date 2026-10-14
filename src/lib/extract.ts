import { ML_API, mlFetch } from "@/lib/ml";
import type { ExtractedItem } from "@/lib/types";

const ITEM_ID_REGEX = /(ML[A-Z])-?(\d{6,})/i;
const CATALOG_ID_REGEX = /\/p\/(ML[A-Z])-?(\d{6,})/i;
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

/**
 * Extrai o ID do anúncio (ex.: MLB1234567890) a partir de um link ou texto.
 */
export function extractMlItemId(input: string): string | null {
  const match = input.match(ITEM_ID_REGEX);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

/**
 * Extrai o ID de catálogo (ex.: MLB23896659) de links de catálogo ("/p/MLB...").
 */
export function extractMlCatalogId(input: string): string | null {
  const match = input.match(CATALOG_ID_REGEX);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

/**
 * Extrai todas as URLs presentes em uma mensagem, removendo pontuação final.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return Array.from(
    new Set(matches.map((url) => url.replace(/[),.;!?]+$/, ""))),
  );
}

type MlItemRaw = {
  id: string;
  title: string;
  price: number;
  currency_id?: string;
  category_id: string;
  condition?: string;
  permalink?: string;
  available_quantity?: number;
  listing_type_id?: string;
  site_id?: string;
  status?: string;
  pictures?: { secure_url?: string; url?: string }[];
  attributes?: {
    id: string;
    name?: string;
    value_id?: string | null;
    value_name?: string | null;
  }[];
};

type MlProductOffer = {
  price?: number;
  currency_id?: string;
  category_id?: string;
  condition?: string;
  listing_type_id?: string;
};

type MlProductRaw = {
  id: string;
  name?: string;
  permalink?: string;
  pictures?: { url?: string }[];
  attributes?: {
    id: string;
    name?: string;
    value_id?: string | null;
    value_name?: string | null;
    values?: { id?: string; name?: string }[];
  }[];
  short_description?: { content?: string } | null;
  buy_box_winner?: MlProductOffer | null;
};

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Lê um recurso da API do Mercado Livre com o token quando disponível.
 * O acesso público (sem token) passou a ser bloqueado por políticas do ML
 * (HTTP 403 "PA_UNAUTHORIZED_RESULT_FROM_POLICIES"), então o token é a via
 * principal e o acesso anônimo fica apenas como último recurso.
 */
async function mlFetchPublic<T>(url: string, token?: string): Promise<T> {
  if (token) return mlFetch<T>(url, token);
  return mlFetch<T>(url);
}

export async function fetchItemData(
  itemId: string,
  token?: string,
): Promise<ExtractedItem> {
  const item = await mlFetchPublic<MlItemRaw>(`${ML_API}/items/${itemId}`, token);

  if (!item || !item.id) {
    throw new Error("Anúncio não encontrado ou inacessível.");
  }
  if (item.status && item.status !== "active" && item.status !== "paused") {
    throw new Error(
      `O anúncio de origem está com status "${item.status}" e não pode ser reutilizado.`,
    );
  }

  let description = "";
  try {
    const desc = await mlFetchPublic<{ plain_text?: string; text?: string }>(
      `${ML_API}/items/${itemId}/description`,
      token,
    );
    description = desc.plain_text || stripHtml(desc.text ?? "");
  } catch {
    description = "";
  }

  const pictures = (item.pictures ?? [])
    .map((p) => p.secure_url || p.url || "")
    .filter(Boolean);

  return {
    id: item.id,
    title: item.title,
    price: item.price,
    currencyId: item.currency_id ?? "BRL",
    categoryId: item.category_id,
    condition: item.condition ?? "new",
    permalink: item.permalink ?? "",
    availableQuantity: item.available_quantity ?? 1,
    listingTypeId: item.listing_type_id,
    siteId: item.site_id ?? "MLB",
    pictures,
    attributes: item.attributes ?? [],
    description,
  };
}

/**
 * Lê os dados de um produto de catálogo (ficha compartilhada por vários
 * vendedores). É a via confiável para anúncios de terceiros, já que
 * `GET /items/{id}` responde 403 para itens que não são da conta conectada.
 */
export async function fetchProductData(
  catalogId: string,
  token?: string,
): Promise<ExtractedItem> {
  const product = await mlFetchPublic<MlProductRaw>(
    `${ML_API}/products/${catalogId}`,
    token,
  );

  if (!product || !product.id) {
    throw new Error("Produto de catálogo não encontrado ou inacessível.");
  }

  let offers: MlProductOffer[] = [];
  try {
    const res = await mlFetchPublic<{ results?: MlProductOffer[] }>(
      `${ML_API}/products/${catalogId}/items?limit=20`,
      token,
    );
    offers = res?.results ?? [];
  } catch {
    offers = [];
  }

  const priced = offers.filter(
    (offer): offer is MlProductOffer & { price: number } =>
      typeof offer.price === "number" && offer.price > 0,
  );
  const cheapest = priced.sort((a, b) => a.price - b.price)[0] ?? null;
  const winner = product.buy_box_winner ?? null;
  const reference = winner ?? cheapest ?? offers[0] ?? null;

  const title = product.name?.trim();
  const price = winner?.price ?? cheapest?.price ?? null;

  if (!title) {
    throw new Error("Não foi possível localizar o título do produto na página.");
  }
  if (price === null || price <= 0) {
    throw new Error(
      "Não foi possível localizar o preço do produto no catálogo do Mercado Livre.",
    );
  }

  const pictures = (product.pictures ?? [])
    .map((picture) => picture.url ?? "")
    .filter(Boolean);

  const attributes: ExtractedItem["attributes"] = (product.attributes ?? []).map(
    (attribute) => ({
      id: attribute.id,
      name: attribute.name,
      value_id: attribute.value_id ?? attribute.values?.[0]?.id ?? null,
      value_name: attribute.value_name ?? attribute.values?.[0]?.name ?? null,
    }),
  );

  const description = product.short_description?.content?.trim() ?? "";

  return {
    id: product.id,
    title,
    price,
    currencyId: reference?.currency_id ?? "BRL",
    categoryId: reference?.category_id ?? "",
    condition: reference?.condition ?? "new",
    permalink: product.permalink ?? "",
    availableQuantity: 1,
    listingTypeId: reference?.listing_type_id,
    siteId: "MLB",
    pictures,
    attributes,
    description,
  };
}

/**
 * Monta um termo de busca a partir do "slug" do link do anúncio, removendo o
 * prefixo do ID e os separadores. Ex.:
 * ".../MLB-4281914295-bola-de-basquete-_JM" -> "bola de basquete".
 */
function slugFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const last = decodeURIComponent(
      pathname.split("/").filter(Boolean).pop() ?? "",
    );
    const cleaned = last
      .replace(/^ML[A-Z]-?\d+-/i, "")
      .replace(/[-_]+JM$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length >= 3 ? cleaned : null;
  } catch {
    return null;
  }
}

/**
 * Descobre o ID do produto de catálogo a partir de um texto de busca. Consulta
 * uma lista ampla de resultados e escolhe o nome com maior correspondência de
 * palavras, exigindo uma pontuação mínima para evitar resolver o produto errado.
 */
async function searchCatalogId(
  query: string,
  token?: string,
): Promise<string | null> {
  const url = `${ML_API}/products/search?status=active&siteId=MLB&limit=50&q=${encodeURIComponent(query)}`;
  let results: { id?: string; name?: string }[] = [];
  try {
    const data = await mlFetchPublic<{ results?: { id?: string; name?: string }[] }>(
      url,
      token,
    );
    results = data?.results ?? [];
  } catch {
    return null;
  }

  const valid = results.filter(
    (result): result is { id: string; name?: string } =>
      typeof result.id === "string" && /^ML[A-Z]\d+$/i.test(result.id),
  );
  if (valid.length === 0) return null;

  const words = query.toLowerCase().split(" ").filter((w) => w.length >= 3);
  if (words.length === 0) return null;

  let best = valid[0];
  let bestScore = -1;
  for (const result of valid) {
    const name = (result.name ?? "").toLowerCase();
    const score = words.reduce(
      (acc, word) => acc + (name.includes(word) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }

  const required = Math.max(2, Math.ceil(words.length * 0.5));
  return bestScore >= required ? best.id.toUpperCase() : null;
}

/**
 * Resolve os dados do anúncio a partir da URL, tentando as vias oficiais da API
 * do Mercado Livre na ordem mais confiável: catálogo, item próprio e, por fim,
 * busca do catálogo pelo título do link. Lança o erro mais informativo quando
 * todas falham.
 */
export async function fetchItemDataForUrl(
  url: string,
  itemId: string | null,
  token?: string,
): Promise<ExtractedItem> {
  const catalogId = extractMlCatalogId(url);
  const errors: unknown[] = [];

  if (catalogId) {
    try {
      return await fetchProductData(catalogId, token);
    } catch (error) {
      errors.push(error);
    }
  }

  if (itemId && itemId !== catalogId) {
    try {
      return await fetchItemData(itemId, token);
    } catch (error) {
      errors.push(error);
    }
  }

  const slug = slugFromUrl(url);
  if (slug) {
    const resolved = await searchCatalogId(slug, token);
    if (resolved && resolved !== catalogId) {
      try {
        return await fetchProductData(resolved, token);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  const last = errors[errors.length - 1];
  throw last instanceof Error
    ? last
    : new Error(
        "Não foi possível acessar os dados do anúncio pelas APIs do Mercado Livre.",
      );
}
