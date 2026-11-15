export const advisorLanguages = ["ru", "kk", "en"] as const;
export type AdvisorLanguage = (typeof advisorLanguages)[number];
export type AdvisorInput = {
  fieldId: string;
  year: number;
  mode: "analysis" | "chat" | "rotation";
  language: AdvisorLanguage;
  start: string;
  end: string;
  question?: string;
  focus?: string;
  scenarioId?: string;
};

export type Observation = {
  text: string;
  source: string;
  url?: string;
  date?: string;
};

export type AdvisorContext = {
  facts: Record<string, Observation>;
  interpretations: Record<string, string>;
  actions: Record<string, string>;
  limitations: string[];
  defaultSummary: string;
};

export type AdvisorAnswer = {
  summary: string;
  observations: Observation[];
  interpretations: string[];
  recommendations: string[];
  limitations: string[];
  focus?: string;
  method: "deepseek" | "sources";
};

export const advisorErrorStatus = {
  invalid: 400,
  question: 400,
  sign_in: 401,
  field: 404,
  scenario: 404,
  period: 409,
  busy: 409,
  limit: 429,
  disabled: 503,
  key: 503,
  billing: 503,
  provider_limit: 429,
  provider: 502,
  response: 502,
  timeout: 504,
  server: 503,
} as const;

export type AdvisorErrorCode = keyof typeof advisorErrorStatus;
export type AdvisorUsage = { prompt: number | null; completion: number | null };
export class AdvisorError extends Error {
  constructor(
    readonly code: AdvisorErrorCode,
    readonly usage?: AdvisorUsage,
  ) {
    super(code);
  }
}
