interface GroqConfig {
  apiKey: string;
  model: string;
}

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: GroqMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
export const BACKUP_GROQ_MODEL = "openai/gpt-oss-20b";

const DEPRECATED_OR_UNAVAILABLE_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-8b-8192",
  "llama3-70b-8192",
]);

export function sanitizeModel(model: string | undefined): string {
  if (!model) return DEFAULT_GROQ_MODEL;
  const trimmed = model.trim();
  if (
    DEPRECATED_OR_UNAVAILABLE_MODELS.has(trimmed) ||
    trimmed.includes("versatile") ||
    trimmed.includes("8192") ||
    trimmed.toLowerCase().includes("llama")
  ) {
    return DEFAULT_GROQ_MODEL;
  }
  return trimmed;
}

let cachedConfig: GroqConfig | null = null;
let configValidated = false;

function getGroqConfig(): GroqConfig | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    configValidated = true;
    return null;
  }

  const rawModel = process.env.GROQ_MODEL;
  const model = sanitizeModel(rawModel);

  // If environment was pointing to a deprecated/unavailable model, update process.env in memory
  if (rawModel && rawModel !== model) {
    process.env.GROQ_MODEL = model;
  }

  if (cachedConfig && cachedConfig.apiKey === apiKey && cachedConfig.model === model) {
    return cachedConfig;
  }

  cachedConfig = { apiKey, model };
  configValidated = true;
  return cachedConfig;
}

export function isGroqConfigured(): boolean {
  return getGroqConfig() !== null;
}

export function getGroqModel(): string {
  const config = getGroqConfig();
  return config?.model ?? DEFAULT_GROQ_MODEL;
}

export async function groqChatCompletion(
  messages: GroqMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<GroqResponse | null> {
  const config = getGroqConfig();

  if (!config) {
    console.warn("Groq not configured: GROQ_API_KEY missing");
    return null;
  }

  // Ensure model is never an unsupported versatile model
  config.model = sanitizeModel(config.model);

  const controller = new AbortController();
  const timeoutMs = 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Retry configuration for rate limits
  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 1024, // Reduced from 2048 to reduce token usage
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`Groq API error: ${response.status} ${response.statusText}`, errorText);

        const unavailableModel = errorText.includes("model_not_found") || errorText.includes("model_decommissioned");
        const isRateLimited = response.status === 429;

        // Handle rate limiting with retry
        if (isRateLimited && attempt < maxRetries) {
          const retryAfter = parseInt(response.headers.get("retry-after") || "") || baseDelayMs * Math.pow(2, attempt);
          const delayMs = Math.min(retryAfter * 1000, 30000); // Cap at 30 seconds
          console.warn(`[StockPilot Groq] Rate limited (429). Attempt ${attempt + 1}/${maxRetries}. Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        const fallbackModel = config.model !== DEFAULT_GROQ_MODEL ? DEFAULT_GROQ_MODEL : BACKUP_GROQ_MODEL;
        if ((response.status === 400 || response.status === 404) && unavailableModel) {
          console.warn(`[StockPilot Groq] Model '${config.model}' not found on Groq. Retrying with fallback model '${fallbackModel}'...`);
          const fallbackResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: fallbackModel,
              messages,
              temperature: options.temperature ?? 0.3,
              max_tokens: options.maxTokens ?? 1024,
            }),
          });

          if (fallbackResponse.ok) {
            config.model = fallbackModel;
            if (cachedConfig) cachedConfig.model = fallbackModel;
            process.env.GROQ_MODEL = fallbackModel;
            return (await fallbackResponse.json()) as GroqResponse;
          }
        }

        return null;
      }

      const data = (await response.json()) as GroqResponse;
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        console.error("Groq request timeout");
      } else {
        console.error("Groq request failed:", error);
      }
      return null;
    }
  }

  return null;
}

export function verifyGroqConfiguration(): { configured: boolean; model: string | null; error?: string } {
  const config = getGroqConfig();
  if (!config) {
    return { configured: false, model: null, error: "GROQ_API_KEY not set" };
  }
  return { configured: true, model: config.model };
}