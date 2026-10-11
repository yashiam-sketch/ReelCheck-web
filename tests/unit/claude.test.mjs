import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "../../vendor/anthropic-sdk.mjs";
import { ANSWER_SCHEMA, ClaudeError, ClaudeVision, MODEL, buildRequest, parseResponse } from "../../js/claude.js";

const answer = (fields) => ({
  id: "msg_1", type: "message", role: "assistant", model: MODEL, stop_reason: "end_turn", stop_details: null,
  usage: { input_tokens: 1200, output_tokens: 80 },
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: JSON.stringify({ identified: true, title: "Inception", year: 2010, media_type: "movie", confidence: "high", evidence: "The title card reads INCEPTION.", alternatives: [], ...fields }) },
  ],
});

function clientReturning(status, body, onRequest) {
  return new Anthropic({
    apiKey: "sk-ant-test",
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    fetch: async (url, init) => {
      onRequest?.(url, init);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_1" } });
    },
  });
}

test("request: Haiku 5.5, low effort, structured output, image before text, no rejected params", () => {
  const body = buildRequest("QUJD");
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.messages[0].content[0].type, "image");
  assert.equal(body.messages[0].content[0].source.data, "QUJD");
  assert.equal(body.messages[0].content[1].type, "text");
  for (const key of ["thinking", "temperature", "top_p", "top_k", "tool_choice", "fallbacks"]) assert.ok(!(key in body), key);
  assert.ok(body.max_tokens >= 1024);
});

test("schema: every object closed, no unsupported constraints", () => {
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") assert.equal(node.additionalProperties, false);
    for (const banned of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) assert.ok(!(banned in node), banned);
    Object.values(node).forEach(walk);
  };
  walk(ANSWER_SCHEMA);
});

test("parseResponse reads the text block after thinking blocks", () => {
  const result = parseResponse(answer({ alternatives: [{ title: "Interstellar", year: 2014 }, { title: " ", year: null }] }));
  assert.deepEqual(result, {
    identified: true, title: "Inception", year: 2010, type: "movie", confidence: "high",
    evidence: "The title card reads INCEPTION.", alternatives: [{ title: "Interstellar", year: 2014 }],
  });
});

test("parseResponse: not identified, refusal, truncation, garbage", () => {
  assert.equal(parseResponse(answer({ identified: false, title: null, year: null })).identified, false);
  assert.throws(() => parseResponse({ stop_reason: "refusal", stop_details: { explanation: "policy" }, content: [] }), (e) => e.kind === "refused");
  assert.throws(() => parseResponse({ stop_reason: "max_tokens", content: [] }), (e) => e.kind === "truncated");
  assert.throws(() => parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }), (e) => e.kind === "decoding");
  assert.equal(parseResponse(answer({ year: 3000 })).year, null);
});

test("identify sends the request through the SDK with browser headers", async () => {
  let seen;
  const vision = new ClaudeVision("sk-ant-test", { client: clientReturning(200, answer({}), (url, init) => (seen = { url: String(url), init })) });
  const result = await vision.identify("QUJD");
  assert.equal(result.title, "Inception");
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  const headers = new Headers(seen.init.headers);
  assert.equal(headers.get("x-api-key"), "sk-ant-test");
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  assert.equal(headers.get("anthropic-dangerous-direct-browser-access"), "true");
  assert.equal(JSON.parse(seen.init.body).model, "claude-haiku-5-5");
});

test("identify maps API errors to user-facing ClaudeErrors", async () => {
  const error = (type, message) => ({ type: "error", error: { type, message } });
  const cases = [
    [401, error("authentication_error", "invalid x-api-key"), "invalidKey"],
    [403, error("permission_error", "nope"), "invalidKey"],
    [429, error("rate_limit_error", "slow down"), "rateLimited"],
    [529, error("overloaded_error", "Overloaded"), "rateLimited"],
    [400, error("invalid_request_error", "Your credit balance is too low"), "server"],
    [500, error("api_error", "boom"), "server"],
  ];
  for (const [status, body, kind] of cases) {
    const vision = new ClaudeVision("sk-ant-test", { client: clientReturning(status, body) });
    await assert.rejects(vision.identify("QUJD"), (e) => e instanceof ClaudeError && e.kind === kind, `${status}`);
  }
  await assert.rejects(new ClaudeVision("").identify("QUJD"), (e) => e.kind === "missingKey");
});
