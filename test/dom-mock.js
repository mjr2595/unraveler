/**
 * Minimal DOM mock — just enough surface for src/content/expander.js.
 *
 * Supports the exact selector forms the engine uses:
 *   tag, [attr], [attr="v"], [attr*="v"], tag[attr], and comma groups.
 */

let uid = 0;

function parseCompound(sel) {
  const s = sel.trim();
  const m = /^([a-zA-Z][\w-]*)?(.*)$/.exec(s);
  const tag = m[1] ? m[1].toUpperCase() : null;
  const attrs = [];
  const re = /\[([\w-]+)(?:([*^$]?)=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let a;
  while ((a = re.exec(m[2])) !== null) {
    attrs.push({ name: a[1], op: a[2] || '', value: a[3] ?? a[4] ?? a[5] ?? null });
  }
  return { tag, attrs };
}

function parseSelector(sel) {
  return sel.split(',').map(parseCompound);
}

export class El {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.ownText = text;
    this.children = [];
    this.parentNode = null;
    this.disabled = false;
    this._uid = ++uid;
    this._listeners = {};
    this.style = {};
  }

  get id() { return this.attrs.id || ''; }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); bus.notify(); }
  removeAttribute(name) { delete this.attrs[name]; bus.notify(); }

  get textContent() {
    return this.ownText + this.children.map((c) => c.textContent).join('');
  }
  get innerText() { return this.textContent; }
  set innerText(v) { this.ownText = v; this.children = []; bus.notify(); }

  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === documentRoot;
  }

  append(...kids) {
    for (const k of kids) { k.parentNode = this; this.children.push(k); }
    bus.notify();
  }

  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
    bus.notify();
  }

  replaceWith(node) {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    node.parentNode = this.parentNode;
    this.parentNode.children[i] = node;
    this.parentNode = null;
    bus.notify();
  }

  matchesCompound(c) {
    if (c.tag && this.tagName !== c.tag) return false;
    for (const a of c.attrs) {
      const v = this.getAttribute(a.name);
      if (v === null) return false;
      if (a.value === null) continue;
      if (a.op === '*') { if (!v.includes(a.value)) return false; }
      else if (v !== a.value) return false;
    }
    return true;
  }

  matches(sel) { return parseSelector(sel).some((c) => this.matchesCompound(c)); }

  descendants() {
    const out = [];
    const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }

  querySelectorAll(sel) {
    const parsed = parseSelector(sel);
    return this.descendants().filter((n) => parsed.some((c) => n.matchesCompound(c)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  closest(sel) {
    const parsed = parseSelector(sel);
    let n = this;
    while (n && n !== documentRoot) {
      if (parsed.some((c) => n.matchesCompound(c))) return n;
      n = n.parentNode;
    }
    return null;
  }

  getBoundingClientRect() { return { width: 120, height: 32, top: 0, left: 0 }; }

  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }

  dispatchEvent(ev) {
    let n = this;
    while (n) {
      const hs = n._listeners && n._listeners[ev.type];
      if (hs) for (const h of hs) h.call(n, ev);
      if (!ev.bubbles) break;
      n = n.parentNode;
    }
    return true;
  }
}

// --- mutation bus -------------------------------------------------------

const bus = {
  observers: new Set(),
  notify() {
    for (const o of [...this.observers]) {
      queueMicrotask(() => { if (this.observers.has(o)) o.cb([{ type: 'childList' }]); });
    }
  }
};

export class MutationObserver {
  constructor(cb) { this.cb = cb; }
  observe() { bus.observers.add(this); }
  disconnect() { bus.observers.delete(this); }
}

// --- document -----------------------------------------------------------

const documentRoot = new El('html');
const body = new El('body');
documentRoot.append(body);

export const document = {
  body,
  querySelectorAll: (sel) => documentRoot.querySelectorAll(sel),
  querySelector: (sel) => documentRoot.querySelector(sel)
};

export function resetDom() {
  body.children.length = 0;
  bus.observers.clear();
}

// --- events -------------------------------------------------------------

class Evt {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.shiftKey = !!init.shiftKey;
    this.button = init.button ?? 0;
  }
}
export class MouseEvent extends Evt {}
export class PointerEvent extends Evt {}

// --- window -------------------------------------------------------------

export const windowMock = {
  scrollY: 0,
  scrollTo() {},
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  addEventListener() {}
};

export function install(globalObj) {
  globalObj.document = document;
  globalObj.window = windowMock;
  globalObj.MutationObserver = MutationObserver;
  globalObj.MouseEvent = MouseEvent;
  globalObj.PointerEvent = PointerEvent;
  globalObj.getComputedStyle = windowMock.getComputedStyle;
}

export { body, bus };
