#!/bin/sh
# Полная проверка перед выдачей сборки: синтаксис + геометрия + запуск приложения.
cd "$(dirname "$0")/.." || exit 1
for f in src/*.js tools/*.js; do node --check "$f" || exit 1; done
echo "СИНТАКСИС: ок"
node tools/geometry.js || exit 1
node tools/smoke.js    || exit 1
node tools/viewer.js   || exit 1
