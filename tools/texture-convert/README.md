# Конвертер «лист декора → растровая плитка»

Dev-набор, приложением не используется. `bake_tile.py` берёт изображение ЦЕЛОГО листа
производителя (Egger: страница декора `egger.com/de/moebel-innenausbau/dekore/<код>`, «Plattenansicht»,
`cdn.egger.com/img/pim/.../original.png`; для очень тяжёлых PNG — `original.jpg?width=3685&srcext=png`),
режет квадрат 1300×1300 мм, уменьшает и пишет `src/decorTiles.js` (base64 JPEG). Во вьювере
(`tileTexture`/`applyTileFlip` в `src/viewer.js`) клетки плитки зеркалятся, поэтому рисунок не
повторяется «через период», а стыки непрерывны. Волокно идёт вдоль оси x текстуры — правила
«Направление текстуры» работают как у обычной древесной текстуры.

Листы лежат вне репозитория: `D:\#Project claude\Model3D\texture-sources\<код>_Egger\board_orig.png`
(F206 — `egger_full.png`). Запуск (нужны Python 3 и pillow, numpy):
`python bake_tile.py "D:/#Project claude/Model3D/texture-sources" ../../src/decorTiles.js`.
Новый декор — строка в списке ENTRIES: папка, высота кропа, размер, качество, режим
(`hash` — лист периодичен по ширине; `mirror` — не периодичен), коды позиций каталога.
Однотонные декоры (U702, U250, U399 и т.п.) текстуры не имеют — их цвет задан в `decorLookBase` (viewer.js).
