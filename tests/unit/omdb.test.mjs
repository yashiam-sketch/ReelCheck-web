import assert from "node:assert/strict";
import test from "node:test";
import { OmdbClient, OmdbError, parseDetails, parseImdbRating, parseMetascore, parsePercent, parseSearch, releaseYear } from "../../js/omdb.js";

const INCEPTION = {
  Title: "Inception", Year: "2010", Rated: "PG-13", Runtime: "148 min", Genre: "Action, Adventure, Sci-Fi",
  Director: "Christopher Nolan", Actors: "Leonardo DiCaprio", Plot: "A thief who steals corporate secrets…",
  Poster: "http://m.media-amazon.com/images/M/inception.jpg",
  Ratings: [
    { Source: "Internet Movie Database", Value: "8.8/10" },
    { Source: "Rotten Tomatoes", Value: "87%" },
    { Source: "Metacritic", Value: "74/100" },
  ],
  Metascore: "74", imdbRating: "8.8", imdbVotes: "2,612,345", imdbID: "tt1375666", Type: "movie", Response: "True",
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that answers by query and records every request's parameters. */
function scriptedFetch(answer) {
  const calls = [];
  const fetchImpl = async (url) => {
    const params = Object.fromEntries(new URL(url).searchParams);
    calls.push(params);
    return answer(params);
  };
  return { fetchImpl, calls };
}

test("parseDetails reads all three ratings and drops N/A", () => {
  const movie = parseDetails(INCEPTION);
  assert.equal(movie.title, "Inception");
  assert.equal(movie.imdbRating, 8.8);
  assert.equal(movie.rottenTomatoes, 87);
  assert.equal(movie.metascore, 74);
  assert.equal(movie.imdbVotes, "2,612,345");
  assert.equal(movie.poster, "https://m.media-amazon.com/images/M/inception.jpg");
  assert.equal(movie.type, "movie");

  const sparse = parseDetails({ ...INCEPTION, Ratings: [], imdbRating: "N/A", Metascore: "N/A", Poster: "N/A", Rated: "N/A" });
  assert.equal(sparse.imdbRating, null);
  assert.equal(sparse.rottenTomatoes, null);
  assert.equal(sparse.metascore, null);
  assert.equal(sparse.poster, null);
  assert.equal(sparse.rated, null);
  assert.throws(() => parseDetails({ Response: "True" }), OmdbError);
});

test("rating helpers", () => {
  assert.equal(parseImdbRating("7.5"), 7.5);
  assert.equal(parseImdbRating("N/A"), null);
  assert.equal(parseImdbRating("12/10"), null);
  assert.equal(parsePercent("100%"), 100);
  assert.equal(parsePercent("150%"), null);
  assert.equal(parseMetascore("61/100"), 61);
  assert.equal(releaseYear("2008–2013"), 2008);
  assert.equal(releaseYear(""), null);
});

test("parseSearch dedupes", () => {
  const hits = parseSearch({ Search: [
    { Title: "Dune", Year: "2021", imdbID: "tt1160419", Type: "movie", Poster: "N/A" },
    { Title: "Dune", Year: "2021", imdbID: "tt1160419", Type: "movie", Poster: "N/A" },
    { Title: "Dune", Year: "1984", imdbID: "tt0087182", Type: "movie", Poster: "N/A" },
  ] });
  assert.deepEqual(hits.map((h) => h.imdbID), ["tt1160419", "tt0087182"]);
});

test("lookup accepts the exact t= hit and runs the alternatives search alongside", async () => {
  const { fetchImpl, calls } = scriptedFetch((p) => {
    if (p.t) return json(INCEPTION);
    if (p.s) return json({ Search: [
      { Title: "Inception", Year: "2010", imdbID: "tt1375666", Type: "movie", Poster: "N/A" },
      { Title: "Inception: The Cobol Job", Year: "2010", imdbID: "tt5295894", Type: "movie", Poster: "N/A" },
    ], Response: "True" });
    return json({ Response: "False", Error: "Movie not found!" });
  });
  const found = await new OmdbClient(" key ", { fetchImpl }).lookup("INCEPTION", { year: 2010, type: "movie" });
  assert.equal(found.movie.imdbID, "tt1375666");
  assert.equal(found.matchScore, 1);
  assert.deepEqual(found.alternatives.map((a) => a.imdbID), ["tt5295894"]);
  assert.equal(calls.length, 2);
  const t = calls.find((c) => c.t);
  assert.deepEqual({ t: t.t, y: t.y, type: t.type, apikey: t.apikey, r: t.r }, { t: "INCEPTION", y: "2010", type: "movie", apikey: "key", r: "json" });
});

test("lookup falls back to search, ranks by similarity and year, then fetches details", async () => {
  const { fetchImpl, calls } = scriptedFetch((p) => {
    if (p.t) return json({ Response: "False", Error: "Movie not found!" });
    if (p.s) return json({ Search: [
      { Title: "Dune", Year: "1984", imdbID: "tt0087182", Type: "movie", Poster: "N/A" },
      { Title: "Dune: Part Two", Year: "2024", imdbID: "tt15239678", Type: "movie", Poster: "N/A" },
    ], Response: "True" });
    if (p.i === "tt15239678") return json({ ...INCEPTION, Title: "Dune: Part Two", Year: "2024", imdbID: "tt15239678" });
    return json({ Response: "False", Error: "Incorrect IMDb ID." });
  });
  const found = await new OmdbClient("k", { fetchImpl }).lookup("Dune Part Two", { year: 2024 });
  assert.equal(found.movie.imdbID, "tt15239678");
  assert.ok(calls.some((c) => c.i === "tt15239678"));
});

test("lookup returns null when nothing is similar enough", async () => {
  const { fetchImpl, calls } = scriptedFetch((p) =>
    p.s ? json({ Search: [{ Title: "Completely Different", Year: "2001", imdbID: "tt1", Type: "movie" }], Response: "True" })
        : json({ Response: "False", Error: "Movie not found!" }));
  assert.equal(await new OmdbClient("k", { fetchImpl }).lookup("Zzyzx Road"), null);
  assert.ok(!calls.some((c) => c.i));
});

test("error mapping", async () => {
  const cases = [
    [json({ Response: "False", Error: "Invalid API key!" }, 401), "invalidKey"],
    [json({ Response: "False", Error: "Request limit reached!" }, 401), "rateLimited"],
    [new Response("<html>oops</html>", { status: 503 }), "server"],
  ];
  for (const [response, kind] of cases) {
    const client = new OmdbClient("k", { fetchImpl: async () => response.clone() });
    await assert.rejects(client.details("tt1"), (error) => error instanceof OmdbError && error.kind === kind);
  }
  await assert.rejects(new OmdbClient("", { fetchImpl: async () => json({}) }).details("tt1"), (e) => e.kind === "missingKey");
  await assert.rejects(new OmdbClient("k", { fetchImpl: async () => { throw new TypeError("offline"); } }).details("tt1"), (e) => e.kind === "network");
});

test("special characters in titles are encoded", async () => {
  const { fetchImpl, calls } = scriptedFetch(() => json({ Response: "False", Error: "Movie not found!" }));
  await new OmdbClient("k", { fetchImpl }).lookup("Fast & Furious: Hobbs + Shaw");
  assert.equal(calls[0].t ?? calls[1].t, "Fast & Furious: Hobbs + Shaw");
});
