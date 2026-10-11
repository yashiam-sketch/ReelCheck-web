// End-to-end check in Chromium: a fake camera shows a TV with a movie title, Claude and OMDb are
// mocked at the network layer, and the test drives Identify, Search, alternatives and History.
// Needs Playwright (npm i -D playwright, or a global install) and ffmpeg.
//
//   node tests/e2e/run.mjs [--screenshots <dir>]

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const shotsArg = process.argv.indexOf("--screenshots");
const shotsDir = shotsArg > -1 ? process.argv[shotsArg + 1] : null;

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const global = execFileSync("npm", ["root", "-g"]).toString().trim();
    return await import(path.join(global, "playwright", "index.mjs"));
  }
}

// --- static server ---------------------------------------------------------------------------
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// --- fake camera -----------------------------------------------------------------------------
const work = mkdtempSync(path.join(tmpdir(), "reelcheck-e2e-"));
const y4m = path.join(work, "tv.y4m");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-loop", "1", "-i", path.join(here, "fixtures/tv.png"), "-t", "1", "-r", "5", "-pix_fmt", "yuv420p", y4m]);

// --- mocked APIs -----------------------------------------------------------------------------
const INCEPTION = {
  Title: "Inception", Year: "2010", Rated: "PG-13", Runtime: "148 min", Genre: "Action, Adventure, Sci-Fi",
  Director: "Christopher Nolan", Plot: "A thief who steals corporate secrets through dream-sharing technology is given the inverse task.",
  Poster: "N/A",
  Ratings: [
    { Source: "Internet Movie Database", Value: "8.8/10" },
    { Source: "Rotten Tomatoes", Value: "87%" },
    { Source: "Metacritic", Value: "74/100" },
  ],
  Metascore: "74", imdbRating: "8.8", imdbVotes: "2,612,345", imdbID: "tt1375666", Type: "movie", Response: "True",
};
const COBOL = { ...INCEPTION, Title: "Inception: The Cobol Job", imdbID: "tt5295894", Ratings: [{ Source: "Internet Movie Database", Value: "7.2/10" }], Metascore: "N/A", imdbRating: "7.2", Runtime: "14 min" };
const DUNE2 = { ...INCEPTION, Title: "Dune: Part Two", Year: "2024", Rated: "PG-13", Runtime: "166 min", imdbID: "tt15239678", Director: "Denis Villeneuve",
  Ratings: [{ Source: "Internet Movie Database", Value: "8.5/10" }, { Source: "Rotten Tomatoes", Value: "92%" }, { Source: "Metacritic", Value: "79/100" }], Metascore: "79", imdbRating: "8.5" };
const ROTTEN = { ...INCEPTION, Title: "Cats", Year: "2019", imdbID: "tt5697572", Ratings: [{ Source: "Internet Movie Database", Value: "2.8/10" }, { Source: "Rotten Tomatoes", Value: "19%" }, { Source: "Metacritic", Value: "32/100" }], Metascore: "32", imdbRating: "2.8" };
const BY_ID = { tt1375666: INCEPTION, tt5295894: COBOL, tt15239678: DUNE2, tt5697572: ROTTEN };

const claudeRequests = [];
const omdbRequests = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };

function omdbAnswer(params) {
  if (params.apikey !== "omdbkey1") return [401, { Response: "False", Error: "Invalid API key!" }];
  const t = (params.t ?? "").toLowerCase();
  const s = (params.s ?? "").toLowerCase();
  if (params.i) return BY_ID[params.i] ? [200, BY_ID[params.i]] : [200, { Response: "False", Error: "Incorrect IMDb ID." }];
  if (t === "inception") return [200, INCEPTION];
  if (t === "cats") return [200, ROTTEN];
  if (s.startsWith("inception")) return [200, { Search: [
    { Title: "Inception", Year: "2010", imdbID: "tt1375666", Type: "movie", Poster: "N/A" },
    { Title: "Inception: The Cobol Job", Year: "2010", imdbID: "tt5295894", Type: "movie", Poster: "N/A" },
  ], Response: "True" }];
  if (s.startsWith("dune")) return [200, { Search: [
    { Title: "Dune", Year: "1984", imdbID: "tt0087182", Type: "movie", Poster: "N/A" },
    { Title: "Dune: Part Two", Year: "2024", imdbID: "tt15239678", Type: "movie", Poster: "N/A" },
  ], Response: "True" }];
  return [200, { Response: "False", Error: "Movie not found!" }];
}

const claudeMessage = (answer) => ({
  id: "msg_e2e", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_details: null,
  usage: { input_tokens: 1500, output_tokens: 90 },
  content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: JSON.stringify(answer) }],
});
let nextClaudeAnswer = { identified: true, title: "Inception", year: 2010, media_type: "movie", confidence: "high", evidence: "The title reads INCEPTION.", alternatives: [{ title: "Interstellar", year: 2014 }] };

// --- run -------------------------------------------------------------------------------------
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  permissions: ["camera"],
  serviceWorkers: "block",
});
const page = await context.newPage();
const problems = [];
// The rejected-key step makes OMDb answer 401 on purpose; Chromium logs that as a failed load.
page.on("console", (msg) => { if (msg.type() === "error" && !msg.text().includes("status of 401")) problems.push(`console: ${msg.text()}`); });
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

await context.route("https://api.anthropic.com/**", async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  claudeRequests.push({ headers: request.headers(), body: request.postDataJSON() });
  await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(claudeMessage(nextClaudeAnswer)) });
});
await context.route("https://www.omdbapi.com/**", async (route) => {
  const params = Object.fromEntries(new URL(route.request().url()).searchParams);
  omdbRequests.push(params);
  const [status, body] = omdbAnswer(params);
  await route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
});

const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(450); // let sheet animations finish
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
};
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.log(`not ok - ${name}\n  ${error.message.split("\n").join("\n  ")}`);
    await shot(`FAILED-${name.replace(/\W+/g, "-")}`);
    process.exitCode = 1;
  }
};

try {
  await page.goto(origin);

  await step("first run opens Settings and the camera starts", async () => {
    await page.waitForSelector("#settingsSheet[open]");
    await page.waitForFunction(() => document.getElementById("preview").videoWidth > 0);
    assert.equal(await page.isVisible("#settingsIntro"), true);
    await shot("01-onboarding");
  });

  await step("saving keys closes Settings", async () => {
    await page.fill("#omdbKey", " omdbkey1 ");
    await page.fill("#anthropicKey", "sk-ant-e2e");
    await page.click("#settingsForm button[type=submit]");
    await page.waitForSelector("#settingsSheet:not([open])", { state: "attached" });
    const stored = await page.evaluate(() => [localStorage.getItem("reelcheck.omdbKey"), localStorage.getItem("reelcheck.anthropicKey")]);
    assert.deepEqual(stored, ["omdbkey1", "sk-ant-e2e"]);
    await page.waitForTimeout(300);
    await shot("02-camera");
  });

  await step("Identify sends the scan box to Claude Haiku and shows all three ratings", async () => {
    await page.click("#identifyButton");
    await page.waitForSelector("#resultSheet[open]");
    const text = await page.textContent("#resultSheet");
    for (const expected of ["Inception", "8.8", "87%", "74", "Fresh", "2,612,345 votes", "Identified by Claude", "high confidence"]) {
      assert.ok(text.includes(expected), `missing "${expected}" in result card`);
    }
    const request = claudeRequests.at(-1);
    assert.equal(request.body.model, "claude-haiku-5-5");
    assert.equal(request.body.output_config.effort, "low");
    assert.equal(request.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(request.headers["x-api-key"], "sk-ant-e2e");
    const image = Buffer.from(request.body.messages[0].content[0].source.data, "base64");
    assert.equal(image.subarray(0, 2).toString("hex"), "ffd8", "image is a JPEG");
    assert.ok(image.length > 5000, `image too small: ${image.length} bytes`);
    assert.ok(omdbRequests.every((p) => p.apikey === "omdbkey1"));
    await shot("03-result");
  });

  await step("Not this one? swaps to the alternative and corrects history", async () => {
    await page.click("#resultSheet details.alternatives summary");
    await page.click("#resultSheet .alt-button:has-text('Inception: The Cobol Job')");
    await page.waitForFunction(() => document.querySelector("#resultSheet[open] #result-title")?.textContent === "Inception: The Cobol Job");
    const titles = await page.evaluate(() => JSON.parse(localStorage.getItem("reelcheck.history")).map((e) => e.movie.title));
    assert.deepEqual(titles, ["Inception: The Cobol Job"]);
    await page.click("#resultSheet .button.wide");
    await page.waitForSelector("#resultSheet:not([open])", { state: "attached" });
  });

  await step("rotten score and low Metascore render as Rotten / red", async () => {
    nextClaudeAnswer = { identified: true, title: "Cats", year: 2019, media_type: "movie", confidence: "medium", evidence: "Poster art.", alternatives: [] };
    await page.click("#identifyButton");
    await page.waitForSelector("#resultSheet[open]");
    const text = await page.textContent("#resultSheet");
    assert.ok(text.includes("Rotten") && text.includes("19%"));
    assert.equal(await page.locator("#resultSheet .mc-bad").count(), 1);
    await shot("04-rotten");
    await page.click("#resultSheet .button.wide");
  });

  await step("manual search finds Dune: Part Two through the search fallback", async () => {
    await page.click("#searchButton");
    await page.fill("#searchTitle", "Dune Part Two");
    await page.fill("#searchYear", "2024");
    await page.click("#searchForm button[type=submit]");
    await page.waitForFunction(() => document.querySelector("#resultSheet[open] #result-title")?.textContent === "Dune: Part Two");
    assert.ok((await page.textContent("#resultSheet")).includes("92%"));
    await page.click("#resultSheet .button.wide");
  });

  await step("Claude unsure shows a helpful message, not a result", async () => {
    nextClaudeAnswer = { identified: false, title: null, year: null, media_type: "unknown", confidence: "low", evidence: "Too blurry.", alternatives: [] };
    await page.click("#identifyButton");
    await page.waitForSelector("#toast:not([hidden])");
    assert.ok((await page.textContent("#toast")).includes("Couldn't tell"));
    assert.equal(await page.isVisible("#resultSheet[open]"), false);
    await shot("05-unsure");
  });

  await step("zoom pills apply digital zoom and the capture follows it", async () => {
    const before = claudeRequests.length;
    nextClaudeAnswer = { identified: true, title: "Inception", year: 2010, media_type: "movie", confidence: "high", evidence: "Title.", alternatives: [] };
    await page.click("#zoomPills button:has-text('2×')");
    const transform = await page.evaluate(() => document.getElementById("preview").style.transform);
    assert.equal(transform, "scale(2)");
    await page.click("#identifyButton");
    await page.waitForSelector("#resultSheet[open]");
    assert.equal(claudeRequests.length, before + 1);
    await page.click("#resultSheet .button.wide");
  });

  await step("History lists identifications newest first and opens a card", async () => {
    await page.click("#historyButton");
    await page.waitForSelector("#historySheet[open]");
    const titles = await page.locator(".history-title").allTextContents();
    assert.deepEqual(titles, ["Inception (2010)", "Dune: Part Two (2024)", "Cats (2019)", "Inception: The Cobol Job (2010)"]);
    await shot("06-history");
    await page.click(".history-open >> nth=1");
    await page.waitForFunction(() => document.querySelector("#resultSheet[open] #result-title")?.textContent === "Dune: Part Two");
  });

  await step("a rejected OMDb key points to Settings", async () => {
    await page.click("#resultSheet .button.wide");
    await page.evaluate(() => localStorage.setItem("reelcheck.omdbKey", "badkey"));
    await page.click("#searchButton");
    await page.fill("#searchTitle", "Inception");
    await page.click("#searchForm button[type=submit]");
    await page.waitForSelector("#toast:not([hidden])");
    assert.ok((await page.textContent("#toast")).includes("OMDb API key was rejected"));
    assert.equal(await page.textContent("#toastAction"), "Settings");
  });

  await step("no console errors or CSP violations", async () => {
    assert.deepEqual(problems, []);
  });
} finally {
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
