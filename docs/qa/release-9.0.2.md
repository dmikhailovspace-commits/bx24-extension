# Выпуск 9.0.2 — 10.11.2026

- [Релиз GitHub](https://github.com/dmikhailovspace-commits/bx24-extension/releases/tag/v9.0.2), source 8d53774276c9d91affbb68d9b7ce3ba16c49f130.
- [CI 42805163707](https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42805163707) — все четыре задания успешны. Точный search-focused 16/16 за 429,301 с, локально 16/16 за 346,238 с. Дополнительные проверки переноса, правил и времени, Chrome package и контекст прошли. Полный реестр не запускался.
- Первая попытка 42804379835 отменена до сборки/публикации из-за расхождения текста карточки Chrome с release_notes. Неопубликованный тег после остановки получил окончательный коммит. После публикации тег не менялся.
- Меню проверено в чатах и задачах Chromium: узкое окно, открытие у правого нижнего угла, настоящее колесо, открытие вложенного действия, изменение размера окна. Иконка обновления общая для списка, времени и проверки версии.
- Восемь файлов GitHub Release сверены с CI, digest, размером и sidecar. 19 публичных файлов runtime совпали с тегом. Windows ProductVersion — 9.0.2. Universal DMG прошёл нативные проверки CI (hdiutil, plist, Intel/Apple Silicon, executable и LF). Release integrity с обоими установщиками и обновлённый контекст прошли. Физический Mac и живой портал Bitrix не проверялись.
- Только main/update.json изменён коммитом eae3f6e843948a43afe83cab06e6648113837e82. Штатный publish-update-channel подтвердил 9.0.2 по публичному адресу повторно после CI.
- Chrome Web Store: проверенный Chrome ZIP загружен, кабинет подтвердил версию 9.0.2 и успешную отправку на модерацию. Автоматическая публикация после проверки включена. Статус — «Ожидает рассмотрения». Скриншот: tests/artifacts/release-9.0.2/chrome-submitted.jpg.
- Яндекс Диск: все шесть проверенных файлов загружены 10.11.2026 в 19:34. После подтверждения «Все файлы загружены» шесть файлов 9.0.1 отправлены в корзину. Та же папка переименована в v9.0.2; в ней ровно шесть файлов, доступ не менялся. Скриншот: tests/artifacts/release-9.0.2/yandex-release.jpg.

| Файл | SHA-256 |
| --- | --- |
| Windows EXE | 682a3d0122d3e4b41e35d95a81a6a14337f18baaccf0dcc94fe4c0aa941e3b22 |
| macOS Universal DMG | 6faa64e74e0bb04d00c6a7ee34f2c69d732d580eec8b0be2e95af85194a1d3cf |
| Chrome ZIP | 4cbcc545cbe0c0d8baffad9bd1199e3753eca8ff9a3bbeb4ae7b6efac3bc3534 |
| Chrome Store Materials | ca2f54f5ea87ce5d6287689730f6f1b8d1fbc8ec060f345b4dd9d39b22d9b594 |
