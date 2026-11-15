import {
  AdvisorError,
  advisorErrorStatus,
  advisorLanguages,
  type AdvisorAnswer,
  type AdvisorContext,
  type AdvisorInput,
  type AdvisorLanguage,
  type AdvisorUsage,
} from "../_shared/advisor-contract.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const id = /^[a-z][a-z_]{0,31}$/;
export const maxQuestion = 500;
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function date(value: unknown, year: number): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !value.startsWith(`${year}-`)
  )
    return false;
  const time = Date.parse(value);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

function cleanQuestion(value: unknown) {
  if (typeof value !== "string" || value.length > maxQuestion)
    throw new AdvisorError("question");
  const question = value
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    question.length < 2 ||
    question.length > maxQuestion ||
    /https?:\/\/|[^\s@]+@[^\s@]+\.[a-z]{2,}|\b(?:bearer\s+|sk-)[\w.-]{12,}|\b\d{1,3}\.\d{3,}\s*[,; ]\s*-?\d{1,3}\.\d{3,}\b/iu.test(
      question,
    )
  )
    throw new AdvisorError("question");
  return question;
}

export function parseInput(value: unknown): AdvisorInput {
  const data = record(value);
  const { fieldId, mode, language } = data;
  const year = Number.isInteger(data.year) ? (data.year as number) : 0;
  if (
    typeof fieldId !== "string" ||
    !uuid.test(fieldId) ||
    year < 1984 ||
    year >= new Date().getUTCFullYear() ||
    (mode !== "analysis" && mode !== "chat" && mode !== "rotation") ||
    !advisorLanguages.includes(language as AdvisorLanguage)
  )
    throw new AdvisorError("invalid");
  const start = data.start ?? `${year}-01-01`;
  const end = data.end ?? `${year}-12-31`;
  if (!date(start, year) || !date(end, year) || start > end)
    throw new AdvisorError("invalid");
  const scope = {
    fieldId: fieldId.toLowerCase(),
    year,
    language: language as AdvisorLanguage,
    start,
    end,
  };
  if (mode === "analysis") return { ...scope, mode };
  if (mode === "chat")
    return {
      ...scope,
      mode,
      question: cleanQuestion(data.question),
      focus:
        typeof data.focus === "string" && id.test(data.focus)
          ? data.focus
          : undefined,
    };
  if (typeof data.scenarioId !== "string" || !uuid.test(data.scenarioId))
    throw new AdvisorError("invalid");
  return { ...scope, mode, scenarioId: data.scenarioId.toLowerCase() };
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AdvisorError("invalid");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let value = "";
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) return JSON.parse(value + decoder.decode());
      length += chunk.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new AdvisorError("invalid");
      }
      value += decoder.decode(chunk, { stream: true });
    }
  } catch {
    throw new AdvisorError("invalid");
  } finally {
    reader.releaseLock();
  }
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

type Identity<Field> = { userId: string; field: Field; revision: string };
type Reservation =
  | { state: "busy" | "limit" | "not_found" }
  | { state: "claimed"; id: string }
  | { state: "cached"; answer: AdvisorAnswer };

export type AdvisorDependencies<Field> = {
  authorize: (token: string, input: AdvisorInput) => Promise<Identity<Field>>;
  settings: () => { enabled: boolean; key?: string; model: string };
  claim: (user: string, field: string, hash: string) => Promise<Reservation>;
  context: (
    identity: Identity<Field>,
    input: AdvisorInput,
  ) => Promise<AdvisorContext>;
  infer: (
    key: string,
    model: string,
    input: AdvisorInput,
    context: AdvisorContext,
  ) => Promise<{ answer: AdvisorAnswer; usage: AdvisorUsage }>;
  complete: (
    id: string,
    answer: AdvisorAnswer | null,
    usage?: AdvisorUsage,
  ) => Promise<void>;
};

export function createAdvisorHandler<Field>(deps: AdvisorDependencies<Field>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return reply({ error: "invalid" }, 405);
    const token = req.headers
      .get("Authorization")
      ?.match(/^Bearer ([\w.-]{1,8192})$/i)?.[1];
    if (!token) return reply({ error: "sign_in" }, 401);
    let requestId: string | undefined;
    let usage: AdvisorUsage | undefined;
    try {
      const input = parseInput(await readBody(req));
      const identity = await deps.authorize(token, input);
      const { enabled, key, model } = deps.settings();
      if (!enabled) throw new AdvisorError("disabled");
      if (!key) throw new AdvisorError("key");
      const hash = await sha256(
        JSON.stringify([
          "advisor-v1",
          model,
          identity.revision,
          { ...input, question: input.question?.toLowerCase() },
        ]),
      );
      const reservation = await deps.claim(
        identity.userId,
        input.fieldId,
        hash,
      );
      if (reservation.state === "cached")
        return reply({ answer: reservation.answer, cached: true });
      if (reservation.state !== "claimed") {
        throw new AdvisorError(
          reservation.state === "not_found" ? "field" : reservation.state,
        );
      }
      requestId = reservation.id;
      const context = await deps.context(identity, input);
      const answer = Object.keys(context.facts).length
        ? await deps.infer(key, model, input, context).then((result) => {
            usage = result.usage;
            return result.answer;
          })
        : {
            summary: context.defaultSummary,
            observations: [],
            interpretations: [],
            recommendations: Object.values(context.actions),
            limitations: context.limitations,
            method: "sources" as const,
          };
      await deps.complete(requestId, answer, usage);
      return reply({ answer });
    } catch (error) {
      const known =
        error instanceof AdvisorError ? error : new AdvisorError("server");
      if (requestId) {
        // A failed completion expires in the database lease. Never log request bodies.
        await deps
          .complete(requestId, null, known.usage ?? usage)
          .catch(() => undefined);
      }
      return reply({ error: known.code }, advisorErrorStatus[known.code]);
    }
  };
}
