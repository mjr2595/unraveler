/**
 * Unraveler — floating scroll buttons.
 *
 * The main button scrolls to the latest comment. A smaller scroll-to-top
 * button hides behind it and slides out — above it in bottom corners, below it
 * in top corners — while the main button is hovered or keyboard-focused.
 *
 * Rendered into a Shadow DOM host pinned to <html> (outside Jira's React root),
 * so the page's styles can't reach in and React's re-renders can't tear it out.
 * main.js owns when it shows and what each click does.
 */

var UnravelerFab = (function () {
  'use strict';

  var HOST_ID = 'unraveler-fab-host';
  var LATEST_LABEL = 'Scroll to latest comment (Alt+Shift+L)';
  var TOP_LABEL = 'Scroll to top (Alt+Shift+U)';

  var host = null;
  var stack = null;
  var latestHandler = null;
  var topHandler = null;

  var OFFSET = '20px';
  var POSITIONS = { 'bottom-left': 1, 'bottom-right': 1, 'top-left': 1, 'top-right': 1 };

  var visible = false;
  var position = 'bottom-left';

  function cornerCss(pos) {
    switch (pos) {
      case 'bottom-right': return 'right:' + OFFSET + ';bottom:' + OFFSET + ';';
      case 'top-left': return 'top:' + OFFSET + ';left:' + OFFSET + ';';
      case 'top-right': return 'top:' + OFFSET + ';right:' + OFFSET + ';';
      default: return 'bottom:' + OFFSET + ';left:' + OFFSET + ';';
    }
  }

  function applyHostStyle() {
    if (!host) return;
    host.style.cssText =
      'position:fixed;z-index:2147483000;margin:0;padding:0;width:auto;height:auto;' +
      cornerCss(position) +
      'display:' + (visible ? 'block' : 'none') + ';';
  }

  /** In a top corner there's no room above, so the top button slides out below. */
  function applyDirection() {
    if (!stack) return;
    stack.className = 'stack' + (position.indexOf('top') === 0 ? ' down' : '');
  }

  // Main button 38px, top button 32px, 8px apart: centre to centre is
  // 19 + 8 + 16 = 43px.
  var SHADOW_CSS = [
    '.stack{position:relative;width:38px;height:38px;--lift:-43px;}',
    '.stack.down{--lift:43px;}',
    '.fab{',
    '  display:flex;align-items:center;justify-content:center;',
    '  width:38px;height:38px;padding:0;box-sizing:border-box;',
    '  border:none;border-radius:10px;cursor:pointer;',
    '  background:transparent;color:#0c66e4;',
    '  transition:transform .15s,filter .15s;',
    '}',
    '.fab:active{transform:scale(.94);}',
    '.fab:focus-visible{outline:2px solid #0c66e4;outline-offset:2px;}',
    '.fab .fab-img,.fab svg{',
    '  width:100%;height:100%;display:block;object-fit:contain;',
    '  transition:filter .15s;',
    '}',
    '.fab-latest{position:relative;z-index:2;}',
    '.fab-latest .fab-img,.fab-latest svg{filter:drop-shadow(0 2px 6px rgba(9,30,66,.35));}',
    '.fab-latest:hover .fab-img,.fab-latest:hover svg{filter:drop-shadow(0 4px 10px rgba(9,30,66,.45));}',
    // Tucked behind the main button until revealed. The icon is rotated, so the
    // shadow lives on the button instead — on the icon it would fall upward.
    '.fab-top{',
    '  position:absolute;z-index:1;left:50%;top:50%;',
    '  width:32px;height:32px;margin:-16px 0 0 -16px;border-radius:8px;',
    '  opacity:0;visibility:hidden;pointer-events:none;transform:scale(.6);',
    '  filter:drop-shadow(0 2px 6px rgba(9,30,66,.35));',
    // Hiding waits a beat so the pointer can cross from one button to the other.
    '  transition:transform .18s ease .12s,opacity .18s ease .12s,visibility 0s linear .3s,filter .15s;',
    '}',
    '.fab-top .fab-img,.fab-top svg{transform:rotate(180deg);}',
    '.fab-top:hover{filter:drop-shadow(0 4px 10px rgba(9,30,66,.45));}',
    // Invisible bridge over the gap, so the hover survives the crossing.
    '.fab-top::after{content:"";position:absolute;left:0;right:0;top:100%;height:12px;}',
    '.stack.down .fab-top::after{top:auto;bottom:100%;}',
    // :focus-visible rather than :focus-within, so a mouse click doesn't leave
    // the button stuck open after the pointer moves away.
    '.stack:hover .fab-top,.stack:has(.fab:focus-visible) .fab-top{',
    '  opacity:1;visibility:visible;pointer-events:auto;transform:translateY(var(--lift));',
    '  transition:transform .18s ease,opacity .18s ease,visibility 0s,filter .15s;',
    '}',
    '.stack:hover .fab-top:active,.stack:has(.fab:focus-visible) .fab-top:active{',
    '  transform:translateY(var(--lift)) scale(.94);',
    '}',
    '@media (prefers-color-scheme: dark){',
    '  .fab{color:#579dff;}',
    '  .fab:focus-visible{outline-color:#579dff;}',
    '}',
    '@media (prefers-reduced-motion: reduce){',
    '  .fab{transition:none;}.fab:active{transform:none;}',
    '  .fab-top{transition:opacity 0s linear .12s,visibility 0s linear .12s;}',
    '  .stack:hover .fab-top,.stack:has(.fab:focus-visible) .fab-top{transition:none;}',
    '  .stack:hover .fab-top:active,.stack:has(.fab:focus-visible) .fab-top:active{',
    '    transform:translateY(var(--lift));',
    '  }',
    '}'
  ].join('');

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgPath(d) {
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('fill', 'none');
    return p;
  }

  // Fallback glyph (a down-arrow onto a baseline) if the packaged icon can't load.
  function buildSvgIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.appendChild(svgPath('M12 4v11'));
    svg.appendChild(svgPath('M7 10l5 5 5-5'));
    svg.appendChild(svgPath('M5 20h14'));
    return svg;
  }

  function buildIcon() {
    var url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('icons/icon128.png')
      : 'icons/icon128.png';
    var img = document.createElement('img');
    img.className = 'fab-img';
    img.src = url;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.addEventListener('error', function () {
      if (img.parentNode) img.parentNode.replaceChild(buildSvgIcon(), img);
    });
    return img;
  }

  function buildButton(className, label, getHandler) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fab ' + className;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.appendChild(buildIcon());
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var handler = getHandler();
      if (typeof handler === 'function') handler();
    });
    return btn;
  }

  function mount(onLatest, onTop) {
    latestHandler = onLatest;
    topHandler = onTop;
    if (host) return;
    if (typeof document.createElement !== 'function' || !document.documentElement) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    applyHostStyle();

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    root.appendChild(style);

    stack = document.createElement('div');
    applyDirection();
    // The top button comes second in the DOM so Tab reaches it right after the
    // main button, while z-index keeps it painted behind.
    stack.appendChild(buildButton('fab-latest', LATEST_LABEL, function () { return latestHandler; }));
    stack.appendChild(buildButton('fab-top', TOP_LABEL, function () { return topHandler; }));
    root.appendChild(stack);

    document.documentElement.appendChild(host);
  }

  function setVisible(show) {
    if (!host) return;
    // Defensive: re-attach if anything ever removed the host from the tree.
    if (show && !host.isConnected && document.documentElement) {
      document.documentElement.appendChild(host);
    }
    visible = !!show;
    applyHostStyle();
  }

  function setPosition(pos) {
    position = POSITIONS[pos] ? pos : 'bottom-left';
    applyHostStyle();
    applyDirection();
  }

  function unmount() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    stack = null;
  }

  return { mount: mount, setVisible: setVisible, setPosition: setPosition, unmount: unmount };
})();
