# Конвертер «полный лист декора → процедурная текстура»

Dev-набор, приложением не используется. Из изображения ЦЕЛОГО листа производителя
(на странице декора на сайте Egger — «Plattenansicht») получает векторные жилы и карту
«облаков» для `src/decorData.js`. Рисует их `src/proceduralDecor.js` под размер детали.

Порядок (из папки с исходниками, нужны Python 3, numpy, scipy, pillow, scikit-image, skan, opencv-python-headless):
1. положить лёгшее горизонтально изображение листа как `board.png` (главные потоки по горизонтали);
2. `python ex3.py 88 95 60` — выделение жилок (ridge-фильтр) → `mask3.npy`, `board3200.png`;
3. `python trace3.py 12` — скелет → полилинии с шириной и яркостью → `veins3.json`;
4. `python gen4.py <путь>/src/decorData.js` — запись данных. Перед запуском поправить в `gen4.py`
   код материала, размер листа `tileMM`, период повтора `period` (определить по автокорреляции листа).

Исходники F206 ST9 лежат вне репозитория: `D:\#Project claude\Model3D\texture-sources\F206_ST9_Egger`
(официальный лист: https://www.egger.com/de/moebel-innenausbau/dekore/F206_9, период повтора 1310.75 мм).
