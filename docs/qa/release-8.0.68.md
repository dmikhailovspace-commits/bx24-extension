# Выпуск 8.0.68 — 09.11.2026

Последняя локальная разработка правил и пересортировки из e36bbfb выпущена с новым номером по прямому запросу пользователя. Старые публичные артефакты 8.0.67 не заменялись.

Источник: `5286f39250af9f5c24b124bab27f1ef7e0689e27`. [Релиз](https://github.com/dmikhailovspace-commits/bx24-extension/releases/tag/v8.0.68). [Успешный CI](https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42601784692).

## Проверки

- Локально: точный search-focused 16/16 за 365,3 s и семь целевых наборов правил.
- CI: точный search-focused 16/16 за 436,9 s; transfer-storage, settings-transfer, transfer-model-async, transfer-performance; семь наборов правил; context и Chrome verifier.
- Первая локальная попытка обнаружила устаревшее описание обновления в content.js. Исправлен только встроенный текст, окончательный профиль повторён полностью; исходный failed report сохранён отдельно.
- Все восемь assets: размеры, GitHub digest, sidecars. Все 19 runtime-хешей CI соответствуют неизменяемому тегу. Chrome ZIP совпадает локально/CI/Release.
- Windows ProductVersion 8.0.68. Release-integrity с обязательными EXE/DMG прошёл. macOS: hdiutil verify, Universal launchers, layout, права и LF проверены на macos-15.
- Полный реестр не запускался. Живой Bitrix, CEF и физический Mac не проверялись.

## Публикация

- GitHub Release опубликован. Канал f781743697cda6b67c289053e75f2292e0d25278 изменил только main/update.json; штатный скрипт повторно подтвердил публичную 8.0.68.
- Chrome Web Store: CI ZIP загружен, номер 8.0.68 проверен, заявка отправлена с отмеченной автоматической публикацией. Кабинет показал «Ожидает рассмотрения» и «Продукт отправлен на проверку». На момент отправки публично доступна 8.0.67.
- Диск: шесть файлов загружены в существующую v8.0.67; подтверждение «Все файлы загружены», затем старые шесть файлов в корзину и переименование того же объекта в v8.0.68. Проверены ровно шесть новых файлов.

## SHA-256

- `BX24_Chat_Sorter_Chrome_v8.0.68.zip` — `17efc484777bbf2535e01677ba1f6717e8ac4e566c337117879e613d5acaf406` (1052363 байт)
- `BX24_Chat_Sorter_macOS_Universal_v8.0.68.dmg` — `d19e460ea43a3c55cd1370ef69bf8e358a4301f642b90a1c207333f0bd930653` (4343731 байт)
- `BX24_Chat_Sorter_Windows_v8.0.68.exe` — `fd2432c19313f096aaded6230ce48f38c6dc76da902972c8a1a07512a6572c22` (2820953 байт)
- `Chrome_Web_Store_Materials_v8.0.68.zip` — `8e229a66809d8b64f7b8217bb6c6690ec3d1f3b899e9f7ec8112d1640749fe72` (3105550 байт)
