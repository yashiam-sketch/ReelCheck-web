# ReelCheck (web app)

Point your iPhone at the TV, zoom in on the movie or show, tap **Identify**, and get its
**IMDb** rating, **Rotten Tomatoes** Tomatometer and **Metacritic** score.

This is the web version of ReelCheck. It runs in Safari and installs to the Home Screen, so it
needs no Mac, no App Store, no Developer Mode and no re-signing.

It's live at **<https://yashiam-sketch.github.io/ReelCheck-web/>**, published with GitHub
Pages from the public [ReelCheck-web](https://github.com/yashiam-sketch/ReelCheck-web)
repository (Settings → Pages → Source: GitHub Actions). No keys are stored in the repository.

## Install on your iPhone

1. Open <https://yashiam-sketch.github.io/ReelCheck-web/> in **Safari**.
2. Tap **•••** at the bottom right (or the **Share** button, if your toolbar shows one) →
   **Share** → scroll down or tap **View More** → **Add to Home Screen**. Leave
   **Open as Web App** turned on, then tap **Add**.
3. Open **ReelCheck** from the Home Screen and allow camera access.
4. Paste your two keys (they are saved only on your phone):
   - **OMDb** (free, for ratings): <https://www.omdbapi.com/apikey.aspx>. Choose FREE, then click
     the activation link OMDb emails you. 1,000 lookups a day.
   - **Anthropic** (identifies the title from the picture): <https://console.anthropic.com/settings/keys>.
     ReelCheck uses **Claude Haiku 5.5**, the cheapest Claude model; one identification is a small
     fraction of a cent.

Enter the keys in the Home Screen app, not in a Safari tab: on iPhone, a Home Screen web app
keeps its own storage, separate from Safari's. That's why, in a Safari tab, ReelCheck shows how
to install it instead of asking for keys.

## Using it

- Zoom with the **1× 2× 3× 5×** buttons or by pinching, until the title fills the box, then tap
  the yellow **Identify** button. If your iPhone has several back lenses, the **lens** button
  switches between them (the telephoto lens reads a TV across the room best). **Auto** is the
  camera Safari picks, which moves to the telephoto lens by itself as you zoom in.
- Title screens, a streaming app's detail page and the TV's info banner work best. Press **Info**
  or **pause** on the remote to bring the title up. Claude can also recognise many titles from
  poster art or distinctive scenes, but it never identifies actors by their faces.
- **Not this one?** on the result lists other matches. **Search** (magnifying glass) looks up a
  title by name. **History** keeps your last 100 results on the phone.

## Privacy

- When you tap Identify, the picture inside the box is sent to Anthropic's API, directly from your
  phone. Titles are sent to OMDb. Posters load from IMDb's image server (Amazon,
  `m.media-amazon.com`), which sees your IP address and which posters you view.
- The app's files are served by GitHub Pages; ReelCheck has no server of its own.
- Your keys and history are stored in local storage on your phone. Each key is sent only to
  its own service.
- Keys typed in a Safari tab are stored for the whole `yashiam-sketch.github.io` site, so any
  other GitHub Pages site on the same account could read them. Use the Home Screen app (it has
  its own storage), and don't host sites with third-party scripts on that account.

## Limits

- OMDb provides the Rotten Tomatoes **Tomatometer** (critics), not the audience score. The Rotten
  Tomatoes button opens a search for the title.
- Safari controls the camera. On some iPhones only the main lens is offered to web pages, and
  zoom beyond the lens is digital. Lens switching relies on Safari's English camera names, so on
  an iPhone set to another language the lens button stays hidden and ReelCheck uses the camera
  Safari picks.

## How it works

```
camera (getUserMedia) → crop to the scan box → Claude Haiku 5.5 (Messages API, JSON schema output)
   → {title, year, type, confidence, evidence, alternatives}
   → OMDb lookup (exact title, then fuzzy search ranked by title similarity and year;
     a different sequel number never counts as a match)
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

Every push to `main` of ReelCheck-web runs the unit tests and deploys to GitHub Pages
(`.github/workflows/pages.yml`). The source of truth is `web/` in the main ReelCheck repository;
copy it to ReelCheck-web's root to publish.
