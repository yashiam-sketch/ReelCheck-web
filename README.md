# ReelCheck (web app)

Point your iPhone at the TV, zoom in on the movie or show, tap **Identify**, and get its
**IMDb** rating, **Rotten Tomatoes** Tomatometer and **Metacritic** score.

This is the web version of ReelCheck. It runs in Safari and installs to the Home Screen, so it
needs no Mac, no App Store, no Developer Mode and no re-signing.

## Install on your iPhone

1. Open the app's address in **Safari** (it's published with GitHub Pages:
   `https://<your-github-username>.github.io/<this-repo>/`).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **ReelCheck** from the Home Screen and allow camera access.
4. Paste your two keys (they are saved only on your phone):
   - **OMDb** (free, for ratings): <https://www.omdbapi.com/apikey.aspx>. Choose FREE, then click
     the activation link OMDb emails you. 1,000 lookups a day.
   - **Anthropic** (identifies the title from the picture): <https://console.anthropic.com/settings/keys>.
     ReelCheck uses **Claude Haiku 5.5**, the cheapest Claude model; one identification is a small
     fraction of a cent.

Enter the keys in the Home Screen app, not in a Safari tab: on iPhone, a Home Screen web app
keeps its own storage, separate from Safari's.

## Using it

- Zoom with the **1× 2× 3× 5×** buttons or by pinching, until the title fills the box, then tap
  the yellow **Identify** button. If your iPhone has several back lenses, the **lens** button
  switches between them (the telephoto lens reads a TV across the room best).
- Title screens, a streaming app's detail page and the TV's info banner work best. Press **Info**
  or **pause** on the remote to bring the title up. Claude can also recognise many titles from
  poster art or distinctive scenes, but it never identifies actors by their faces.
- **Not this one?** on the result lists other matches. **Search** (magnifying glass) looks up a
  title by name. **History** keeps your last 100 results on the phone.

## Privacy

- When you tap Identify, the picture inside the box is sent to Anthropic's API, directly from your
  phone. Titles are sent to OMDb. Nothing else leaves the phone, and nothing goes to any other
  server: this site is static files.
- Your keys and history are stored in this browser's local storage on your phone.

## Limits

- OMDb provides the Rotten Tomatoes **Tomatometer** (critics), not the audience score. The Rotten
  Tomatoes button opens a search for the title.
- Safari controls the camera. On some iPhones only the main lens is offered to web pages, and
  zoom beyond the lens is digital.

## How it works

```
camera (getUserMedia) → crop to the scan box → Claude Haiku 5.5 (Messages API, JSON schema output)
   → {title, year, type, confidence, evidence, alternatives}
   → OMDb lookup (exact title, then fuzzy search ranked by title similarity and year)
   → result card: IMDb · Rotten Tomatoes · Metacritic
```

| File | What |
|---|---|
| `index.html`, `css/app.css` | The camera screen and sheets |
| `js/app.js` | App flow: identify, search, alternatives, history, settings |
| `js/camera.js` | Back camera, lens switching, zoom, scan-box capture |
| `js/claude.js` | Claude request (official Anthropic SDK), structured-output schema, error mapping |
| `js/omdb.js` | OMDb lookups and rating parsing |
| `js/matching.js` | Title normalization and fuzzy matching |
| `js/storage.js` | Keys and history in localStorage |
| `sw.js`, `manifest.webmanifest` | Offline app shell and Home Screen install |
| `vendor/anthropic-sdk.mjs` | `@anthropic-ai/sdk` bundled for the browser (`scripts/vendor-sdk.sh`) |

## Development

No build step. Serve the folder over HTTP and open it:

```sh
npx http-server -c-1 .        # then open http://localhost:8080
npm test                      # unit tests (Node 22)
node tests/e2e/run.mjs        # browser test with a fake camera (needs Playwright and ffmpeg)
```

Every push to `main` runs the unit tests and deploys to GitHub Pages
(`.github/workflows/pages.yml`).
