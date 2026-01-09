// fluent-html.js
// Modern, dependency-free "HTML as functions" with a fluent feel:
//
//   import { body, div, table, tr, td, render } from "./fluent-html.js";
//
//   const view = body(
//     div({ class: "top" }, "Hello"),
//     table(
//       tr(td("A"), td("B")),
//     ),
//   );
//
//   render(document.body, view);
//
// Notes:
// - Creates real DOM nodes (no virtual DOM). For typical dashboards and tables this is plenty fast.
// - For updates, call render(...) again (or replaceChildren on a specific container).
// - Children are flattened; strings/numbers become text nodes; null/undefined/false are ignored.
// - First argument may be attributes/properties object.

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "text",
  "tspan",
  "defs",
  "clipPath",
  "mask",
  "pattern",
  "linearGradient",
  "radialGradient",
  "stop",
  "symbol",
  "use",
  "marker",
  "foreignObject",
  "view",
]);

/**
 * @typedef {Node | string | number | boolean | null | undefined | ChildLike[] } ChildLike
 */

/**
 * @typedef {Record<string, unknown> & {
 *   style?: string | Partial<CSSStyleDeclaration> | Record<string, string | number>;
 *   dataset?: Record<string, string | number | boolean | null | undefined>;
 *   on?: Record<string, EventListenerOrEventListenerObject>;
 * }} Attrs
 */

function isNode(v) {
  return v != null && typeof v === "object" && typeof v.nodeType === "number";
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v) && !isNode(v);
}

function toTextNode(v) {
  return document.createTextNode(String(v));
}

function appendChild(parent, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) appendChild(parent, c);
    return;
  }
  if (isNode(child)) {
    parent.appendChild(child);
    return;
  }
  if (typeof child === "string" || typeof child === "number") {
    parent.appendChild(toTextNode(child));
    return;
  }
  if (child === true) return; // ignore
  // fallback: stringify unknown values
  parent.appendChild(toTextNode(child));
}

function applyAttrs(el, attrs) {
  if (!attrs) return;

  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;

    if (k === "style") {
      if (typeof v === "string") {
        el.setAttribute("style", v);
      } else if (typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          // @ts-ignore
          el.style[sk] = String(sv);
        }
      }
      continue;
    }

    if (k === "dataset" && typeof v === "object") {
      for (const [dk, dv] of Object.entries(v)) {
        if (dv == null) continue;
        el.dataset[dk] = String(dv);
      }
      continue;
    }

    if (k === "on" && typeof v === "object") {
      for (const [ek, ev] of Object.entries(v)) {
        if (!ev) continue;
        el.addEventListener(ek, ev);
      }
      continue;
    }

    // Common DOM properties (className, value, checked, disabled, etc.)
    // If property exists, prefer setting it.
    if (k in el && !k.includes("-")) {
      try {
        // @ts-ignore
        el[k] = v;
        continue;
      } catch {
        // fall through
      }
    }

    // Boolean attributes
    if (v === true) {
      el.setAttribute(k, "");
      continue;
    }

    el.setAttribute(k, String(v));
  }
}

/**
 * Create a tag function.
 * @param {string} tagName
 * @returns {( ...args: any[] ) => HTMLElement | SVGElement}
 */
function tag(tagName) {
  const isSvg = SVG_TAGS.has(tagName);
  return (...args) => {
    /** @type {Attrs | undefined} */
    let attrs;
    /** @type {ChildLike[]} */
    let children;

    if (args.length > 0 && isPlainObject(args[0])) {
      attrs = /** @type {Attrs} */ (args[0]);
      children = /** @type {ChildLike[]} */ (args.slice(1));
    } else {
      attrs = undefined;
      children = /** @type {ChildLike[]} */ (args);
    }

    const el = isSvg
      ? document.createElementNS(SVG_NS, tagName)
      : document.createElement(tagName);

    applyAttrs(el, attrs);

    for (const c of children) appendChild(el, c);
    return el;
  };
}

/**
 * Create a document fragment from children.
 * @param  {...ChildLike} children
 * @returns {DocumentFragment}
 */
export function fragment(...children) {
  const f = document.createDocumentFragment();
  for (const c of children) appendChild(f, c);
  return f;
}

/**
 * Replace contents of a container with the provided nodes.
 * @param {Element} container
 * @param  {...ChildLike} children
 * @returns {void}
 */
export function render(container, ...children) {
  const f = fragment(...children);
  container.replaceChildren(f);
}

/**
 * Convenience: clear an element.
 * @param {Element} container
 */
export function clear(container) {
  container.replaceChildren();
}

/**
 * This proxy lets you do:
 *   import { h } from "./fluent-html.js";
 *   const { div, table } = h;
 */
export const h = new Proxy(
  {},
  {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      return tag(prop);
    },
  },
);

// Common HTML exports (so you can import { div, table, tr, td } directly)
export const html = tag("html");
export const head = tag("head");
export const body = tag("body");
export const title = tag("title");
export const meta = tag("meta");
export const link = tag("link");
export const style = tag("style");
export const script = tag("script");

export const header = tag("header");
export const footer = tag("footer");
export const main = tag("main");
export const section = tag("section");
export const nav = tag("nav");
export const article = tag("article");
export const aside = tag("aside");

export const div = tag("div");
export const span = tag("span");
export const p = tag("p");
export const pre = tag("pre");
export const code = tag("code");
export const h1 = tag("h1");
export const h2 = tag("h2");
export const h3 = tag("h3");
export const h4 = tag("h4");
export const h5 = tag("h5");
export const h6 = tag("h6");

export const a = tag("a");
export const button = tag("button");
export const input = tag("input");
export const label = tag("label");
export const form = tag("form");
export const textarea = tag("textarea");
export const select = tag("select");
export const option = tag("option");

export const table = tag("table");
export const thead = tag("thead");
export const tbody = tag("tbody");
export const tfoot = tag("tfoot");
export const tr = tag("tr");
export const th = tag("th");
export const td = tag("td");

export const ul = tag("ul");
export const ol = tag("ol");
export const li = tag("li");

export const img = tag("img");

// SVG helpers (optional to import directly)
export const svg = tag("svg");
export const g = tag("g");
export const path = tag("path");
export const circle = tag("circle");
export const rect = tag("rect");
export const text = tag("text");
