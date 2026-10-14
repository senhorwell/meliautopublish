"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cookie,
  ExternalLink,
  Loader2,
  LogOut,
  Plug,
  Rocket,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractUrls } from "@/lib/extract";
import { STATUS_META } from "@/lib/status";
import type { JobStatus, PipelineEvent } from "@/lib/types";

type JobView = {
  url: string;
  itemId: string | null;
  status: JobStatus;
  message: string;
  log: { status: JobStatus; message: string }[];
  title?: string;
  mlItemId?: string;
  permalink?: string;
  price?: number;
  suggestedPrice?: number;
  currencyId?: string;
  error?: string;
};

type ChatItem =
  | { kind: "text"; id: string; role: "user" | "assistant"; content: string }
  | { kind: "job"; id: string; url: string; job: JobView };

type Connection = {
  connected: boolean;
  nickname?: string | null;
  error?: string;
};

type MlSession = {
  configured: boolean;
  source?: "db" | "env" | null;
  updatedAt?: string | null;
  preview?: string | null;
};

const uid = () => Math.random().toString(36).slice(2);

const WELCOME =
  "👋 Olá! Sou o MeliAutoPublish AI. Envie um ou mais links de anúncios do Mercado Livre e eu vou extrair os dados, otimizar título, descrição e ficha técnica com IA e publicar na sua conta — tudo automaticamente.";

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export default function Chat() {
  const [items, setItems] = useState<ChatItem[]>([
    { kind: "text", id: "welcome", role: "assistant", content: WELCOME },
  ]);
  const [input, setInput] = useState("");
  const [markup, setMarkup] = useState(0);
  const [sending, setSending] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [session, setSession] = useState<MlSession | null>(null);
  const [showSession, setShowSession] = useState(false);
  const [sessionInput, setSessionInput] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      setConnection(await res.json());
    } catch {
      setConnection({ connected: false });
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/ml/session", { cache: "no-store" });
      setSession((await res.json()) as MlSession);
    } catch {
      setSession({ configured: false });
    }
  }, []);

  const saveSession = useCallback(async () => {
    if (!sessionInput.trim() || sessionBusy) return;
    setSessionBusy(true);
    try {
      const res = await fetch("/api/ml/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: sessionInput }),
      });
      const data = (await res.json()) as MlSession & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Não foi possível salvar.");
      setSession(data);
      setSessionInput("");
      setNotice({ tone: "success", text: "Cookie de sessão salvo." });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Erro ao salvar o cookie.",
      });
    } finally {
      setSessionBusy(false);
    }
  }, [sessionInput, sessionBusy]);

  const clearSession = useCallback(async () => {
    setSessionBusy(true);
    try {
      const res = await fetch("/api/ml/session", { method: "DELETE" });
      setSession((await res.json()) as MlSession);
      setNotice({ tone: "success", text: "Cookie de sessão removido." });
    } catch {
      setNotice({ tone: "error", text: "Erro ao remover o cookie." });
    } finally {
      setSessionBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const init = async () => {
      await Promise.resolve();
      const params = new URLSearchParams(window.location.search);
      const ml = params.get("ml");

      if (!active) return;

      if (ml === "connected") {
        setNotice({
          tone: "success",
          text: `Conta do Mercado Livre conectada${
            params.get("nickname") ? ` como ${params.get("nickname")}` : ""
          }!`,
        });
      } else if (ml === "error") {
        setNotice({
          tone: "error",
          text: params.get("message") ?? "Erro no OAuth.",
        });
      } else if (ml === "disconnected") {
        setNotice({ tone: "success", text: "Conta desconectada." });
      }
      if (ml) {
        window.history.replaceState({}, "", window.location.pathname);
      }

      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        const data = (await res.json()) as Connection;
        if (active) setConnection(data);
      } catch {
        if (active) setConnection({ connected: false });
      }

      if (active) await refreshSession();
    };

    void init();

    return () => {
      active = false;
    };
  }, [refreshSession]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [items, sending]);

  const updateJob = useCallback(
    (url: string, patch: Partial<JobView> | ((job: JobView) => Partial<JobView>)) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "job" || item.url !== url) return item;
          const next = typeof patch === "function" ? patch(item.job) : patch;
          return { ...item, job: { ...item.job, ...next } };
        }),
      );
    },
    [],
  );

  const handleEvent = useCallback(
    (event: PipelineEvent) => {
      if (event.type === "started") {
        updateJob(event.url, { itemId: event.itemId });
      } else if (event.type === "step") {
        updateJob(event.url, (job) => ({
          status: event.status,
          message: event.message,
          log: [...job.log, { status: event.status, message: event.message }],
        }));
      } else if (event.type === "success") {
        updateJob(event.url, (job) => ({
          status: "success",
          message: STATUS_META.success.label,
          title: event.title,
          mlItemId: event.mlItemId,
          permalink: event.permalink,
          price: event.price,
          suggestedPrice: event.suggestedPrice,
          currencyId: event.currencyId,
          log: [
            ...job.log,
            { status: "success", message: STATUS_META.success.label },
          ],
        }));
      } else if (event.type === "error") {
        if (event.url) {
          updateJob(event.url, (job) => ({
            status: "failed",
            error: event.message,
            message: event.message,
            log: [...job.log, { status: "failed", message: event.message }],
          }));
        } else {
          setNotice({ tone: "error", text: event.message });
        }
      }
    },
    [updateJob],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const urls = extractUrls(text);
    const cards: ChatItem[] = urls.map((url) => ({
      kind: "job",
      id: uid(),
      url,
      job: {
        url,
        itemId: null,
        status: "pending",
        message: STATUS_META.pending.label,
        log: [],
      },
    }));

    setItems((prev) => [
      ...prev,
      { kind: "text", id: uid(), role: "user", content: text },
      ...cards,
    ]);
    setInput("");
    setSending(true);
    setNotice(null);

    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          urls,
          priceMultiplier: 1 + markup / 100,
        }),
      });

      if (!res.body) throw new Error("Resposta sem corpo.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            handleEvent(JSON.parse(payload) as PipelineEvent);
          } catch {
            // ignora chunks inválidos
          }
        }
      }
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Erro ao processar.",
      });
    } finally {
      setSending(false);
      void refreshConnection();
    }
  }, [input, sending, markup, handleEvent, refreshConnection]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-4xl flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-400 text-slate-900 shadow-sm">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              MeliAutoPublish AI
            </h1>
            <p className="text-xs text-slate-500">
              Extração + otimização com IA + publicação no Mercado Livre
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSession((value) => !value)}
            title="Cookie de sessão do Mercado Livre (necessário para anúncios de terceiros)"
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              session?.configured
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
            )}
          >
            {session?.configured ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            Sessão ML
          </button>
          {connection?.connected ? (
            <>
              <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:flex">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {connection.nickname || "Conectado"}
              </span>
              <a
                href="/api/auth/logout"
                title="Desconectar"
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sair
              </a>
            </>
          ) : (
            <a
              href="/api/auth/login"
              className="flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-700"
            >
              <Plug className="h-3.5 w-3.5" />
              Conectar Mercado Livre
            </a>
          )}
        </div>
      </header>

      {notice && (
        <div
          className={cn(
            "flex items-start gap-2 border-b px-4 py-2.5 text-sm sm:px-6",
            notice.tone === "success"
              ? "border-emerald-100 bg-emerald-50 text-emerald-800"
              : "border-rose-100 bg-rose-50 text-rose-800",
          )}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {showSession && (
        <div className="border-b border-slate-200 bg-amber-50/50 px-4 py-3 text-sm sm:px-6">
          <div className="flex items-start gap-2.5">
            <Cookie className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1 space-y-2">
              <p className="text-xs leading-relaxed text-slate-600">
                O Mercado Livre só libera anúncios de terceiros com uma sessão
                logada. Entre no Mercado Livre, abra o DevTools (F12) → Network,
                clique em qualquer requisição e copie o valor do cabeçalho{" "}
                <code className="rounded bg-slate-200 px-1">Cookie</code> — cole
                abaixo. Vale para esta conta; renove quando expirar.
              </p>

              {session?.configured ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-all">
                    Ativo
                    {session.source === "env" ? " (via ML_SESSION_COOKIE)" : ""}:{" "}
                    {session.preview ?? "•••"}
                  </span>
                  {session.source !== "env" && (
                    <button
                      type="button"
                      onClick={() => void clearSession()}
                      disabled={sessionBusy}
                      className="ml-auto flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-0.5 font-medium transition hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remover
                    </button>
                  )}
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Nenhum cookie configurado — anúncios de terceiros vão falhar.
                </p>
              )}

              <textarea
                value={sessionInput}
                onChange={(e) => setSessionInput(e.target.value)}
                rows={3}
                placeholder="_csrf=...; ssid=...; ..."
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveSession()}
                  disabled={sessionBusy || !sessionInput.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sessionBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  Salvar cookie
                </button>
                <button
                  type="button"
                  onClick={() => setShowSession(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
      >
        {items.map((item) =>
          item.kind === "text" ? (
            <Bubble key={item.id} role={item.role} content={item.content} />
          ) : (
            <JobCard key={item.id} job={item.job} />
          ),
        )}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Processando...
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Cole um ou mais links do Mercado Livre aqui..."
            className="max-h-40 min-h-[52px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="flex h-[52px] items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Enviar
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Dica: envie vários links de uma vez — eu processo um por um.
          </span>
          <label className="flex items-center gap-1.5">
            Markup sobre o preço original:
            <input
              type="number"
              value={markup}
              min={-50}
              max={200}
              step={1}
              onChange={(e) => setMarkup(Number(e.target.value) || 0)}
              className="w-16 rounded-md border border-slate-200 px-2 py-1 text-right text-xs outline-none focus:border-sky-500"
            />
            %
          </label>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-slate-900 text-white" : "bg-yellow-400 text-slate-900",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-slate-900 text-white"
            : "rounded-tl-sm border border-slate-200 bg-white text-slate-700",
        )}
      >
        {content}
      </div>
    </div>
  );
}

function JobCard({ job }: { job: JobView }) {
  const meta = STATUS_META[job.status];
  const busy =
    job.status === "extracting" ||
    job.status === "optimizing" ||
    job.status === "publishing" ||
    job.status === "pending";

  return (
    <div className="ml-10 w-[calc(100%-2.5rem)] max-w-[80%] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <Search className="h-3.5 w-3.5 text-slate-400" />
        <span className="truncate text-xs text-slate-500">
          {job.itemId ?? job.url}
        </span>
        {busy ? (
          <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-slate-400" />
        ) : null}
      </div>

      <div className="space-y-2 px-4 py-3">
        {job.log.length === 0 && (
          <p className="text-sm text-slate-400">{meta.label}</p>
        )}
        {job.log.map((entry, index) => {
          const entryMeta = STATUS_META[entry.status];
          const isLast = index === job.log.length - 1;
          const spinning =
            isLast &&
            busy &&
            (entry.status === "extracting" ||
              entry.status === "optimizing" ||
              entry.status === "publishing");
          return (
            <p
              key={index}
              className={cn(
                "flex items-start gap-2 text-sm",
                entry.status === "failed" ? "text-rose-600" : "text-slate-600",
              )}
            >
              {spinning ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate-400" />
              ) : (
                <span className="shrink-0">{entryMeta.emoji}</span>
              )}
              <span>{entry.message}</span>
            </p>
          );
        })}

        {job.status === "success" && (
          <div className="mt-3 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Anúncio criado com sucesso!
            </p>
            {job.title && (
              <p className="text-sm text-slate-700">
                <span className="font-medium">Título:</span> {job.title}
              </p>
            )}
            {typeof job.price === "number" && (
              <p className="text-sm text-slate-700">
                <span className="font-medium">Preço publicado:</span>{" "}
                {formatMoney(job.price, job.currencyId ?? "BRL")}
                {typeof job.suggestedPrice === "number" &&
                  Math.abs(job.suggestedPrice - job.price) > 0.01 && (
                    <span className="ml-1 text-xs text-slate-500">
                      (sugestão da IA:{" "}
                      {formatMoney(job.suggestedPrice, job.currencyId ?? "BRL")})
                    </span>
                  )}
              </p>
            )}
            {job.permalink && (
              <a
                href={job.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ver anúncio no Mercado Livre
              </a>
            )}
          </div>
        )}

        {job.status === "failed" && job.error && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-sm text-rose-700">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{job.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
