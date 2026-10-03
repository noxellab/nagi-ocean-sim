"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");
const { prepareRendererForPMREM } = require("./pmrem-harness.cjs");
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "src");
async function modules() {
  const source = fs.readFileSync(path.join(DIST, "ocean.js"), "utf8");
  const names = [
    ...new Set(
      [...source.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"];$/gm)].map(
        (m) => m[1],
      ),
    ),
  ].filter((name) => name !== "three");
  const loaded = await Promise.all(
    names.map((name) => import(pathToFileURL(path.resolve(DIST, name)).href)),
  );
  return {
    three: await import("three"),
    bindings: Object.assign({}, ...loaded),
  };
}
function mockGL(renderer) {
  const gl = {};
  for (const name of [
    "FRAMEBUFFER",
    "FRAMEBUFFER_COMPLETE",
    "READ_FRAMEBUFFER",
    "READ_FRAMEBUFFER_BINDING",
    "DRAW_FRAMEBUFFER_BINDING",
    "READ_BUFFER",
    "PIXEL_PACK_BUFFER",
    "PIXEL_PACK_BUFFER_BINDING",
    "PACK_ALIGNMENT",
    "PACK_ROW_LENGTH",
    "PACK_SKIP_PIXELS",
    "PACK_SKIP_ROWS",
    "VIEWPORT",
    "SCISSOR_BOX",
    "SCISSOR_TEST",
    "COLOR_ATTACHMENT0",
    "RGBA",
    "FLOAT",
  ])
    gl[name] = name;
  Object.assign(gl, {
    NO_ERROR: 0,
    CONTEXT_LOST_WEBGL: 37442,
    getParameter(name) {
      if (name === "VIEWPORT" || name === "SCISSOR_BOX")
        return [0, 0, renderer.domElement.width, renderer.domElement.height];
      if (name === "READ_BUFFER") return 0;
      if (name === "PACK_ALIGNMENT") return 4;
      return null;
    },
    isEnabled: () => false,
    bindFramebuffer() {},
    readBuffer() {},
    bindBuffer() {},
    pixelStorei() {},
    getError: () => 0,
    checkFramebufferStatus: () =>
      (
        typeof renderer.fault.framebuffer === "function"
          ? renderer.fault.framebuffer(renderer.getRenderTarget())
          : renderer.fault.framebuffer
      )
        ? 0
        : gl.FRAMEBUFFER_COMPLETE,
    readPixels(x, y, w, h, format, type, data) {
      data.fill(renderer.fault.probeNaN ? NaN : 0.02);
    },
  });
  return gl;
}
async function boot(options = {}) {
  const { three, bindings } = await modules();
  const dom = new JSDOM(
    fs.readFileSync(path.join(ROOT, "index.html"), "utf8"),
    {
      runScripts: "outside-only",
      url: "http://example.test/",
      pretendToBeVisual: true,
    },
  );
  const w = dom.window,
    d = w.document,
    ctx = dom.getInternalVMContext();
  w.innerWidth = 1280;
  w.innerHeight = 720;
  w.devicePixelRatio = 2;
  let now = w.performance.now(),
    hidden = false,
    callback,
    registered;
  const warnings = [],
    errors = [],
    requests = [],
    timers = new Map(),
    textures = [],
    records = [];
  const calls = {
      spectral: [],
      gpuCapillary: [],
      cpuCapillary: [],
      foam: [],
      clears: [],
    },
    instances = {},
    imageJobs = [];
  let timerSerial = 0;
  Object.defineProperty(d, "hidden", { get: () => hidden });
  w.matchMedia = () => ({ matches: !!options.reduced });
  w.requestAnimationFrame = (cb) => {
    callback = cb;
    return 1;
  };
  w.setTimeout = (fn, ms) => {
    const id = ++timerSerial;
    timers.set(id, { fn, ms });
    return id;
  };
  w.clearTimeout = (id) => timers.delete(id);
  w.console.warn = (...args) => warnings.push(args.map(String).join(" "));
  w.console.error = (...args) => errors.push(args.map(String).join(" "));
  Object.assign(w, bindings);
  for (const [exportName, key] of [
    ["createSpectralOcean", "spectral"],
    ["createCapillaryOcean", "gpuCapillary"],
    ["createCpuCapillaryOcean", "cpuCapillary"],
  ]) {
    w[exportName] = (...args) => {
      const instance = bindings[exportName](...args);
      if (!instance) return instance;
      instances[key] = instance;
      const renderer = args[1],
        update = instance.update;
      instance.update = (...parameters) => {
        calls[key].push(parameters);
        renderer.activeSubsystem = key;
        try {
          return update(...parameters);
        } finally {
          renderer.activeSubsystem = null;
        }
      };
      return instance;
    };
  }

  w.fetch = async (url, { signal } = {}) => {
    requests.push({ type: "fetch", url, signal });
    if (options.badHDR) throw Error("Injected HDR fetch failure");
    const data = options.shortHDR
      ? Buffer.alloc(1024)
      : fs.readFileSync(path.join(ROOT, "public", url));
    return {
      ok: true,
      arrayBuffer: async () =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };
  class TextureLoader {
    load(url, onLoad, onProgress, onError) {
      requests.push({ type: "image", url });
      const t = new three.Texture();
      t.userData.url = url;
      t.addEventListener(
        "dispose",
        () => (t.userData.disposed = (t.userData.disposed || 0) + 1),
      );
      textures.push(t);
      const job = {
        url,
        texture: t,
        finish: () => onLoad?.(t),
        fail: () => onError?.(Error("Injected image failure")),
      };
      imageJobs.push(job);
      if (!options.hangPattern)
        Promise.resolve().then(() =>
          options.badPattern ? job.fail() : job.finish(),
        );
      return t;
    }
    async loadAsync(url) {
      requests.push({ type: "image", url });
      if (options.hangJPEG) return new Promise(() => {});
      if (options.badJPEG && url.includes(options.badJPEG))
        throw Error("Injected JPEG failure");
      const t = new three.Texture();
      t.userData.url = url;
      t.addEventListener(
        "dispose",
        () => (t.userData.disposed = (t.userData.disposed || 0) + 1),
      );
      textures.push(t);
      return t;
    }
  }
  class RenderTarget extends three.WebGLRenderTarget {
    constructor(...args) {
      super(...args);
      const r = { target: this, disposals: 0 };
      records.push(r);
      this.addEventListener("dispose", () => r.disposals++);
    }
  }
  class CubeTarget extends three.WebGLCubeRenderTarget {
    constructor(...args) {
      super(...args);
      const r = { target: this, disposals: 0 };
      records.push(r);
      this.addEventListener("dispose", () => r.disposals++);
    }
  }
  class Renderer {
    constructor() {
      this.domElement = d.createElement("canvas");
      this.domElement.setPointerCapture = () => {};
      this.debug = {};
      this.capabilities = {
        maxTextures: 16,
        maxTextureSize: 16384,
        isWebGL2: true,
      };
      this.extensions = { has: () => options.float !== false };
      this.pixelRatio = 1;
      this.width = 1280;
      this.height = 720;
      this.color = new three.Color(0x556677);
      this.alpha = 0.7;
      this.fault = {
        spectral: !!options.failSpectralInit,
        gpuCapillary: !!options.failGpuCapillaryInit,
      };
      this.stats = { main: 0, seabed: 0, atmosphere: 0, foam: 0, spectral: 0 };
      this.gl = mockGL(this);
      prepareRendererForPMREM(this);
    }
    getActiveCubeFace() {
      return this.face || 0;
    }
    getActiveMipmapLevel() {
      return this.level || 0;
    }
    getRenderTarget() {
      return this.target || null;
    }
    setRenderTarget(target, face = 0, level = 0) {
      this.target = target;
      this.face = face;
      this.level = level;
    }
    getContext() {
      return this.gl;
    }
    getDrawingBufferSize(v) {
      return v.set(this.domElement.width, this.domElement.height);
    }
    getClearColor(v) {
      return v.copy(this.color);
    }
    getClearAlpha() {
      return this.alpha;
    }
    setClearColor(color, alpha = 1) {
      this.color.set(color);
      this.alpha = alpha;
    }
    clear() {
      calls.clears.push({ target: this.target, time: now });
    }
    setPixelRatio(r) {
      this.pixelRatio = r;
      this.setSize(this.width, this.height);
    }
    setSize(width, height) {
      this.width = width;
      this.height = height;
      this.domElement.width = Math.floor(width * this.pixelRatio);
      this.domElement.height = Math.floor(height * this.pixelRatio);
    }
    initTexture() {
      this.uploads = (this.uploads || 0) + 1;
      if (this.fault.cpuUpload) throw Error("Injected CPU upload failure");
    }
    render(scene, camera) {
      if (this.activeSubsystem && this.fault[this.activeSubsystem]) {
        this.fault[this.activeSubsystem] = false;
        throw Error("Injected " + this.activeSubsystem + " render failure");
      }
      const activeRecord = records.find((r) => r.target === this.target);
      if (activeRecord?.disposals)
        throw Error("Attempted draw into disposed target");
      const mesh = scene.children?.[0],
        u = mesh?.material?.uniforms;
      if (
        scene.children?.some(
          (child) => child.geometry?.type === "SphereGeometry",
        )
      ) {
        this.stats.main++;
        this.main = { scene, camera };
      } else if (mesh?.material?.name === "Seabed radiance") {
        this.stats.seabed++;
        if (this.fault.seabed) throw Error("Injected seabed render failure");
      } else if (u?.uAtmosSun) this.stats.atmosphere++;
      else if (u?.uPreviousFoam) {
        this.stats.foam++;
        this.foamPass = { scene, camera, uniforms: u };
        calls.foam.push({
          dt: u.uSimDt.value,
          delta: u.uFoamDelta?.value.toArray(),
          anchor: u.uFoamAnchor?.value.toArray(),
          resolution: u.uFoamResolution?.value,
          scale: u.uFoamScale?.value,
          target: this.target,
        });
        if (this.fault.foam) {
          this.fault.foam = false;
          throw Error("Injected foam render failure");
        }
      } else this.stats.spectral++;
    }
  }
  w.THREE = {
    ...three,
    TextureLoader,
    WebGLRenderer: Renderer,
    WebGLRenderTarget: RenderTarget,
    WebGLCubeRenderTarget: CubeTarget,
  };
  d.modelContext = { registerTool: (t) => (registered = t) };
  const source = fs
    .readFileSync(path.join(DIST, "ocean.js"), "utf8")
    .replace(/^import[\s\S]*?;\n/gm, "");
  vm.runInContext(source, ctx);
  await flush();
  await flush();
  now = w.performance.now();
  const h = {
    three,
    w,
    d,
    ctx,
    records,
    warnings,
    errors,
    requests,
    timers,
    textures,
    calls,
    instances,
    imageJobs,
    get(name) {
      return vm.runInContext(name, ctx);
    },
    get renderer() {
      return this.get("renderer");
    },
    get uniforms() {
      return this.get("uniforms");
    },
    frames(n = 1, dt = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        if (!callback) throw Error("No RAF scheduled");
        callback((now += dt));
      }
    },
    set(expression) {
      return vm.runInContext(expression, ctx);
    },
    pointer(type, id, x, y) {
      const event = new w.Event(type);
      Object.assign(event, { pointerId: id, clientX: x, clientY: y });
      d.querySelector("canvas").dispatchEvent(event);
    },
    click(id) {
      d.getElementById(id).click();
    },
    preset(name) {
      d.querySelector(`[data-preset="${name}"]`).click();
    },
    input(id, value) {
      d.getElementById(id).value = value;
      d.getElementById(id).dispatchEvent(new w.Event("input"));
    },
    hidden(value) {
      hidden = value;
      d.dispatchEvent(new w.Event("visibilitychange"));
    },
    resize(width, height) {
      w.innerWidth = width;
      w.innerHeight = height;
      w.dispatchEvent(new w.Event("resize"));
    },
    timer(ms) {
      for (const [id, t] of [...timers])
        if (t.ms === ms) {
          timers.delete(id);
          t.fn();
        }
    },
    configure(data) {
      return registered.execute(data);
    },
    close() {
      dom.window.close();
    },
  };
  return h;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
module.exports = { boot, modules, ROOT, DIST, flush };
