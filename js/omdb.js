// OMDb client: IMDb rating and votes, Rotten Tomatoes Tomatometer and Metascore for a title.
// Free key: https://www.omdbapi.com/apikey.aspx (1,000 requests a day).

import { isSameTitle, normalize, similarity } from "./matching.js";

const BASE_URL = "https://www.omdbapi.com/";
const MIN_SIMILARITY = 0.6;
const MAX_ALTERNATIVES = 6;
const TIMEOUT_MS = 15000;

/** `kind`: "missingKey" | "invalidKey" | "rateLimited" | "network" | "server" | "decoding". */
export class OmdbError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "OmdbError";
    this.kind = kind;
  }
}

const NOT_FOUND_ERRORS = ["not found", "incorrect imdb id", "too many results"];

const na = (value) => (value == null || value === "N/A" || value === "" ? null : value);

/** "8.8" or "8.8/10" → 8.8 */
export function parseImdbRating(value) {
  const n = parseFloat(String(na(value) ?? "").split("/")[0]);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
}

/** "87%" → 87 */
export function parsePercent(value) {
  const n = parseInt(String(na(value) ?? "").replace("%", ""), 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** "74" or "74/100" → 74 */
export function parseMetascore(value) {
  const n = parseInt(String(na(value) ?? "").split("/")[0], 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function posterURL(value) {
  const url = na(value);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url.replace(/^http:\/\//i, "https://");
}

function mediaType(value) {
  const type = String(value ?? "").toLowerCase();
  return ["movie", "series", "episode"].includes(type) ? type : "unknown";
}

/** The first four-digit year in an OMDb year string ("2010", "2008–2013", "2019–"). */
export function releaseYear(year) {
  const match = /^(\d{4})/.exec(String(year ?? ""));
  return match ? Number(match[1]) : null;
}

/** OMDb detail JSON → the movie object the app renders. */
export function parseDetails(json) {
  if (!json || typeof json !== "object" || !json.imdbID || !json.Title) {
    throw new OmdbError("decoding", "OMDb returned an unexpected response.");
  }
  const ratings = Array.isArray(json.Ratings) ? json.Ratings : [];
  const rating = (source) => ratings.find((r) => r && r.Source === source)?.Value;
  return {
    imdbID: json.imdbID,
    title: json.Title,
    year: na(json.Year) ?? "",
    type: mediaType(json.Type),
    rated: na(json.Rated),
    runtime: na(json.Runtime),
    genre: na(json.Genre),
    director: na(json.Director),
    actors: na(json.Actors),
    plot: na(json.Plot),
    poster: posterURL(json.Poster),
    imdbRating: parseImdbRating(rating("Internet Movie Database") ?? json.imdbRating),
    imdbVotes: na(json.imdbVotes),
    rottenTomatoes: parsePercent(rating("Rotten Tomatoes")),
    metascore: parseMetascore(rating("Metacritic") ?? json.Metascore),
  };
}

/** OMDb search JSON → [{imdbID, title, year, type, poster}], duplicates removed. */
export function parseSearch(json) {
  const seen = new Set();
  const hits = [];
  for (const item of Array.isArray(json?.Search) ? json.Search : []) {
    if (!item?.imdbID || !item.Title || seen.has(item.imdbID)) continue;
    seen.add(item.imdbID);
    hits.push({
      imdbID: item.imdbID,
      title: item.Title,
      year: na(item.Year) ?? "",
      type: mediaType(item.Type),
      poster: posterURL(item.Poster),
    });
  }
  return hits;
}

/** Whether `year` (a number) fits an OMDb year string, allowing ±1 year or a series' run. */
function yearFits(omdbYear, year) {
  const match = /^(\d{4})(?:\s*[–-]\s*(\d{4})?)?/.exec(String(omdbYear ?? ""));
  if (!match) return false;
  const start = Number(match[1]);
  const isRange = /[–-]/.test(omdbYear);
  const end = isRange ? (match[2] ? Number(match[2]) : Infinity) : start;
  return year >= start - 1 && year <= end + 1;
}

export class OmdbClient {
  constructor(apiKey, { fetchImpl = globalThis.fetch.bind(globalThis), baseURL = BASE_URL } = {}) {
    this.apiKey = String(apiKey ?? "").trim();
    this.fetch = fetchImpl;
    this.baseURL = baseURL;
  }

  /** One OMDb request. Resolves the JSON, or null when OMDb says the title wasn't found. */
  async request(params, signal) {
    if (!this.apiKey) throw new OmdbError("missingKey", "Add your OMDb API key in Settings.");
    const url = new URL(this.baseURL);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("r", "json");
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }

    let response;
    try {
      response = await this.fetch(url, { signal: withTimeout(signal, TIMEOUT_MS) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new OmdbError("network", "Couldn't reach OMDb. Check your connection.");
    }

    let json = null;
    try {
      json = await response.json();
    } catch {
      if (!response.ok) throw new OmdbError("server", `OMDb error ${response.status}.`);
      throw new OmdbError("decoding", "OMDb returned an unexpected response.");
    }

    if (json?.Response === "False") {
      const message = String(json.Error ?? "");
      const lower = message.toLowerCase();
      if (lower.includes("request limit")) {
        throw new OmdbError("rateLimited", "Your OMDb key has reached its daily limit (1,000 requests on the free key). It resets tomorrow.");
      }
      if (lower.includes("invalid api key") || lower.includes("no api key") || response.status === 401) {
        throw new OmdbError("invalidKey", "Your OMDb API key was rejected. Check it in Settings (new keys must be activated from OMDb's email first).");
      }
      if (NOT_FOUND_ERRORS.some((text) => lower.includes(text))) return null;
      throw new OmdbError("server", message || `OMDb error ${response.status}.`);
    }
    if (!response.ok) throw new OmdbError("server", `OMDb error ${response.status}.`);
    return json;
  }

  async details(imdbID, signal) {
    const json = await this.request({ i: imdbID, plot: "short" }, signal);
    if (!json) throw new OmdbError("server", "That title is no longer on OMDb.");
    return parseDetails(json);
  }

  async search(query, year, signal) {
    const json = await this.request({ s: query, y: year ?? undefined }, signal);
    return json ? parseSearch(json) : [];
  }

  /**
   * Best match for a title guess, or null. `type`: "movie" | "series" | null.
   * Resolves {movie, matchScore, alternatives}.
   */
  async lookup(title, { year = null, type = null, signal } = {}) {
    const query = String(title ?? "").replace(/\s+/g, " ").trim();
    if (!query) return null;
    const rank = (hits) =>
      hits
        .map((hit) => {
          let score = similarity(query, hit.title);
          if (year) score += yearFits(hit.year, year) ? 0.1 : -0.1;
          const preferred = type ?? "movie";
          if (hit.type === preferred) score += 0.05;
          else if (hit.type === "unknown") score -= 0.05;
          return { hit, score };
        })
        .sort((a, b) => b.score - a.score)
        .map(({ hit }) => hit);

    // The unfiltered search supplies alternatives and the fallback match; it runs alongside the
    // exact-title request. Its failure only costs the alternatives.
    const searchAnyYear = this.search(query, null, signal).catch((error) => {
      if (signal?.aborted) throw error;
      return null;
    });

    const exact = async (withYear) => {
      const json = await this.request({ t: query, y: withYear ? year : undefined, type: type ?? undefined, plot: "short" }, signal);
      if (!json) return null;
      const movie = parseDetails(json);
      return isSameTitle(query, movie.title, MIN_SIMILARITY) ? movie : null;
    };

    let movie = await exact(Boolean(year));
    if (!movie && year) movie = await exact(false);
    // OMDb's y= is exact, so a year that's one off falls through to the yearless t=, which can
    // return another film of the same name (a remake or the original). Prefer the same title
    // from the search whose year fits.
    if (movie && year && !yearFits(movie.year, year)) {
      const pool = (await searchAnyYear) ?? [];
      const better = rank(pool).find((hit) => hit.imdbID !== movie.imdbID && yearFits(hit.year, year) && normalize(hit.title) === normalize(movie.title));
      if (better) {
        const corrected = await this.details(better.imdbID, signal).catch((error) => {
          if (signal?.aborted) throw error;
          return null; // keep the match we have
        });
        movie = corrected ?? movie;
      }
    }

    let hits = await searchAnyYear;
    if (!movie) {
      if (hits === null) hits = await this.search(query, null, signal); // surface the real error
      if (year) {
        const sameYear = await this.search(query, year, signal).catch(() => []);
        const ids = new Set(sameYear.map((h) => h.imdbID));
        hits = [...sameYear, ...hits.filter((h) => !ids.has(h.imdbID))];
      }
      const best = rank(hits).find((hit) => isSameTitle(query, hit.title, MIN_SIMILARITY));
      if (!best) return null;
      movie = await this.details(best.imdbID, signal);
    }

    let matchScore = similarity(query, movie.title);
    const found = releaseYear(movie.year);
    if (year && found && !yearFits(movie.year, year)) matchScore *= 0.8;
    const alternatives = rank(hits ?? [])
      .filter((hit) => hit.imdbID !== movie.imdbID)
      .slice(0, MAX_ALTERNATIVES);
    return { movie, matchScore, alternatives };
  }
}

/** `signal` combined with a timeout (AbortSignal.any isn't in every Safari version we support). */
function withTimeout(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  const abort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }, { once: true });
  return controller.signal;
}
