// ReelCheck web app: point the camera at the TV, tap Identify, get IMDb / Rotten Tomatoes /
// Metacritic ratings. Claude reads the screen; OMDb supplies the ratings.

import { Camera, LENS_NAMES } from "./camera.js";
import { ClaudeVision } from "./claude.js";
import { normalize } from "./matching.js";
import { OmdbClient } from "./omdb.js";
import { historyRow, resultCard, shareText } from "./render.js";
import { history, settings } from "./storage.js";

const $ = (id) => document.getElementById(id);
const ui = {
  preview: $("preview"),
  viewfinder: $("viewfinder"),
  scanBox: $("scanBox"),
  status: $("status"),
  cameraMessage: $("cameraMessage"),
  cameraMessageText: $("cameraMessageText"),
  cameraRetry: $("cameraRetry"),
  zoomPills: $("zoomPills"),
  zoomLabel: $("zoomLabel"),
  lensButton: $("lensButton"),
  identifyButton: $("identifyButton"),
  historyButton: $("historyButton"),
  searchButton: $("searchButton"),
  settingsButton: $("settingsButton"),
  installHint: $("installHint"),
  installHintClose: $("installHintClose"),
  toast: $("toast"),
  toastText: $("toastText"),
  toastAction: $("toastAction"),
  resultSheet: $("resultSheet"),
  resultContent: $("resultContent"),
  searchSheet: $("searchSheet"),
  searchForm: $("searchForm"),
  searchTitle: $("searchTitle"),
  searchYear: $("searchYear"),
  searchCancel: $("searchCancel"),
  historySheet: $("historySheet"),
  historyList: $("historyList"),
  historyEmpty: $("historyEmpty"),
  historyClear: $("historyClear"),
  historyDone: $("historyDone"),
  settingsSheet: $("settingsSheet"),
  settingsForm: $("settingsForm"),
  settingsIntro: $("settingsIntro"),
  settingsNotice: $("settingsNotice"),
  omdbKeyInput: $("omdbKey"),
  anthropicKeyInput: $("anthropicKey"),
  settingsCancel: $("settingsCancel"),
};

const camera = new Camera(ui.preview);
const ZOOM_STOPS = [1, 2, 3, 5];
const READY_STATUS = "Zoom in on the title, then tap Identify";

let busy = false;
let inFlight = null; // AbortController of the running identification or lookup
let current = null; // the history entry on the result card
let toastTimer = 0;

// MARK: - Status, toast, busy

function setStatus(text) {
  ui.status.textContent = text;
}

/** `tone`: "error" (default) or "info". */
function showToast(message, action, tone = "error") {
  clearTimeout(toastTimer);
  ui.toast.dataset.tone = tone;
  ui.toastText.textContent = message;
  ui.toastAction.hidden = !action;
  ui.toastAction.textContent = action?.label ?? "";
  ui.toastAction.onclick = action
    ? () => {
        hideToast();
        action.run();
      }
    : null;
  ui.toast.hidden = false;
  toastTimer = setTimeout(hideToast, action ? 8000 : 5000);
}

function hideToast() {
  clearTimeout(toastTimer);
  ui.toast.hidden = true;
}

function setBusy(isBusy, text) {
  busy = isBusy;
  ui.identifyButton.disabled = isBusy;
  ui.identifyButton.classList.toggle("working", isBusy);
  ui.identifyButton.setAttribute("aria-busy", String(isBusy));
  setStatus(text ?? READY_STATUS);
}

/** Runs `task` with a fresh AbortController; errors become toasts. */
async function run(statusText, task) {
  if (busy) return;
  hideToast();
  inFlight = new AbortController();
  const { signal } = inFlight;
  setBusy(true, statusText);
  try {
    await task(signal);
  } catch (error) {
    if (signal.aborted || error?.name === "AbortError") return;
    const keyProblem = ["missingKey", "invalidKey"].includes(error?.kind);
    showToast(error?.message || "Something went wrong. Try again.", keyProblem ? { label: "Settings", run: () => openSettings() } : null);
  } finally {
    if (inFlight?.signal === signal) inFlight = null;
    setBusy(false);
  }
}

// MARK: - Camera

function showCameraMessage(text, canRetry) {
  ui.cameraMessageText.textContent = text;
  ui.cameraRetry.hidden = !canRetry;
  ui.cameraMessage.hidden = false;
}

async function startCamera(lens) {
  if (!Camera.isSupported) {
    showCameraMessage("This browser can't use the camera. Open ReelCheck in Safari, or add it to your Home Screen from Safari.", false);
    return;
  }
  try {
    await camera.start(lens);
    ui.cameraMessage.hidden = true;
  } catch (error) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      showCameraMessage("Camera access is off. Tap Start camera and choose Allow. If you blocked it earlier, turn it back on in iPhone Settings → Apps → Safari → Camera, then reopen ReelCheck.", true);
    } else if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
      showCameraMessage("No back camera was found.", false);
    } else {
      showCameraMessage("Couldn't start the camera. Close other apps using it and try again.", true);
    }
  }
  renderZoom();
}

function renderZoom() {
  const running = camera.isRunning;
  ui.zoomPills.replaceChildren();
  ui.zoomPills.hidden = !running;
  ui.zoomLabel.hidden = !running;
  if (!running) {
    ui.lensButton.hidden = true;
    return;
  }
  const stops = ZOOM_STOPS.filter((z) => z >= camera.minZoom - 0.01 && z <= camera.maxZoom + 0.01);
  const nearest = stops.reduce((best, z) => (Math.abs(z - camera.zoom) < Math.abs(best - camera.zoom) ? z : best), stops[0]);
  for (const stop of stops) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.textContent = `${stop}×`;
    button.setAttribute("aria-label", `Zoom ${stop} times`);
    button.setAttribute("aria-pressed", String(Math.abs(camera.zoom - stop) < 0.05));
    if (stop === nearest) button.classList.add("near");
    button.addEventListener("click", () => {
      camera.setZoom(stop);
      renderZoom();
    });
    ui.zoomPills.append(button);
  }
  // The label only matters between stops; at a stop the highlighted pill says it.
  const atStop = stops.some((stop) => Math.abs(camera.zoom - stop) < 0.05);
  ui.zoomLabel.hidden = atStop;
  ui.zoomLabel.textContent = `${camera.zoom.toFixed(1)}×`;

  const next = camera.nextLens;
  ui.lensButton.hidden = !next;
  if (next) {
    ui.lensButton.textContent = LENS_NAMES[camera.lens] ?? "Lens";
    ui.lensButton.setAttribute("aria-label", `Camera lens: ${LENS_NAMES[camera.lens] ?? "default"}. Switch to ${LENS_NAMES[next]}`);
  }
}

// Pinch to zoom on the viewfinder.
let pinch = null;
const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

ui.viewfinder.addEventListener("touchstart", (event) => {
  if (event.touches.length === 2 && camera.isRunning) {
    pinch = { distance: distance(event.touches), zoom: camera.zoom };
    event.preventDefault();
  }
}, { passive: false });

ui.viewfinder.addEventListener("touchmove", (event) => {
  if (!pinch || event.touches.length !== 2) return;
  event.preventDefault();
  camera.setZoom(pinch.zoom * (distance(event.touches) / pinch.distance));
  renderZoom();
}, { passive: false });

ui.viewfinder.addEventListener("touchend", (event) => {
  if (event.touches.length < 2) pinch = null;
});

// Stop Safari's own page zoom gestures on the camera screen.
for (const type of ["gesturestart", "gesturechange"]) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

ui.lensButton.addEventListener("click", async () => {
  const next = camera.nextLens;
  if (!next || busy) return;
  await startCamera(next);
});

ui.cameraRetry.addEventListener("click", () => startCamera());

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    camera.stop();
    renderZoom();
  } else if (!ui.cameraMessage.hidden || !camera.isRunning) {
    startCamera(camera.lens);
  }
});

// MARK: - Identification

const confidenceRank = { low: 0, medium: 1, high: 2 };
const confidenceName = ["low", "medium", "high"];

function mergeAlternatives(primaryID, lists) {
  const seen = new Set();
  const merged = [];
  for (const alt of lists.flat()) {
    const key = alt.imdbID ?? `${normalize(alt.title)}|${alt.year ?? ""}`;
    if (alt.imdbID === primaryID || seen.has(key)) continue;
    seen.add(key);
    merged.push(alt);
    if (merged.length === 6) break;
  }
  return merged;
}

function identify() {
  if (busy) return;
  if (!settings.omdbKey || !settings.anthropicKey) {
    openSettings("Add both keys to identify movies from the camera.");
    return;
  }
  if (!camera.isRunning) {
    showToast("The camera isn't running.", { label: "Start", run: () => startCamera() });
    return;
  }
  const image = camera.capture(ui.scanBox.getBoundingClientRect());
  if (!image) {
    showToast("Couldn't capture the screen. Hold steady and try again.");
    return;
  }

  run("Asking Claude…", async (signal) => {
    const answer = await new ClaudeVision(settings.anthropicKey).identify(image, { signal });
    if (!answer.identified) {
      showToast("Couldn't tell which title this is. Zoom in on the title, or open the show's info screen, and try again.", {
        label: "Search",
        run: () => openSearch(),
      });
      return;
    }

    setStatus(`Looking up ${answer.title}…`);
    const omdb = new OmdbClient(settings.omdbKey);
    const guesses = [{ title: answer.title, year: answer.year, type: answer.type }, ...answer.alternatives.map((alt) => ({ ...alt, type: null }))];
    let found = null;
    let guessIndex = 0;
    for (; guessIndex < guesses.length && !found; guessIndex++) {
      const guess = guesses[guessIndex];
      found = await omdb.lookup(guess.title, { year: guess.year, type: guess.type, signal });
    }
    if (!found) {
      showToast(`Claude thinks this is “${answer.title}”, but OMDb has no ratings for it.`, {
        label: "Search",
        run: () => openSearch(answer.title, answer.year),
      });
      return;
    }

    // A fallback guess or a loose title match lowers Claude's confidence one step.
    let confidence = confidenceRank[answer.confidence];
    if (guessIndex > 1 || found.matchScore < 0.85) confidence = Math.max(0, confidence - 1);
    const claudeAlternatives = guesses.filter((_, index) => index !== guessIndex - 1).map(({ title, year }) => ({ title, year }));
    present({
      id: crypto.randomUUID(),
      movie: found.movie,
      method: "ai",
      evidence: answer.evidence,
      confidence: confidenceName[confidence],
      alternatives: mergeAlternatives(found.movie.imdbID, [claudeAlternatives, found.alternatives]),
      at: Date.now(),
    });
  });
}

function search(title, year) {
  if (!settings.omdbKey) {
    openSettings("Add your OMDb key to look up ratings.");
    return;
  }
  run(`Looking up ${title}…`, async (signal) => {
    const found = await new OmdbClient(settings.omdbKey).lookup(title, { year, signal });
    if (!found) {
      showToast(`No match for “${title}”. Check the spelling or add the year.`, { label: "Search", run: () => openSearch(title, year) });
      return;
    }
    present({
      id: crypto.randomUUID(),
      movie: found.movie,
      method: "search",
      evidence: "",
      confidence: null,
      alternatives: mergeAlternatives(found.movie.imdbID, [found.alternatives]),
      at: Date.now(),
    });
  });
}

/** "Not this one?": shows the picked alternative and corrects the history entry. */
function choose(alternative, previous) {
  if (!settings.omdbKey) {
    openSettings("Add your OMDb key to look up ratings.");
    return;
  }
  closeSheet(ui.resultSheet);
  run(`Looking up ${alternative.title}…`, async (signal) => {
    const omdb = new OmdbClient(settings.omdbKey);
    let movie;
    if (alternative.imdbID) {
      movie = await omdb.details(alternative.imdbID, signal);
    } else {
      movie = (await omdb.lookup(alternative.title, { year: alternative.year, signal }))?.movie;
    }
    if (!movie) {
      showToast(`OMDb has no ratings for “${alternative.title}”.`);
      if (previous) showResult(previous);
      return;
    }
    const others = (previous?.alternatives ?? []).filter((alt) => alt !== alternative);
    const previousAsAlternative = previous
      ? [{ imdbID: previous.movie.imdbID, title: previous.movie.title, year: previous.movie.year, type: previous.movie.type }]
      : [];
    const entry = {
      id: crypto.randomUUID(),
      movie,
      method: "search",
      evidence: "",
      confidence: null,
      alternatives: mergeAlternatives(movie.imdbID, [previousAsAlternative, others]),
      at: Date.now(),
    };
    if (previous) history.replace(previous.id, entry);
    else history.add(entry);
    current = entry;
    showResult(entry);
  });
}

function present(entry) {
  history.add(entry);
  current = entry;
  showResult(entry);
}

// MARK: - Sheets

function openSheet(dialog) {
  for (const sheet of [ui.resultSheet, ui.searchSheet, ui.historySheet, ui.settingsSheet]) {
    if (sheet !== dialog && sheet.open) sheet.close();
  }
  if (!dialog.open) dialog.showModal();
}

function closeSheet(dialog) {
  if (dialog.open) dialog.close();
}

// Tapping the dimmed backdrop closes a sheet (the dialog element itself is the backdrop area).
for (const sheet of [ui.resultSheet, ui.searchSheet, ui.historySheet, ui.settingsSheet]) {
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.close();
  });
}

function showResult(entry) {
  current = entry;
  ui.resultContent.replaceChildren(
    resultCard(entry, {
      onChoose: (alternative) => choose(alternative, entry),
      onShare: () => shareResult(entry),
      onClose: () => closeSheet(ui.resultSheet),
    }),
  );
  openSheet(ui.resultSheet);
  ui.resultSheet.scrollTop = 0;
  setStatus(`${entry.movie.title} — tap Identify for another`);
}

async function shareResult(entry) {
  const text = shareText(entry.movie);
  const url = `https://www.imdb.com/title/${entry.movie.imdbID}/`;
  try {
    if (navigator.share) {
      await navigator.share({ title: entry.movie.title, text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    showToast("Copied to the clipboard.", null, "info");
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Couldn't share this title.");
  }
}

function openSearch(title = "", year = null) {
  ui.searchTitle.value = title;
  ui.searchYear.value = year ? String(year) : "";
  openSheet(ui.searchSheet);
  ui.searchTitle.focus();
}

ui.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = ui.searchTitle.value.replace(/\s+/g, " ").trim();
  if (!title) return;
  const year = /^\d{4}$/.test(ui.searchYear.value.trim()) ? Number(ui.searchYear.value.trim()) : null;
  closeSheet(ui.searchSheet);
  search(title, year);
});
ui.searchCancel.addEventListener("click", () => closeSheet(ui.searchSheet));

function renderHistory() {
  const items = history.list();
  ui.historyEmpty.hidden = items.length > 0;
  ui.historyClear.hidden = items.length === 0;
  ui.historyList.replaceChildren(
    ...items.map((entry) =>
      historyRow(entry, {
        onOpen: () => showResult(entry),
        onDelete: () => {
          history.remove(entry.id);
          renderHistory();
        },
      }),
    ),
  );
}

function openHistory() {
  renderHistory();
  openSheet(ui.historySheet);
}

ui.historyClear.addEventListener("click", () => {
  if (window.confirm("Clear all history?")) {
    history.clear();
    renderHistory();
  }
});
ui.historyDone.addEventListener("click", () => closeSheet(ui.historySheet));

function openSettings(notice = "") {
  const firstRun = !settings.omdbKey || !settings.anthropicKey;
  ui.settingsIntro.hidden = !firstRun;
  ui.settingsNotice.hidden = !notice;
  ui.settingsNotice.textContent = notice;
  ui.omdbKeyInput.value = settings.omdbKey;
  ui.anthropicKeyInput.value = settings.anthropicKey;
  openSheet(ui.settingsSheet);
}

ui.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  settings.omdbKey = ui.omdbKeyInput.value;
  settings.anthropicKey = ui.anthropicKeyInput.value;
  closeSheet(ui.settingsSheet);
  showToast(settings.omdbKey && settings.anthropicKey ? "Saved. Point at a title and tap Identify." : "Saved.", null, "info");
  if (!camera.isRunning) startCamera();
});
ui.settingsCancel.addEventListener("click", () => closeSheet(ui.settingsSheet));

// MARK: - Install hint (iPhone Safari, not yet on the Home Screen)

function maybeShowInstallHint() {
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  ui.installHint.hidden = standalone || !isIOS || settings.installHintDismissed;
}

ui.installHintClose.addEventListener("click", () => {
  settings.installHintDismissed = true;
  ui.installHint.hidden = true;
});

// MARK: - Wiring

ui.identifyButton.addEventListener("click", identify);
ui.searchButton.addEventListener("click", () => openSearch());
ui.historyButton.addEventListener("click", openHistory);
ui.settingsButton.addEventListener("click", () => openSettings());
ui.toast.addEventListener("click", (event) => {
  if (event.target !== ui.toastAction) hideToast();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

setStatus(READY_STATUS);
maybeShowInstallHint();
startCamera();
if (!settings.omdbKey || !settings.anthropicKey) openSettings();
