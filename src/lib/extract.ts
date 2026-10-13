import { ML_API, mlFetch } from "@/lib/ml";
import type { ExtractedItem } from "@/lib/types";

const ITEM_ID_REGEX = /(ML[A-Z])-?(\d{6,})/i;
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

export async function fetchItemData(
  itemId: string,
  token?: string,
): Promise<ExtractedItem> {
  const item = await mlFetch<MlItemRaw>(`${ML_API}/items/${itemId}`, token);

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
    const desc = await mlFetch<{ plain_text?: string; text?: string }>(
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
