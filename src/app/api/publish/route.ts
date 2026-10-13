import { connection, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { extractUrls } from "@/lib/extract";
import { getValidAccount } from "@/lib/ml";
import { processUrl } from "@/lib/pipeline";
import type { PipelineEvent } from "@/lib/types";

export const maxDuration = 300;

type PublishBody = {
  message?: string;
  urls?: string[];
  priceMultiplier?: number;
};

export async function POST(request: NextRequest) {
  await connection();
  let body: PublishBody = {};
  try {
    body = (await request.json()) as PublishBody;
  } catch {
    body = {};
  }

  const rawMessage = typeof body.message === "string" ? body.message : "";
  const messageUrls = extractUrls(rawMessage);
  const explicitUrls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string")
    : [];
  const urls = Array.from(new Set([...explicitUrls, ...messageUrls]));

  const priceMultiplier =
    typeof body.priceMultiplier === "number" && body.priceMultiplier > 0
      ? body.priceMultiplier
      : 1;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // stream já encerrado (cliente desconectou)
        }
      };

      try {
        if (rawMessage.trim()) {
          await prisma.chatMessage.create({
            data: { role: "user", content: rawMessage.trim() },
          });
        }

        if (urls.length === 0) {
          send({
            type: "error",
            message:
              "Não encontrei nenhum link do Mercado Livre na sua mensagem. Envie algo como https://produto.mercadolivre.com.br/MLB-1234567890-...",
          });
          return;
        }

        const account = await getValidAccount();
        if (!account) {
          send({
            type: "error",
            message:
              "Sua conta do Mercado Livre não está conectada. Clique em “Conectar Mercado Livre” e autorize o acesso.",
          });
          return;
        }

        for (const url of urls) {
          await processUrl(url, send, { account, priceMultiplier });
        }

        const summary = `Processei ${urls.length} link(s). Veja o resultado acima.`;
        await prisma.chatMessage.create({
          data: { role: "assistant", content: summary },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro inesperado.";
        send({ type: "error", message });
      } finally {
        send({ type: "done" });
        try {
          controller.close();
        } catch {
          // já fechado
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
