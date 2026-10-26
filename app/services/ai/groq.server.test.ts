import { afterEach, describe, expect, it, vi } from "vitest";

describe("groqChatCompletion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("retries with the default model when the configured model is decommissioned", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("GROQ_MODEL", "custom-decommissioned-model");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "model_decommissioned", message: "Model is no longer supported" },
      }), { status: 400, statusText: "Bad Request" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();

    const { DEFAULT_GROQ_MODEL, groqChatCompletion } = await import("~/services/ai/groq.server");
    await groqChatCompletion([{ role: "user", content: "test" }]);
    await groqChatCompletion([{ role: "user", content: "test again" }]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("custom-decommissioned-model");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe(DEFAULT_GROQ_MODEL);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).model).toBe(DEFAULT_GROQ_MODEL);
  });

  it("automatically overrides unsupported versatile model to default instant model before calling Groq", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("GROQ_MODEL", "llama-3.3-70b-versatile");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();

    const { DEFAULT_GROQ_MODEL, groqChatCompletion, getGroqModel } = await import("~/services/ai/groq.server");
    expect(getGroqModel()).toBe(DEFAULT_GROQ_MODEL);

    await groqChatCompletion([{ role: "user", content: "test" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(DEFAULT_GROQ_MODEL);
  });
});