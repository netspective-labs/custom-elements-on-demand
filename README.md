# Load custom HTML elements on demand

This is a small, framework-free pattern for “loading custom elements only when they show up in the DOM”. Instead of eagerly importing and registering every web component up front, you let the browser render the HTML first, then a loader watches the DOM. When it sees an unknown custom element tag, it calls your on demand custom element resolver, which decides whether to skip it or how to load it.

The key idea is that nothing is required. There is no forced prefix, folder structure, or naming convention. The resolver is your policy layer. It can be strict (allowlist only) or loose (load anything that matches some convention). The loader stays dumb and predictable: observe, ask, import or generate, register.

What the examples demonstrate

The examples show two ways a resolver can “resolve” a tag into something the loader can install.

1. Import from URL
   Resolution shape: { importFromUrl: "./synthetic-component.js" }

What to look for:

* In index.html, the tag <synthetic-component> exists in the HTML before any JavaScript defines it.
* The loader sees the unknown element, calls the resolver, gets back importFromUrl, then dynamically imports synthetic-component.js.
* In synthetic-component.js, the component self-registers by calling customElements.define("synthetic-component", SyntheticComponent).
* After definition, the browser upgrades the already-present <synthetic-component> element and runs connectedCallback.

This is the “normal” modern approach. You typically want self-registering modules because it keeps the loader generic and keeps each component responsible for its own registration.

2. Import from template
   Resolution shape: { importFromTmpl: "tmpl-my-template-card" }

What to look for:

* In index.html, there is a <template id="tmpl-my-template-card"> that contains markup where the first element is <my-template-card>.
* The tag <my-template-card> also exists in the document before it is defined.
* When the loader sees <my-template-card>, the resolver returns importFromTmpl.
* The loader finds the template by ID, extracts the firstElementChild, and treats that as the “component root”.
* The loader generates a minimal custom element class at runtime and registers it for the template’s root tag (or defineAs if provided).
* When <my-template-card> upgrades, its connectedCallback clones in the captured HTML from the template root.

This is meant for simple, mostly-static components and prototypes where you want the ergonomics of “drop HTML in a template and it becomes a component”, without creating a separate JS module.

Important behaviors and design choices to notice

1. Resolver-first policy
   Open custom elements in the wild can be noisy. The loader will see any tag with a dash. The resolver is where you prevent accidental imports of random tags. The example uses an allow-map resolver to keep it explicit: only the two demo tags load.

If you want a safer default in real usage, keep the resolver conservative:

* allowlist by tag name, or
* allow tags only in your own prefix space (x-, ce-, etc.) via a guard resolver, or
* allow only tags that opt-in via attributes like data-ce-url or data-ce-tmpl.

2. Self-registering URL modules
   In the URL example, the module defines itself. That’s the simplest, most reliable contract: import the file, and it registers the element. You don’t need fragile export naming. You also avoid double-registration issues because customElements.define is called exactly once per module.

3. Template-backed elements are intentionally minimal
   The template mode is not trying to recreate a full component framework. In the provided implementation it:

* captures innerHTML from the template root once
* renders that HTML into the host on first connectedCallback
* marks the host as rendered to avoid repeated renders

That’s enough to demonstrate the idea and keep it understandable. It’s also the part you’d extend if you wanted slots, attribute-to-text bindings, or event delegation.

4. Learning how the loader actually triggers
   You learn usage by watching the timeline:

* element exists in DOM, but undefined
* loader scans and/or observes mutations
* resolver returns a resolution
* loader imports or generates
* customElements.define happens
* browser upgrades the element and runs lifecycle callbacks

If you open the browser devtools console, enable the log hook in the loader options, and reload the page, you can see the import/define events and confirm your resolver is being called as expected.

How to use this in your own code

Start with the allow-map style resolver (most explicit). Add one tag at a time.

1. Create your loader with a resolver:

* map "my-tag" to "./elements/my-tag.js" (URL import), or
* map "my-tag" to template id (template import)

2. Ensure your URL modules self-register:
   customElements.define("my-tag", MyTag)

3. Place your custom tags in HTML normally, even before the JS runs: <my-tag></my-tag>

4. Start the loader once:
   loader.start()

What you should experiment with next

* Add a third component and see that nothing loads unless the resolver allows it.
* Change the resolver to attributeUrlResolver and add data-ce-url="./x.js" on a tag to opt-in loading.
* Insert HTML dynamically (appendChild) after page load and confirm the MutationObserver path loads it.
* For template mode, try changing the template inner structure and confirm the generated component picks it up (it will capture at define-time, not live-update, in the current implementation).

