// Выпадающие списки (<select>) в одном аккуратном виде по всей программе.
//
// Родной список браузера (особенно на Android) — это крупное всплывающее окно
// с кружками выбора: выглядит чужеродно и не в цвет программы. Здесь вместо него
// список прямо под полем: той же ширины, того же цвета и шрифта, без кружков —
// нажал на текст, список закрылся, значение встало в поле.
//
// Сам <select> остаётся на месте и остаётся источником истины: код программы,
// который читает .value, слушает 'change' или пересобирает options, не меняется.
// Список строится из живых <option> в момент открытия, а после выбора выставляет
// значение и посылает те же события input и change, что и родной.
//
// Не трогаются: select[multiple], select[size>1], недоступные (disabled) и
// помеченные data-native.

(function () {
'use strict';

var list = null;        // открытый список (DOM) или null
var owner = null;       // <select>, для которого он открыт
var rows = [];          // [{ opt, el }] — выбираемые строки
var active = -1;        // подсвеченная клавиатурой строка
var typed = '', typedAt = 0;
var touch = { x: 0, y: 0, t: 0 };
var lastTouchTap = 0;

function enhanceable(el) {
  return !!el && el.tagName === 'SELECT' && !el.multiple && !(el.size > 1) && !el.disabled && !el.hasAttribute('data-native');
}

function selectOf(target) {
  var el = target;
  while (el && el.nodeType === 1 && el.tagName !== 'SELECT') el = el.parentNode;
  return el && el.nodeType === 1 && enhanceable(el) ? el : null;
}

function close(refocus) {
  if (!list) return;
  var sel = owner;
  if (list.parentNode) list.parentNode.removeChild(list);
  list = null; owner = null; rows = []; active = -1;
  if (sel) {
    sel.removeAttribute('aria-expanded');
    if (refocus && sel.isConnected) { try { sel.focus({ preventScroll: true }); } catch (e) { /* ничего */ } }
  }
}

function setActive(i, scroll) {
  if (!rows.length) return;
  active = Math.max(0, Math.min(rows.length - 1, i));
  rows.forEach(function (r, k) { r.el.classList.toggle('active', k === active); });
  if (scroll !== false) { var el = rows[active].el; if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
}

function step(from, dir) {
  var i = from;
  for (var n = 0; n < rows.length; n++) {
    i += dir;
    if (i < 0 || i >= rows.length) return from;
    if (!rows[i].opt.disabled) return i;
  }
  return from;
}

function choose(opt) {
  if (!opt || opt.disabled || !owner) return;
  var sel = owner;
  var changed = sel.selectedIndex !== opt.index;
  close(true);
  if (!changed) return;
  sel.selectedIndex = opt.index;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function build(sel) {
  var el = document.createElement('div');
  el.className = 'm3d-sel-list';
  el.setAttribute('role', 'listbox');
  var cs = window.getComputedStyle(sel);
  el.style.fontFamily = cs.fontFamily;
  el.style.fontSize = cs.fontSize;
  rows = [];
  function addOption(opt) {
    if (opt.hidden) return;
    var row = document.createElement('div');
    row.className = 'm3d-sel-item' + (opt.selected ? ' selected' : '') + (opt.disabled ? ' disabled' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
    if (opt.disabled) row.setAttribute('aria-disabled', 'true');
    row.textContent = opt.text;
    row.addEventListener('mousedown', function (e) { e.preventDefault(); });   // фокус остаётся на поле
    row.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); choose(opt); });
    el.appendChild(row);
    rows.push({ opt: opt, el: row });
  }
  Array.prototype.forEach.call(sel.children, function (ch) {
    if (ch.tagName === 'OPTION') addOption(ch);
    else if (ch.tagName === 'OPTGROUP') {
      var g = document.createElement('div');
      g.className = 'm3d-sel-group';
      g.textContent = ch.label;
      el.appendChild(g);
      Array.prototype.forEach.call(ch.children, function (o) { if (o.tagName === 'OPTION') addOption(o); });
    }
  });
  return el;
}

function place(sel) {
  var r = sel.getBoundingClientRect();
  var vw = window.innerWidth, vh = window.innerHeight;
  var width = Math.min(Math.max(r.width, 120), vw - 16);
  var left = Math.max(8, Math.min(r.left, vw - width - 8));
  list.style.width = width + 'px';
  list.style.left = left + 'px';
  var below = vh - r.bottom - 12, above = r.top - 12;
  var want = Math.min(list.scrollHeight + 10, 340);
  if (below >= Math.min(want, 180) || below >= above) {
    list.style.top = (r.bottom + 4) + 'px'; list.style.bottom = 'auto';
    list.style.maxHeight = Math.max(80, Math.min(340, below)) + 'px';
  } else {
    list.style.bottom = (vh - r.top + 4) + 'px'; list.style.top = 'auto';
    list.style.maxHeight = Math.max(80, Math.min(340, above)) + 'px';
  }
}

function open(sel) {
  close(false);
  if (!enhanceable(sel)) return;
  owner = sel;
  list = build(sel);
  if (!rows.length) { list = null; owner = null; return; }
  document.body.appendChild(list);
  place(sel);
  sel.setAttribute('aria-expanded', 'true');
  var cur = rows.findIndex(function (r) { return r.opt.selected; });
  setActive(cur < 0 ? step(-1, 1) : cur);
  typed = '';
}

function toggle(sel) {
  if (list && owner === sel) close(true); else open(sel);
}

// ---- нажатие мышью: родной список не показываем, открываем свой ----
document.addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  var sel = selectOf(e.target);
  if (sel) {
    e.preventDefault();                      // без этого браузер откроет родной список
    if (Date.now() - lastTouchTap < 700) return;   // тот же тап пальцем уже обработан
    try { sel.focus({ preventScroll: true }); } catch (err) { /* ничего */ }
    toggle(sel);
  } else if (list && !list.contains(e.target)) {
    close(false);
  }
}, true);

document.addEventListener('click', function (e) {
  if (selectOf(e.target)) e.preventDefault();
}, true);

// ---- касание пальцем: родное окно на Android отключаем, тап обрабатываем сами ----
document.addEventListener('touchstart', function (e) {
  var t = e.touches && e.touches[0];
  if (t) { touch.x = t.clientX; touch.y = t.clientY; touch.t = Date.now(); }
  if (list && !list.contains(e.target) && !selectOf(e.target)) close(false);
}, { capture: true, passive: true });

document.addEventListener('touchend', function (e) {
  var sel = selectOf(e.target);
  if (!sel) return;
  var t = e.changedTouches && e.changedTouches[0];
  var moved = t ? Math.abs(t.clientX - touch.x) + Math.abs(t.clientY - touch.y) : 0;
  if (moved > 12 || Date.now() - touch.t > 800) return;      // это прокрутка или долгое нажатие, не тап
  if (e.cancelable) e.preventDefault();                       // не даём браузеру открыть родной список
  lastTouchTap = Date.now();
  try { sel.focus({ preventScroll: true }); } catch (err) { /* ничего */ }
  toggle(sel);
}, { capture: true, passive: false });

// ---- клавиатура ----
document.addEventListener('keydown', function (e) {
  if (list) {
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (k === 'Tab') { close(false); return; }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(step(active, 1)); return; }
    if (k === 'ArrowUp') { e.preventDefault(); setActive(step(active, -1)); return; }
    if (k === 'Home') { e.preventDefault(); setActive(step(-1, 1)); return; }
    if (k === 'End') { e.preventDefault(); setActive(step(rows.length, -1)); return; }
    var typing = k === ' ' && typed && Date.now() - typedAt < 800;   // пробел посреди набираемого слова — часть слова
    if (k === 'Enter' || (k === ' ' && !typing)) { e.preventDefault(); if (rows[active]) choose(rows[active].opt); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var now = Date.now();
      typed = (now - typedAt > 800 ? '' : typed) + k.toLowerCase(); typedAt = now;
      for (var n = 1; n <= rows.length; n++) {
        var i = (active + n) % rows.length;
        if (!rows[i].opt.disabled && rows[i].opt.text.trim().toLowerCase().indexOf(typed) === 0) { setActive(i); break; }
      }
      e.preventDefault();
    }
    return;
  }
  var sel = selectOf(e.target);
  if (sel && (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')))) {
    e.preventDefault();
    open(sel);
  }
}, true);

// ---- закрытие при прокрутке страницы, смене размера, потере поля ----
window.addEventListener('scroll', function (e) {
  if (list && !(e.target && e.target.nodeType === 1 && list.contains(e.target))) close(false);
}, true);
window.addEventListener('resize', function () { close(false); });
window.addEventListener('blur', function () { close(false); });

window.Modul3D = window.Modul3D || {};
window.Modul3D.selectMenu = { close: function () { close(false); }, isOpen: function () { return !!list; } };
})();
