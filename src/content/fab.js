/**
 * Unraveler — floating "scroll to latest comment" button.
 *
 * Rendered into a Shadow DOM host pinned to <html> (outside Jira's React root),
 * so the page's styles can't reach in and React's re-renders can't tear it out.
 * main.js owns when it shows; clicking it runs UnravelerLatest.scrollToLatest.
 */

var UnravelerFab = (function () {
  'use strict';

  var HOST_ID = 'unraveler-fab-host';
  var LABEL = 'Scroll to latest comment (Alt+Shift+L)';

  var host = null;
  var button = null;
  var clickHandler = null;

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

  var SHADOW_CSS = [
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
    '  filter:drop-shadow(0 2px 6px rgba(9,30,66,.35));',
    '  transition:filter .15s;',
    '}',
    '.fab:hover .fab-img,.fab:hover svg{filter:drop-shadow(0 4px 10px rgba(9,30,66,.45));}',
    '@media (prefers-color-scheme: dark){',
    '  .fab{color:#579dff;}',
    '  .fab:focus-visible{outline-color:#579dff;}',
    '}',
    '@media (prefers-reduced-motion: reduce){',
    '  .fab{transition:none;}.fab:active{transform:none;}',
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

  function mount(onClick) {
    clickHandler = onClick;
    if (host) return;
    if (typeof document.createElement !== 'function' || !document.documentElement) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    applyHostStyle();

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    root.appendChild(style);

    button = document.createElement('button');
    button.type = 'button';
    button.className = 'fab';
    button.title = LABEL;
    button.setAttribute('aria-label', LABEL);
    button.appendChild(buildIcon());
    button.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (typeof clickHandler === 'function') clickHandler();
    });
    root.appendChild(button);

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
  }

  function unmount() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    button = null;
  }

  return { mount: mount, setVisible: setVisible, setPosition: setPosition, unmount: unmount };
})();
