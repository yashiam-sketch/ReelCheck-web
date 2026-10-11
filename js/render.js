// DOM building for the result card, rating badges and history rows. All API data goes in via
// textContent/attributes, never innerHTML.

const SVG_NS = "http://www.w3.org/2000/svg";

/** el("div", {class: "x", onclick: fn}, child, "text", …) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svg(viewBox, paths, className) {
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("viewBox", viewBox);
  root.setAttribute("aria-hidden", "true");
  if (className) root.setAttribute("class", className);
  for (const [d, fill] of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", fill);
    root.append(path);
  }
  return root;
}

const tomatoIcon = () =>
  svg("0 0 32 32", [
    ["M16 8c7.2 0 13 4.9 13 11.2C29 25.4 23.2 30 16 30S3 25.4 3 19.2C3 12.9 8.8 8 16 8z", "#FA320A"],
    ["M16 9.5c-1.6-2.6-4.4-3.7-7.4-3.3 1.6 1.2 2.4 2.5 2.6 3.9-2.1-.4-4.3.2-5.9 1.7 2.8.4 5 .9 7.6.4-.8 1.3-1 2.7-.6 4.2 1.4-1.6 2.6-3 3.7-4.6 1.4 1.4 2.6 2.4 4.6 3.2-.2-1.6-.8-2.9-1.9-4 2.4.6 4.6.4 6.9-.6-2.2-1.6-4.6-2-7.1-1.4-.5-1.3-.2-2.5.9-3.8-1.6.3-2.8 1.3-3.4 4.3z", "#00912D"],
  ], "rt-icon");

const splatIcon = () =>
  svg("0 0 32 32", [
    ["M16 3l2.6 6.2 6.4-3.4-2.2 6.9 6.9 1.6-5.6 4.3 4.6 5.4-7.1.1.6 7.1-5.2-4.8-5 5 .4-7.1-7.1.1 4.5-5.6-5.7-4.1 6.9-1.9-2.5-6.8 6.5 3.2z", "#0AC855"],
  ], "rt-icon");

const typeLabel = { movie: "Movie", series: "TV series", episode: "Episode" };

export function imdbBadge(movie) {
  const rating = movie.imdbRating;
  return el(
    "div",
    { class: "badge", role: "group", "aria-label": rating != null ? `IMDb rating ${rating} out of 10${movie.imdbVotes ? `, ${movie.imdbVotes} votes` : ""}` : "No IMDb rating" },
    el("span", { class: "imdb-plate", "aria-hidden": "true", text: "IMDb" }),
    el("div", { class: "badge-score", "aria-hidden": "true" },
      el("strong", { text: rating != null ? rating.toFixed(1) : "—" }),
      rating != null ? el("span", { class: "badge-unit", text: "/10" }) : null),
    el("div", { class: "badge-caption", "aria-hidden": "true", text: movie.imdbVotes ? `${movie.imdbVotes} votes` : "No rating" }),
  );
}

export function rottenTomatoesBadge(movie) {
  const score = movie.rottenTomatoes;
  const fresh = score != null && score >= 60;
  return el(
    "div",
    { class: "badge", role: "group", "aria-label": score != null ? `Rotten Tomatoes Tomatometer ${score} percent, ${fresh ? "fresh" : "rotten"}` : "No Rotten Tomatoes score" },
    el("div", { class: "rt-plate", "aria-hidden": "true" }, score == null ? null : fresh ? tomatoIcon() : splatIcon()),
    el("div", { class: "badge-score", "aria-hidden": "true" }, el("strong", { text: score != null ? `${score}%` : "—" })),
    el("div", { class: "badge-caption", "aria-hidden": "true", text: score == null ? "No score" : fresh ? "Fresh" : "Rotten" }),
  );
}

export function metacriticBadge(movie) {
  const score = movie.metascore;
  const tone = score == null ? "none" : score >= 61 ? "good" : score >= 40 ? "mixed" : "bad";
  return el(
    "div",
    { class: "badge", role: "group", "aria-label": score != null ? `Metacritic Metascore ${score} out of 100` : "No Metacritic score" },
    el("div", { class: `mc-square mc-${tone}`, "aria-hidden": "true", text: score != null ? String(score) : "—" }),
    el("div", { class: "badge-caption", "aria-hidden": "true", text: "Metacritic" }),
  );
}

export function ratingsRow(movie) {
  return el("div", { class: "ratings" }, imdbBadge(movie), rottenTomatoesBadge(movie), metacriticBadge(movie));
}

function poster(movie, className) {
  const frame = el("div", { class: className });
  if (movie.poster) {
    const img = el("img", { src: movie.poster, alt: `Poster for ${movie.title}`, loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove(), { once: true });
    frame.append(img);
  }
  return frame;
}

export function shareText(movie) {
  const parts = [];
  if (movie.imdbRating != null) parts.push(`IMDb ${movie.imdbRating.toFixed(1)}/10`);
  if (movie.rottenTomatoes != null) parts.push(`RT ${movie.rottenTomatoes}%`);
  if (movie.metascore != null) parts.push(`Metacritic ${movie.metascore}`);
  const year = movie.year ? ` (${movie.year})` : "";
  return `${movie.title}${year}${parts.length ? ` — ${parts.join(" · ")}` : ""}`;
}

export const imdbURL = (movie) => `https://www.imdb.com/title/${encodeURIComponent(movie.imdbID)}/`;
export const rottenTomatoesURL = (movie) => `https://www.rottentomatoes.com/search?search=${encodeURIComponent(movie.title)}`;

const methodText = { ai: "Identified by Claude", search: "Searched" };

/**
 * The result card. `entry`: {movie, method, evidence, confidence, alternatives}.
 * `handlers`: {onChoose(alternative), onShare(), onClose()}.
 */
export function resultCard(entry, handlers) {
  const { movie } = entry;
  const meta = [movie.year, movie.rated, movie.runtime].filter(Boolean).join(" · ");
  const caption = [methodText[entry.method] ?? "", entry.confidence ? `${entry.confidence} confidence` : ""].filter(Boolean).join(" · ");

  const alternatives = (entry.alternatives ?? []).length
    ? el("details", { class: "alternatives" },
        el("summary", { text: "Not this one?" }),
        el("ul", {}, entry.alternatives.map((alt) =>
          el("li", {},
            el("button", { type: "button", class: "alt-button", onclick: () => handlers.onChoose(alt) },
              el("span", { class: "alt-title", text: alt.title }),
              el("span", { class: "alt-meta", text: [alt.year, typeLabel[alt.type]].filter(Boolean).join(" · ") }))))))
    : null;

  return el("article", { class: "result", "aria-labelledby": "result-title" },
    el("div", { class: "result-head" },
      poster(movie, "poster"),
      el("div", { class: "result-info" },
        el("h2", { id: "result-title", class: "result-title", text: movie.title }),
        meta ? el("p", { class: "result-meta", text: meta }) : null,
        movie.genre ? el("p", { class: "result-sub", text: movie.genre }) : null,
        movie.director ? el("p", { class: "result-sub", text: `Directed by ${movie.director}` }) : null)),
    ratingsRow(movie),
    movie.plot ? el("p", { class: "result-plot", text: movie.plot }) : null,
    el("div", { class: "result-actions" },
      el("a", { class: "button imdb-link", href: imdbURL(movie), target: "_blank", rel: "noopener noreferrer", text: "IMDb" }),
      el("a", { class: "button", href: rottenTomatoesURL(movie), target: "_blank", rel: "noopener noreferrer", text: "Rotten Tomatoes" }),
      el("button", { type: "button", class: "button", onclick: handlers.onShare, text: "Share" })),
    caption || entry.evidence
      ? el("p", { class: "result-caption" }, caption, entry.evidence ? el("span", { class: "evidence", text: ` — ${entry.evidence}` }) : null)
      : null,
    alternatives,
    el("button", { type: "button", class: "button primary wide", onclick: handlers.onClose, text: "Scan again" }));
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(timestamp) {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return relativeTime.format(Math.round(value), unit);
    value /= size;
  }
  return "";
}

export function historyRow(entry, { onOpen, onDelete }) {
  const { movie } = entry;
  const compact = [
    movie.imdbRating != null ? `IMDb ${movie.imdbRating.toFixed(1)}` : null,
    movie.rottenTomatoes != null ? `RT ${movie.rottenTomatoes}%` : null,
    movie.metascore != null ? `MC ${movie.metascore}` : null,
  ].filter(Boolean).join(" · ");
  return el("li", { class: "history-row" },
    el("button", { type: "button", class: "history-open", onclick: onOpen, "aria-label": `${movie.title}, ${compact || "no ratings"}` },
      poster(movie, "thumb"),
      el("span", { class: "history-text" },
        el("span", { class: "history-title", text: movie.year ? `${movie.title} (${movie.year})` : movie.title }),
        el("span", { class: "history-meta", text: [compact, ago(entry.at)].filter(Boolean).join("  ·  ") }))),
    el("button", { type: "button", class: "icon-button", onclick: onDelete, "aria-label": `Remove ${movie.title} from history`, text: "✕" }));
}
