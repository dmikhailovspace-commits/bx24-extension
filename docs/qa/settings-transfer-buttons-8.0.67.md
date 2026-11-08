# Кнопки переноса без рывков — 8.0.67

Источник runtime: bec6490aaf1771dea73c70667682448f4435f03a. Публикация разрешена пользователем после проверки. Номер8.0.67 сохранён.

## Исправления

- Удалён1px translateY при active у всех кнопок переноса и входа в него; hover и цвет нажатия сохранены.
- Pending clipboard защищён отдельным флагом без disabled. Успех не дублируется в footer; повторное нажатие не возвращает мгновенно старый label.
- Проверенный по состоянию cache возвращается до busy/progress: готовые Build/Download без пересборки, изменения высоты или повторного fade. Первый Download показывает loader только после120ms; Build сохраняет прогресс. Отмена и защита от изменившихся данных сохранены.

## Проверки

Старый runtime воспроизводил падение на реальном mouseDown/hold120ms: Close button.y сдвигался. Новый runtime проходит проверки каждого видимого button по x/y/width/height с допуском менее0,5px. Click после release в этой проверке подавляется, чтобы не запускать импорт/отмену; обычные действия проверяются отдельными сценариями.

Desktop shared runtime в Chromium и ChromeMV3 PASS. Кеш проверяется через MutationObserver/RAF, отсутствие progress/height/opacity animation и счётчик snapshot. Delayed clipboard + double click дают одну запись, без disabled/opacity flash. Дополнительно сохранены проверки scope, устаревшего подтверждения, отмены, narrowviewport и reducedmotion. Storage8 случаев PASS. Release notes после синхронизации content.js/update.json PASS. Первые попытки Chrome во время записи changelog выявили рассинхрон, после синхронизации финальный прогон PASS.

Локальный performance на синтетических данных:4000/10000 диалогов — открытие9,5/10ms, сборка25,5/50,2ms, Copy0,3ms, ноль новых snapshot при Copy/повторном Download. Это измерения стенда, не гарантии для любого устройства. Источник и подробные traces сохраняются с артефактами.

CI: https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42493723976 — итог дополняется после завершения. Точный профиль16search-focused, дополнительные transfer/storage/model/performance, сборки ChromeZIP/WindowsEXE/macOSUniversalDMG из одного commit.

Живой авторизованный Bitrix, нативный CEF и физический Mac не проверялись. macOS собирается и проверяется на GitHubmacOS runner. При замене desktop-релиза с тем же номером старую8.0.67 потребуется обновить установщиком вручную; канал версии проверяется отдельно.

### Итог публикации

- Source **bec6490aaf1771dea73c70667682448f4435f03a**. CI **42493723976** успешен: точный search-focused **16/16 за377,963s**, отдельные transfer UI/storage/model/performance, ChromeZIP, WindowsEXE, macOSUniversalDMG.19 runtime-хешей сверены с source/CI,24 файла unpacked проверены; ChromeZIP воспроизводится побайтово. Release-integrity с обязательными EXE/DMG PASS.
- GitHub Release v8.0.67 обновлён из этих CI-артефактов; tag/source и8 asset digest/размеров сверены. Прежние8 файлов и metadata заранее сохранены и проверены в release-staging/8.0.67-transfer-buttons/previous-public. Дублирующий tag-workflow42494541171 отменён до упаковки, чтобы не заменять проверенные файлы повторной сборкой.
- Канал обоих desktop-updater опубликован штатным publish-update-channel, публичный URL подтверждён. Коммит **aa2bc899c4af332e3a59982cf104e19cb78996cc** меняет только main/update.json.
- **Chrome Web Store:8.0.67 отправлена на проверку**, revision00007, статус «Ожидает рассмотрения», автопубликация после одобрения включена. Публичная версия магазина пока8.0.66. Это отправка на модерацию, не утверждение Google.
- На Диске в прежней папкеv8.0.67 заменены6 файлов; интерфейс подтвердил «Все файлы загружены». Папка не пересоздавалась, новые дубли не оставлены.
- Комплект **E:/Codex/Previews/BX24-settings-8.0.67-release**:3 сборки, sidecars, unpacked, README, checks/verification.json. SHA-256 Chrome **3942fa3f6ff3de850c11e7978a24906f9f5ee2182592c5502a883e36b6f5365e**, Windows **b1d2185e64716c32efea56fa247c9d83ae038cf5f7b6ff8c09edb54a2bb52467**, macOS **f626e3972b24fdf7e4156babee906d51a8cf37d84eec9c1936bfe10bcf0ccec9**.
- Автоматической установки на устройство не выполнялось. Для уже установленной прежней desktop8.0.67 нужен новый установщик вручную; сохранённый номер не обнаруживается сравнением версий. Живой Bitrix/CEF/физическийMac не проверялись.
