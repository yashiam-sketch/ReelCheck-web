// Back camera preview with lens switching, zoom (hardware when the browser exposes it, otherwise
// digital) and capture of the on-screen scan box as a JPEG.

const DIGITAL_MAX_ZOOM = 5;
const HARDWARE_MAX_ZOOM = 10;
const CAPTURE_MAX_EDGE = 1280;
const JPEG_QUALITY = 0.85;

/** Classifies an iPhone camera label ("Back Telephoto Camera", "Back Ultra Wide Camera", …). */
function lensKind(label) {
  const l = label.toLowerCase();
  if (l.includes("front")) return null;
  if (l.includes("ultra")) return "ultraWide";
  if (l.includes("tele")) return "telephoto";
  if (l.includes("dual") || l.includes("triple")) return null; // virtual multi-lens devices
  return "wide";
}

const LENS_ORDER = ["ultraWide", "wide", "telephoto"];
export const LENS_NAMES = { ultraWide: "Ultra Wide", wide: "Wide", telephoto: "Telephoto" };

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.zoom = 1;
    /** {min, max} when the browser supports the `zoom` constraint, else null (digital zoom). */
    this.hardwareZoom = null;
    /** Back lenses found after permission: [{kind, deviceId, label}], in LENS_ORDER. */
    this.lenses = [];
    this.lens = null;
    this.pendingZoom = null;
    this.zoomFrame = 0;
  }

  static get isSupported() {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  get isRunning() {
    return this.track?.readyState === "live";
  }

  get minZoom() {
    return this.hardwareZoom ? Math.max(1, this.hardwareZoom.min) : 1;
  }

  get maxZoom() {
    return this.hardwareZoom ? this.hardwareZoom.max : DIGITAL_MAX_ZOOM;
  }

  /** Starts the camera, on `lensKind` when given (after the first start). */
  async start(kind = this.lens) {
    this.stop();
    const target = kind ? this.lenses.find((lens) => lens.kind === kind) : null;
    const video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      ...(target ? { deviceId: { exact: target.deviceId } } : { facingMode: { ideal: "environment" } }),
    };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.setAttribute("playsinline", "");
    await this.video.play().catch(() => {});
    await this.waitForFrame();

    const caps = typeof this.track.getCapabilities === "function" ? this.track.getCapabilities() : {};
    this.hardwareZoom =
      caps.zoom && caps.zoom.max > caps.zoom.min
        ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, HARDWARE_MAX_ZOOM) }
        : null;
    this.zoom = this.minZoom;
    this.applyDigitalZoom();

    await this.refreshLenses();
    const deviceId = this.track.getSettings?.().deviceId;
    this.lens = this.lenses.find((lens) => lens.deviceId === deviceId)?.kind ?? target?.kind ?? "wide";
  }

  stop() {
    cancelAnimationFrame(this.zoomFrame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }

  async waitForFrame() {
    if (this.video.videoWidth > 0) return;
    await new Promise((resolve) => {
      const done = () => {
        this.video.removeEventListener("loadedmetadata", done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 3000);
      this.video.addEventListener("loadedmetadata", done);
    });
  }

  /** Back lenses by label (labels are only exposed once camera permission was granted). */
  async refreshLenses() {
    let devices = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      devices = [];
    }
    const byKind = new Map();
    for (const device of devices) {
      if (device.kind !== "videoinput" || !device.label) continue;
      const kind = lensKind(device.label);
      if (kind && !byKind.has(kind)) byKind.set(kind, { kind, deviceId: device.deviceId, label: device.label });
    }
    this.lenses = LENS_ORDER.filter((kind) => byKind.has(kind)).map((kind) => byKind.get(kind));
  }

  /** The next lens after the current one, or null when there is only one. */
  get nextLens() {
    if (this.lenses.length < 2) return null;
    const index = this.lenses.findIndex((lens) => lens.kind === this.lens);
    return this.lenses[(index + 1) % this.lenses.length].kind;
  }

  setZoom(value) {
    if (!Number.isFinite(value)) return;
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, value));
    if (this.hardwareZoom && this.track) {
      // Coalesce pinch updates to one constraint change per frame.
      this.pendingZoom = this.zoom;
      cancelAnimationFrame(this.zoomFrame);
      this.zoomFrame = requestAnimationFrame(() => {
        const zoom = this.pendingZoom;
        this.track?.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
      });
    } else {
      this.applyDigitalZoom();
    }
  }

  applyDigitalZoom() {
    this.video.style.transform = this.hardwareZoom || this.zoom === 1 ? "" : `scale(${this.zoom})`;
  }

  /**
   * JPEG (base64, no data: prefix) of what the user sees inside `box` (a viewport DOMRect),
   * at most CAPTURE_MAX_EDGE px on the long edge. Null before the first frame.
   */
  capture(box) {
    const { video } = this;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || !this.isRunning) return null;

    // The video element fills its box with object-fit: cover, then digital zoom scales the
    // element around its centre. getBoundingClientRect includes that transform.
    const rect = video.getBoundingClientRect();
    const baseWidth = video.offsetWidth || rect.width;
    const baseHeight = video.offsetHeight || rect.height;
    const digital = this.hardwareZoom ? 1 : this.zoom;
    const scale = Math.max(baseWidth / vw, baseHeight / vh) * digital;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const clampX = (x) => Math.min(vw, Math.max(0, x));
    const clampY = (y) => Math.min(vh, Math.max(0, y));
    const sx = clampX((box.left - cx) / scale + vw / 2);
    const sy = clampY((box.top - cy) / scale + vh / 2);
    const ex = clampX((box.right - cx) / scale + vw / 2);
    const ey = clampY((box.bottom - cy) / scale + vh / 2);
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw < 16 || sh < 16) return null;

    const shrink = Math.min(1, CAPTURE_MAX_EDGE / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * shrink);
    canvas.height = Math.round(sh * shrink);
    const context = canvas.getContext("2d");
    context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return dataURL.slice(dataURL.indexOf(",") + 1);
  }
}
