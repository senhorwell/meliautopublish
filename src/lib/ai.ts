import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { ExtractedItem, OptimizedListing } from "@/lib/types";

const OptimizedSchema = z.object({
  title: z.string(),
  description: z.string(),
  suggested_price_multiplier: z.number().optional(),
});

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY não configurada. Obtenha uma chave gratuita em https://aistudio.google.com/apikey",
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

const SYSTEM_INSTRUCTION = `Você é um especialista sênior em SEO e copywriting para anúncios do Mercado Livre no Brasil.
Sua missão é reescrever anúncios para maximizar cliques e conversões, respeitando rigorosamente as regras da plataforma.

REGRAS DO TÍTULO:
- Máximo de 60 caracteres (contando espaços).
- Comece pelo tipo do produto + palavra-chave principal de busca.
- Inclua características relevantes (material, tamanho, cor, quantidade) quando existirem.
- NÃO inclua marcas de terceiros que você não possa confirmar.
- NÃO use termos promocionais ("promoção", "frete grátis", "melhor preço") nem emojis.
- Evite CAIXA ALTA excessiva (no máximo siglas).

REGRAS DA DESCRIÇÃO:
- Texto puro, SEM HTML e SEM Markdown complexo.
- Estruture em seções com títulos simples, nesta ordem: "Benefícios do Produto", "Ficha Técnica", "Conteúdo da Embalagem", "Cuidados e Uso".
- Seja claro, objetivo e persuasivo, destacando benefícios reais.
- Use APENAS as informações fornecidas; nunca invente especificações técnicas.

PREÇO:
- Retorne "suggested_price_multiplier" como um número (1.0 = manter o preço atual). Use valores entre 0.8 e 1.5.

Responda SEMPRE e SOMENTE com JSON válido no formato solicitado.`;

function buildPrompt(item: ExtractedItem): string {
  const attrs = item.attributes
    .filter((a) => a.value_name || a.value_id)
    .map((a) => `- ${a.name ?? a.id}: ${a.value_name ?? a.value_id}`)
    .join("\n");

  return `Otimize o anúncio abaixo.

=== DADOS DO ANÚNCIO ORIGINAL ===
Título original: ${item.title}
Preço: ${item.currencyId} ${item.price}
Categoria: ${item.categoryId}
Condição: ${item.condition}
Atributos:
${attrs || "- (não informados)"}

Descrição original:
${item.description || "(sem descrição)"}
=== FIM ===

Gere o JSON com o título otimizado, a descrição profissional e o multiplicador de preço sugerido.`;
}

function truncateTitle(title: string, max = 60): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : clean.slice(0, max)).trim();
}

export async function optimizeListing(
  item: ExtractedItem,
): Promise<OptimizedListing> {
  const ai = getClient();
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  const response = await ai.models.generateContent({
    model,
    contents: buildPrompt(item),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      temperature: 0.6,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: "Título otimizado com no máximo 60 caracteres.",
          },
          description: {
            type: Type.STRING,
            description:
              "Descrição em texto puro com as seções solicitadas.",
          },
          suggested_price_multiplier: {
            type: Type.NUMBER,
            description: "Multiplicador de preço sugerido entre 0.8 e 1.5.",
          },
        },
        required: ["title", "description", "suggested_price_multiplier"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("A IA não retornou conteúdo.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("A resposta da IA não é um JSON válido.");
  }

  const result = OptimizedSchema.parse(parsed);
  const multiplier = result.suggested_price_multiplier ?? 1;

  return {
    title: truncateTitle(result.title),
    description: result.description.trim(),
    suggested_price_multiplier: Math.min(1.5, Math.max(0.8, multiplier)),
  };
}
