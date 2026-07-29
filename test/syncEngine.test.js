const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createProviderName,
  normalizeBase,
  runSync,
  selectOrCreateProvider,
} = require("../out/syncEngine.js");

test("selects the provider whose model URL matches the endpoint", () => {
  const first = {
    name: "Provider A",
    models: [{ id: "a", url: "https://a.example.com" }],
  };
  const second = {
    name: "Provider B",
    models: [{ id: "b", url: "https://b.example.com/v1" }],
  };
  const config = [first, second];

  const selected = selectOrCreateProvider(config, "https://b.example.com/");

  assert.equal(selected, second);
  assert.equal(selected.name, "Provider B");
  assert.equal(config.length, 2);
  assert.deepEqual(first.models, [{ id: "a", url: "https://a.example.com" }]);
});

test("creates a separate provider for an unknown endpoint", () => {
  const first = {
    name: "Provider A",
    models: [{ id: "a", url: "https://a.example.com" }],
  };
  const second = {
    name: "Provider B",
    models: [{ id: "b", url: "https://b.example.com" }],
  };
  const config = [first, second];

  const selected = selectOrCreateProvider(config, "https://new.example.com/v1");

  assert.equal(config.length, 3);
  assert.equal(selected, config[2]);
  assert.equal(selected.name, "OpenAI-compatible (new.example.com)");
  assert.deepEqual(selected.models, []);
  assert.deepEqual(config[0], first);
  assert.deepEqual(config[1], second);
});

test("reuses a single empty provider and preserves its name", () => {
  const empty = { name: "Tên provider tuỳ chỉnh", models: [] };
  const config = [empty];

  const selected = selectOrCreateProvider(config, "https://api.example.com");

  assert.equal(selected, empty);
  assert.equal(selected.name, "Tên provider tuỳ chỉnh");
  assert.equal(config.length, 1);
});

test("normalizes a trailing slash and v1 suffix", () => {
  assert.equal(normalizeBase("https://api.example.com/v1/"), "https://api.example.com");
  assert.equal(createProviderName("https://api.example.com/v1"), "OpenAI-compatible (api.example.com)");
});

test("prunes only the matched provider and preserves other providers", async (context) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-sync-test-"));
  const configPath = path.join(tempDir, "chatLanguageModels.json");
  const untouchedProvider = {
    name: "Provider A",
    custom: "keep-provider-metadata",
    models: [
      { id: "shared", url: "https://a.example.com", custom: "keep-model-metadata" },
      { id: "a-only", url: "https://a.example.com" },
    ],
  };
  const targetProvider = {
    name: "Provider B",
    models: [
      { id: "shared", url: "https://b.example.com" },
      { id: "stale", url: "https://b.example.com" },
    ],
  };
  fs.writeFileSync(configPath, JSON.stringify([untouchedProvider, targetProvider]));

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ data: [{ id: "shared" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  context.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await runSync({
    baseUrl: "https://b.example.com/v1",
    apiKey: "test-key",
    configPath,
    prune: true,
    includeImageModels: true,
  });
  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(result.success, true);
  assert.deepEqual(result.removed, ["stale"]);
  assert.deepEqual(saved[0], untouchedProvider);
  assert.equal(saved[1].name, "Provider B");
  assert.deepEqual(saved[1].models.map((model) => model.id), ["shared"]);
});
