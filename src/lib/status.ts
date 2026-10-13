import type { JobStatus } from "@/lib/types";

export const STATUS_META: Record<
  JobStatus,
  { label: string; emoji: string; tone: string }
> = {
  pending: {
    label: "Na fila",
    emoji: "🕒",
    tone: "text-slate-500",
  },
  extracting: {
    label: "Extraindo dados do anúncio original...",
    emoji: "⏳",
    tone: "text-amber-600",
  },
  extracted: {
    label: "Dados extraídos",
    emoji: "📦",
    tone: "text-amber-600",
  },
  optimizing: {
    label: "Otimizando título, descrição e atributos via IA...",
    emoji: "🤖",
    tone: "text-indigo-600",
  },
  optimized: {
    label: "Conteúdo otimizado",
    emoji: "✨",
    tone: "text-indigo-600",
  },
  publishing: {
    label: "Publicando no Mercado Livre...",
    emoji: "🚀",
    tone: "text-sky-600",
  },
  success: {
    label: "Anúncio criado com sucesso!",
    emoji: "✅",
    tone: "text-emerald-600",
  },
  failed: {
    label: "Falha ao processar",
    emoji: "❌",
    tone: "text-rose-600",
  },
};
