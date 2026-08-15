// errorBanner.js
// ============================================================================
// Диагностический перехватчик ошибок. Грузится ПЕРВЫМ, до всех остальных
// скриптов, и показывает любую необработанную ошибку прямо на странице
// красным баннером сверху — вместо того чтобы страница молча оставалась
// пустой без единого следа причины в интерфейсе.
// ============================================================================
(function () {
  function showError(msg) {
    var el = document.getElementById('__basisErrorBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = '__basisErrorBanner';
      el.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:999999;background:#c0392b;' +
        'color:#fff;padding:10px 16px;font:12px/1.5 monospace;white-space:pre-wrap;' +
        'max-height:40vh;overflow:auto;';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent += (el.textContent ? '\n\n' : '') + msg;
  }

  window.addEventListener('error', function (e) {
    showError('JS-ошибка: ' + e.message + '\n  файл: ' + (e.filename || '?') + ':' + (e.lineno || '?') + ':' + (e.colno || '?'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason && e.reason.message ? e.reason.message : e.reason;
    showError('Необработанный отказ промиса: ' + reason);
  });
})();
