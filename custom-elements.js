/* custom-elements.js
 *
 * On-demand Custom Elements loader with optional, pluggable “on demand custom element resolvers”.
 *
 * Nothing is required:
 * - No prefixes required
 * - No naming convention required
 *
 * You pick one resolver (or compose several) and the loader will:
 * - watch the DOM for unknown custom elements (tag names containing a dash)
 * - ask the resolver what to do
 * - either skip (false) or return instructions:
 *     { importFromUrl: "./path/to/module.js" }
 *   or
 *     { importFromTmpl: "template-id" }
 *
 * URL imports: module should self-register (recommended), or you can ask the loader to define from exports.
 * Template imports: the loader will generate and register a custom element class at runtime from the template.
 */

/**
 * @typedef {new (...args: any[]) => HTMLElement} CustomElementConstructor
 */

/**
 * @typedef {{
 *   importFromUrl?: string | URL;
 *   importFromTmpl?: string;
 *   defineAs?: string;
 *   exportName?: "default" | string | ((mod: Record<string, any>) => unknown);
 *   waitForDefinition?: boolean;
 * }} OnDemandCustomElementResolution
 */

/**
 * @typedef {(tagName: string, el: Element) =>
 *   (false | OnDemandCustomElementResolution | Promise<false | OnDemandCustomElementResolution>)
 * } OnDemandCustomElementResolver
 */

/**
 * @typedef {{
 *   resolver?: OnDemandCustomElementResolver;
 *   log?: (level: "debug" | "warn" | "error", message: string, meta?: any) => void;
 *   observeMutations?: boolean;
 *   observeRoot?: Node;
 *   deepScan?: boolean;
 * }} OnDemandCustomElementsLoaderOptions
 */

/**
 * @typedef {{
 *   start: () => void;
 *   stop: () => void;
 *   scan: (root?: ParentNode) => Promise<void>;
 *   preload: (tagName: string, resolution: OnDemandCustomElementResolution) => Promise<void>;
 *   state: {
 *     pending: ReadonlySet<string>;
 *     loaded: ReadonlySet<string>;
 *     failed: ReadonlyMap<string, unknown>;
 *     skipped: ReadonlySet<string>;
 *   };
 * }} OnDemandCustomElementsLoader
 */

function isPotentialCustomElementTag(tagName) {
  const t = String(tagName).toLowerCase();
  return t.includes("-") && /^[a-z][.0-9_a-z-]*$/.test(t);
}

function isHTMLElementConstructor(x) {
  return typeof x === "function" && x.prototype instanceof HTMLElement;
}

function normalizeToAbsHref(urlLike) {
  if (urlLike instanceof URL) return urlLike.href;
  return new URL(String(urlLike), import.meta.url).href;
}

/**
 * Create an on-demand custom elements loader.
 *
 * @param {OnDemandCustomElementsLoaderOptions} [options]
 * @returns {OnDemandCustomElementsLoader}
 */
export function createOnDemandCustomElementsLoader(options = {}) {
  const log =
    options.log ??
    /**
     * @param {"debug"|"warn"|"error"} _level
     * @param {string} _message
     * @param {any} [_meta]
     */
    (() => {});

  /** @type {OnDemandCustomElementResolver} */
  const resolver =
    options.resolver ??
    (async () => false); // safest default: do nothing unless explicitly enabled

  const observeMutations = options.observeMutations ?? true;
  const observeRoot = options.observeRoot ?? document.documentElement;
  const deepScan = options.deepScan ?? true;

  /** @type {Set<string>} */
  const pending = new Set();
  /** @type {Set<string>} */
  const loaded = new Set();
  /** @type {Map<string, unknown>} */
  const failed = new Map();
  /** @type {Set<string>} */
  const skipped = new Set();

  /** @type {MutationObserver | null} */
  let observer = null;

  /**
   * Generate and register a custom element from a <template>.
   *
   * Rule:
   * - The template’s firstElementChild is treated as the “component root”.
   * - That root tag name becomes the custom element name unless `defineAs` is provided.
   * - Instances of the custom element will render by cloning the root’s children into the host.
   *
   * Minimal behavior by design: content + light-DOM rendering.
   *
   * @param {string} encounteredTag
   * @param {OnDemandCustomElementResolution} res
   */
  function defineFromTemplate(encounteredTag, res) {
    const tmplId = String(res.importFromTmpl || "");
    const tmpl = document.getElementById(tmplId);

    if (!(tmpl instanceof HTMLTemplateElement)) {
      log("warn", "Template resolution requested but template not found", { encounteredTag, importFromTmpl: tmplId });
      skipped.add(encounteredTag);
      return;
    }

    const frag = tmpl.content;
    const root = frag.firstElementChild;

    if (!(root instanceof Element)) {
      log("warn", "Template is empty or has no element root", { encounteredTag, importFromTmpl: tmplId });
      skipped.add(encounteredTag);
      return;
    }

    const inferredTag = root.tagName.toLowerCase();
    const defineAs = (res.defineAs ?? inferredTag).toLowerCase();

    if (!isPotentialCustomElementTag(defineAs)) {
      log("warn", "Refusing to define from template: invalid custom element tag", {
        encounteredTag,
        importFromTmpl: tmplId,
        inferredTag,
        defineAs,
      });
      skipped.add(encounteredTag);
      return;
    }

    // If already defined, do nothing.
    if (customElements.get(defineAs)) {
      loaded.add(encounteredTag);
      return;
    }

    // Capture the root innerHTML once, so later changes to template don't surprise you.
    const capturedInnerHTML = root.innerHTML;

    // Generate minimal custom element code at runtime.
    class TemplateBackedElement extends HTMLElement {
      connectedCallback() {
        // Avoid rerendering if the element already has content (lets authors override).
        if (this.hasAttribute("data-ce-rendered")) return;
        this.setAttribute("data-ce-rendered", "1");
        this.innerHTML = capturedInnerHTML;
      }
    }

    customElements.define(defineAs, TemplateBackedElement);
    loaded.add(encounteredTag);
  }

  /**
   * Import module and optionally define from exports.
   *
   * @param {string} encounteredTag
   * @param {OnDemandCustomElementResolution} res
   */
  async function importFromUrl(encounteredTag, res) {
    const defineAs = (res.defineAs ?? encounteredTag).toLowerCase();

    if (!isPotentialCustomElementTag(defineAs)) {
      log("warn", "Refusing to load: not a valid custom element tag name", { encounteredTag, defineAs });
      skipped.add(encounteredTag);
      return;
    }

    if (customElements.get(defineAs)) {
      loaded.add(encounteredTag);
      return;
    }

    const href = normalizeToAbsHref(res.importFromUrl);

    log("debug", "Importing custom element module", { encounteredTag, defineAs, href });

    /** @type {Record<string, any>} */
    const mod = /** @type {any} */ (await import(href));

    if (customElements.get(defineAs)) {
      loaded.add(encounteredTag);
      if (res.waitForDefinition) await customElements.whenDefined(defineAs);
      return;
    }

    // If exportName not provided, we assume the module self-registers.
    if (res.exportName == null) {
      log("warn", "Module imported but element not defined (self-registering expected)", {
        encounteredTag,
        defineAs,
        exportKeys: Object.keys(mod),
      });
      loaded.add(encounteredTag);
      return;
    }

    /** @type {unknown} */
    let candidate;
    if (typeof res.exportName === "function") {
      candidate = res.exportName(mod);
    } else if (res.exportName === "default") {
      candidate = mod.default;
    } else {
      candidate = mod[res.exportName];
    }

    if (!isHTMLElementConstructor(candidate)) {
      log("warn", "Export is not a valid HTMLElement subclass constructor; cannot define", {
        encounteredTag,
        defineAs,
        exportName: res.exportName,
        exportKeys: Object.keys(mod),
      });
      loaded.add(encounteredTag);
      return;
    }

    customElements.define(defineAs, /** @type {CustomElementConstructor} */ (candidate));
    loaded.add(encounteredTag);

    if (res.waitForDefinition) await customElements.whenDefined(defineAs);
  }

  /**
   * Apply a resolution for an encountered tag.
   *
   * @param {string} encounteredTag
   * @param {OnDemandCustomElementResolution} res
   */
  async function applyResolution(encounteredTag, res) {
    // Deduplicate by encountered tag.
    if (pending.has(encounteredTag)) return;
    pending.add(encounteredTag);
    failed.delete(encounteredTag);

    try {
      if (res.importFromTmpl) {
        defineFromTemplate(encounteredTag, res);
        if (res.waitForDefinition) {
          const defineAs = (res.defineAs ?? encounteredTag).toLowerCase();
          if (isPotentialCustomElementTag(defineAs)) await customElements.whenDefined(defineAs);
        }
        return;
      }

      if (res.importFromUrl) {
        await importFromUrl(encounteredTag, res);
        return;
      }

      log("warn", "Resolver returned a resolution with neither importFromUrl nor importFromTmpl", {
        encounteredTag,
        resolution: res,
      });
      skipped.add(encounteredTag);
    } catch (err) {
      failed.set(encounteredTag, err);
      log("error", "Failed to resolve/import/define custom element", { encounteredTag, error: err });
    } finally {
      pending.delete(encounteredTag);
    }
  }

  /**
   * Decide whether to load a particular element instance.
   *
   * @param {Element} el
   */
  async function maybeLoadForElement(el) {
    const encounteredTag = el.tagName.toLowerCase();
    if (!isPotentialCustomElementTag(encounteredTag)) return;

    if (customElements.get(encounteredTag)) return;
    if (loaded.has(encounteredTag) || failed.has(encounteredTag) || skipped.has(encounteredTag)) return;

    /** @type {false | OnDemandCustomElementResolution} */
    let decision = false;
    try {
      decision = await resolver(encounteredTag, el);
    } catch (err) {
      failed.set(encounteredTag, err);
      log("error", "Resolver threw; marking as failed", { encounteredTag, error: err });
      return;
    }

    if (decision === false) {
      skipped.add(encounteredTag);
      return;
    }

    await applyResolution(encounteredTag, decision);
  }

  async function scan(root = document) {
    if (root instanceof Element) {
      await maybeLoadForElement(root);
      if (!deepScan) return;
    }
    if (!deepScan) return;

    const all = root.querySelectorAll("*");
    for (const el of all) {
      await maybeLoadForElement(el);
    }
  }

  /**
   * @param {MutationRecord[]} mutations
   */
  function onMutations(mutations) {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        void maybeLoadForElement(node);
        for (const el of node.querySelectorAll("*")) void maybeLoadForElement(el);
      }
    }
  }

  function start() {
    void scan(document);

    if (!observeMutations) return;
    if (observer) return;

    observer = new MutationObserver(onMutations);
    observer.observe(observeRoot, { childList: true, subtree: true });
  }

  function stop() {
    observer?.disconnect();
    observer = null;
  }

  async function preload(tagName, resolution) {
    const encounteredTag = tagName.toLowerCase();
    if (!isPotentialCustomElementTag(encounteredTag)) return;
    if (customElements.get(encounteredTag)) return;
    await applyResolution(encounteredTag, resolution);
  }

  return {
    start,
    stop,
    scan,
    preload,
    state: {
      get pending() {
        return pending;
      },
      get loaded() {
        return loaded;
      },
      get failed() {
        return failed;
      },
      get skipped() {
        return skipped;
      },
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Common resolvers (optional)
 * Caller picks one (or composes several).
 * ------------------------------------------------------------------------------------------------- */

/**
 * Compose multiple resolvers: first one that returns a resolution wins.
 *
 * @param  {...OnDemandCustomElementResolver} resolvers
 * @returns {OnDemandCustomElementResolver}
 */
export function composeOnDemandCustomElementResolvers(...resolvers) {
  return async (tagName, el) => {
    for (const r of resolvers) {
      const out = await r(tagName, el);
      if (out !== false) return out;
    }
    return false;
  };
}

/**
 * Resolver: allowlist map.
 *
 * Values can be:
 * - string/URL (treated as importFromUrl)
 * - { importFromUrl, ... } or { importFromTmpl, ... }
 *
 * @param {Record<string, string | URL | OnDemandCustomElementResolution>} allow
 * @returns {OnDemandCustomElementResolver}
 */
export function allowMapResolver(allow) {
  const m = new Map(Object.entries(allow).map(([k, v]) => [k.toLowerCase(), v]));
  return async (tagName) => {
    const v = m.get(tagName.toLowerCase());
    if (!v) return false;
    if (typeof v === "string" || v instanceof URL) return { importFromUrl: v };
    return v;
  };
}

/**
 * Resolver: attribute-based URL.
 * Example:
 *   <my-widget data-ce-url="./synthetic-component.js"></my-widget>
 *
 * @param {string} attrName
 * @returns {OnDemandCustomElementResolver}
 */
export function attributeUrlResolver(attrName = "data-ce-url") {
  return async (_tagName, el) => {
    const v = el.getAttribute(attrName);
    if (!v) return false;
    return { importFromUrl: v };
  };
}

/**
 * Resolver: attribute-based template id.
 * Example:
 *   <my-template-card data-ce-tmpl="tmpl-my-template-card"></my-template-card>
 *
 * @param {string} attrName
 * @returns {OnDemandCustomElementResolver}
 */
export function attributeTemplateResolver(attrName = "data-ce-tmpl") {
  return async (_tagName, el) => {
    const v = el.getAttribute(attrName);
    if (!v) return false;
    return { importFromTmpl: v };
  };
}

/**
 * Resolver: safe prefix guard for any other strategy.
 * Useful to prevent loading random third-party custom tags.
 *
 * @param {readonly string[]} prefixes without trailing dash, eg ["x", "ce"]
 * @param {OnDemandCustomElementResolver} inner
 * @returns {OnDemandCustomElementResolver}
 */
export function prefixGuardResolver(prefixes, inner) {
  return async (tagName, el) => {
    const t = tagName.toLowerCase();
    const dash = t.indexOf("-");
    if (dash <= 0) return false;
    const prefix = t.slice(0, dash);
    if (!prefixes.includes(prefix)) return false;
    return inner(tagName, el);
  };
}
