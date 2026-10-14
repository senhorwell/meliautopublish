import { optimizeListing, suggestCategoryId } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { extractMlItemId, fetchItemData } from "@/lib/extract";
import {
  categoryExists,
  createItem,
  MlApiError,
  predictCategoryId,
  setItemDescription,
  type MlAccountLike,
} from "@/lib/ml";
import { scrapeItemData } from "@/lib/scrape";
import type { ExtractedItem, PipelineEvent } from "@/lib/types";

export type Emit = (event: PipelineEvent) => void;

export type PipelineOptions = {
  account: MlAccountLike;
  priceMultiplier: number;
};

function roundPrice(value: number): number {
  return Math.max(1, Math.round(value * 100) / 100);
}

export async function processUrl(
  url: string,
  emit: Emit,
  options: PipelineOptions,
): Promise<void> {
  const itemId = extractMlItemId(url);

  const job = await prisma.publishJob.create({
    data: {
      sourceUrl: url,
      sourceItemId: itemId,
      status: "pending",
      accountId: options.account.id,
    },
  });

  emit({ type: "started", url, itemId, jobId: job.id });

  if (!itemId) {
    const message =
      'Não foi possível identificar um ID de anúncio (ex.: "MLB1234567890") no link enviado.';
    await prisma.publishJob.update({
      where: { id: job.id },
      data: { status: "failed", error: message },
    });
    emit({ type: "error", url, jobId: job.id, message });
    return;
  }

  try {
    emit({
      type: "step",
      url,
      jobId: job.id,
      status: "extracting",
      message: "Extraindo dados do anúncio original...",
    });

    let item: ExtractedItem;
    try {
      item = await scrapeItemData(url);
    } catch (scrapeError) {
      try {
        item = await fetchItemData(itemId, options.account.accessToken);
      } catch {
        throw scrapeError;
      }
    }

    if (!item.categoryId) {
      const predicted = await predictCategoryId(item.title);
      if (predicted) {
        item.categoryId = predicted;
      } else {
        const suggested = await suggestCategoryId(item).catch(() => null);
        if (suggested && (await categoryExists(suggested))) {
          item.categoryId = suggested;
        }
      }
    }

    await prisma.publishJob.update({
      where: { id: job.id },
      data: {
        status: "extracted",
        title: item.title,
        price: item.price,
        currencyId: item.currencyId,
        categoryId: item.categoryId,
      },
    });
    emit({
      type: "step",
      url,
      jobId: job.id,
      status: "extracted",
      message: `Dados extraídos: "${item.title}" (${item.pictures.length} foto(s)).`,
    });

    emit({
      type: "step",
      url,
      jobId: job.id,
      status: "optimizing",
      message: "Otimizando título, descrição e atributos via IA...",
    });

    const optimized = await optimizeListing(item);
    await prisma.publishJob.update({
      where: { id: job.id },
      data: { status: "optimized", title: optimized.title, description: optimized.description },
    });
    emit({
      type: "step",
      url,
      jobId: job.id,
      status: "optimized",
      message: `Título otimizado: "${optimized.title}"`,
    });

    emit({
      type: "step",
      url,
      jobId: job.id,
      status: "publishing",
      message: "Publicando no Mercado Livre...",
    });

    const price = roundPrice(item.price * options.priceMultiplier);
    const created = await createItem(
      options.account.accessToken,
      {
        title: optimized.title,
        categoryId: item.categoryId,
        price,
        currencyId: item.currencyId,
        availableQuantity: item.availableQuantity,
        condition: item.condition,
        listingTypeId:
          item.listingTypeId && item.listingTypeId !== "free"
            ? item.listingTypeId
            : "gold_special",
        pictures: item.pictures,
      },
      item,
    );

    try {
      await setItemDescription(
        options.account.accessToken,
        created.id,
        optimized.description,
      );
    } catch {
      // A descrição pode falhar em algumas categorias; o anúncio já existe.
    }

    await prisma.publishJob.update({
      where: { id: job.id },
      data: {
        status: "success",
        mlItemId: created.id,
        mlPermalink: created.permalink,
        price,
      },
    });

    emit({
      type: "success",
      url,
      jobId: job.id,
      mlItemId: created.id,
      permalink: created.permalink,
      title: optimized.title,
      price,
      suggestedPrice: roundPrice(
        item.price * optimized.suggested_price_multiplier,
      ),
      currencyId: item.currencyId,
    });
  } catch (error) {
    const message =
      error instanceof MlApiError
        ? `Mercado Livre recusou a operação: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Erro inesperado ao processar o anúncio.";

    await prisma.publishJob.update({
      where: { id: job.id },
      data: { status: "failed", error: message },
    });
    emit({ type: "error", url, jobId: job.id, message });
  }
}
