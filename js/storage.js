// Settings and history, kept in this browser's localStorage only (nothing is sent anywhere).
// On iPhone, a Home Screen web app has its own storage, separate from Safari's.

// Storage keys keep the app's original "reelcheck." prefix so keys and history saved before the
// rename to ShowLens are still found.
const KEYS = {
  omdb: "reelcheck.omdbKey",
  anthropic: "reelcheck.anthropicKey",
  history: "reelcheck.history",
  installHint: "reelcheck.installHintDismissed",
};
const HISTORY_LIMIT = 100;

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null || value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const settings = {
  get omdbKey() {
    return read(KEYS.omdb) ?? "";
  },
  set omdbKey(value) {
    write(KEYS.omdb, String(value ?? "").trim());
  },
  get anthropicKey() {
    return read(KEYS.anthropic) ?? "";
  },
  set anthropicKey(value) {
    write(KEYS.anthropic, String(value ?? "").trim());
  },
  get installHintDismissed() {
    return read(KEYS.installHint) === "1";
  },
  set installHintDismissed(value) {
    write(KEYS.installHint, value ? "1" : null);
  },
};

/** History entries: {id, movie, method, evidence, confidence, at}. Newest first. */
export const history = {
  list() {
    try {
      const items = JSON.parse(read(KEYS.history) ?? "[]");
      return Array.isArray(items) ? items.filter((item) => item?.movie?.imdbID) : [];
    } catch {
      return [];
    }
  },

  save(items) {
    write(KEYS.history, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  },

  /** Adds `entry` at the top, replacing an older entry for the same title. */
  add(entry) {
    this.save([entry, ...this.list().filter((item) => item.movie.imdbID !== entry.movie.imdbID)]);
  },

  /** Replaces the entry with id `oldId` (a corrected identification) in place. */
  replace(oldId, entry) {
    const items = this.list().filter((item) => item.id === oldId || item.movie.imdbID !== entry.movie.imdbID);
    const index = items.findIndex((item) => item.id === oldId);
    if (index === -1) items.unshift(entry);
    else items[index] = entry;
    this.save(items);
  },

  remove(id) {
    this.save(this.list().filter((item) => item.id !== id));
  },

  clear() {
    write(KEYS.history, null);
  },
};
