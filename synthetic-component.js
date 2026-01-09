// synthetic-component.js
// Minimal self-registering custom element module.

class SyntheticComponent extends HTMLElement {
  connectedCallback() {
    // Minimal behavior: render once.
    if (this.hasAttribute("data-rendered")) return;
    this.setAttribute("data-rendered", "1");
    this.innerHTML = `<div style="padding:10px;border:1px solid #bbb;border-radius:10px;">
      <div style="font-weight:600;">Hello from URL module</div>
      <div style="margin-top:6px;">Defined by importing <code>synthetic-component.js</code>.</div>
    </div>`;
  }
}

customElements.define("synthetic-component", SyntheticComponent);
