import assert from "node:assert/strict";
import test from "node:test";
import { Camera, LENS_NAMES, lensKind } from "../../js/camera.js";

// Camera only touches the browser through navigator.mediaDevices, the <video> element and
// requestAnimationFrame, so small fakes are enough to check which device each start() opens.
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

function fakeVideo() {
  return {
    srcObject: null,
    muted: false,
    videoWidth: 1920,
    videoHeight: 1080,
    style: {},
    setAttribute() {},
    play: async () => {},
    addEventListener() {},
    removeEventListener() {},
  };
}

/**
 * A phone with `devices` ([{deviceId, label}]). facingMode "environment" opens `preferred`.
 * Every opened track is kept in `tracks`; `delays[n]` delays the n-th getUserMedia (ms).
 */
function installPhone(devices, { preferred, delays = [] } = {}) {
  const requests = [];
  const tracks = [];
  const mediaDevices = {
    enumerateDevices: async () => devices.map((d) => ({ kind: "videoinput", groupId: "", ...d })),
    getUserMedia: async ({ video }) => {
      const n = requests.length;
      requests.push(video);
      if (delays[n]) await new Promise((resolve) => setTimeout(resolve, delays[n]));
      const deviceId = video.deviceId?.exact ?? preferred;
      if (!devices.some((d) => d.deviceId === deviceId)) throw Object.assign(new Error("gone"), { name: "OverconstrainedError" });
      const track = {
        readyState: "live",
        stop() { this.readyState = "ended"; },
        getSettings: () => ({ deviceId }),
        getCapabilities: () => ({}),
      };
      tracks.push(track);
      return { getVideoTracks: () => [track], getTracks: () => [track] };
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { mediaDevices }, configurable: true, writable: true });
  return { requests, tracks, opened: () => requests.map((v) => v.deviceId?.exact ?? "facingMode") };
}

const IPHONE_PRO = [
  { deviceId: "front", label: "Front Camera" },
  { deviceId: "triple", label: "Back Triple Camera" },
  { deviceId: "dualwide", label: "Back Dual Wide Camera" },
  { deviceId: "ultra", label: "Back Ultra Wide Camera" },
  { deviceId: "wide", label: "Back Camera" },
  { deviceId: "tele", label: "Back Telephoto Camera" },
];

test("lensKind only classifies labels that say back, and skips virtual multi-lens cameras", () => {
  assert.equal(lensKind("Back Camera"), "wide");
  assert.equal(lensKind("Back Ultra Wide Camera"), "ultraWide");
  assert.equal(lensKind("Back Telephoto Camera"), "telephoto");
  assert.equal(lensKind("Back Dual Wide Camera"), null);
  assert.equal(lensKind("Back Triple Camera"), null);
  assert.equal(lensKind("Front Camera"), null);
  // Safari's labels are localized: French, Italian, Japanese.
  for (const label of ["Caméra avant", "Caméra arrière", "Fotocamera anteriore", "前面カメラ", "背面カメラ"]) {
    assert.equal(lensKind(label), null, label);
  }
});

test("Safari's own back camera (a virtual multi-lens device) becomes the Auto lens and is reopened exactly", async () => {
  const phone = installPhone(IPHONE_PRO, { preferred: "triple" });
  const camera = new Camera(fakeVideo());
  await camera.start();
  assert.equal(camera.lens, "auto");
  assert.equal(LENS_NAMES[camera.lens], "Auto");
  assert.deepEqual(camera.lenses.map((l) => l.kind), ["ultraWide", "wide", "telephoto"]);
  assert.equal(camera.nextLens, "ultraWide");

  await camera.start(camera.nextLens);
  assert.equal(camera.lens, "ultraWide");
  assert.equal(camera.nextLens, "wide");

  await camera.start("telephoto");
  assert.equal(camera.nextLens, "auto");
  await camera.start(camera.nextLens);
  assert.equal(camera.lens, "auto");

  camera.stop(); // e.g. the app went to the background
  await camera.start(camera.lens); // and came back
  assert.deepEqual(phone.opened(), ["facingMode", "ultra", "tele", "triple", "triple"]);
  assert.equal(phone.tracks.filter((t) => t.readyState === "live").length, 1);
});

test("with localized labels a restart reopens the back camera, never the front one", async () => {
  const phone = installPhone([
    { deviceId: "front", label: "Caméra avant" },
    { deviceId: "back", label: "Caméra arrière" },
  ], { preferred: "back" });
  const camera = new Camera(fakeVideo());
  await camera.start();
  assert.equal(camera.lens, "auto");
  assert.equal(camera.nextLens, null); // no lens button
  camera.stop();
  await camera.start(camera.lens);
  assert.deepEqual(phone.opened(), ["facingMode", "back"]);
});

test("a remembered camera that's gone falls back to Safari's pick", async () => {
  const devices = [...IPHONE_PRO];
  const phone = installPhone(devices, { preferred: "triple" });
  const camera = new Camera(fakeVideo());
  await camera.start("auto");
  await camera.start("telephoto");
  devices.splice(devices.findIndex((d) => d.deviceId === "tele"), 1);
  await camera.start("telephoto");
  assert.equal(camera.lens, "auto");
  assert.deepEqual(phone.opened(), ["facingMode", "tele", "tele", "facingMode"]);
});

test("a start() replaced by a newer one is rejected and leaves no camera running", async () => {
  installPhone(IPHONE_PRO, { preferred: "triple" });
  const camera = new Camera(fakeVideo());
  await camera.start();

  // Two quick taps on the lens button: the first getUserMedia resolves after the second.
  const taps = installPhone(IPHONE_PRO, { preferred: "triple", delays: [40, 0] });
  const first = camera.start("ultraWide");
  const second = camera.start("wide");
  await assert.rejects(first, (error) => error.name === "CameraSuperseded");
  await second;
  assert.equal(camera.lens, "wide");
  assert.equal(camera.isRunning, true);
  assert.equal(taps.tracks.length, 2);
  assert.equal(taps.tracks.filter((t) => t.readyState === "live").length, 1, "the replaced stream was stopped");

  // stop() while a start is still opening the camera (the app went to the background).
  const fresh = installPhone(IPHONE_PRO, { preferred: "triple", delays: [40] });
  const pending = camera.start("telephoto");
  camera.stop();
  await assert.rejects(pending, (error) => error.name === "CameraSuperseded");
  assert.equal(fresh.tracks.filter((t) => t.readyState === "live").length, 0);
  assert.equal(camera.isRunning, false);
});
