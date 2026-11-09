# Выпуск 9.0.1 — 09.11.2026

Источник runtime, установщиков и маркетинговых материалов: `fe202f0fedf3e168f813873df1f648f0b8dae38f`, тег v9.0.1. Финальный source/Windows CI: https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42672456319. Нативная macOS recovery: https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42674480041.

Первая попытка 42668337738 на 6d8fae1 отменена до сборок/публикации после дополнительного требования пользователя о карусели. Опубликованного релиза 9.0.1 на момент изменения тега не было.

## Изменения

У полного журнала времени отдельный auditedAt со сроком 120 секунд; точечные изменения его не продлевают. Просроченное полное чтение не возвращает старое подтверждение при сбое первой страницы. Общий журнал повторяется общим запросом без веера из тысяч точечных запросов. Незавершённое чтение получает до двух автоматических повторов с задержкой 1,5/3 секунды. Повторы проверяют владельца попытки, диапазон, аккаунт, видимость и сеть. Смена периода отсекает запоздалые результаты. Во время восстановления показывается загрузка; постоянная ошибка остаётся видимой с ограниченным повтором, не маскируется под успешный итог. Достоверно недоступные задачи исключаются прежним механизмом.

Удалён пункт оригинального меню Bitrix24 и дубли прочтения/отложенного. Мультивыбор получает штатные pin/unpin/hide с последовательной перепроверкой callback каждого диалога. Смешанное выделение не меняет обратно уже достигнутое состояние. Прав доступа и native store реализация не подменяет; пропуски учитываются в итоге операции.

Карусель Store: пять разных иллюстраций функций, 1280×800 RGB PNG, встроенный image_gen. Стиль основан на типографике и композиции dmitrymikhailov.com; фон не копировался. Исходники/промпты/хеши — chrome/marketing/carousel, порядок публикации — docs/chrome/CAROUSEL.md. Старые два повторяющихся gallery promo удалены. Два реальных кадра runtime на синтетическом портале сохранены в архиве для проверки, отдельно от маркетинговых иллюстраций.

## Проверки

Локально пройдены time-refresh (53 фазы), time-live-cache, time-log-empty, time-global-elapsed, time-startup-cycle, time-snapshot-performance и браузерный time-date-navigation (включая восстановление без кнопки). Native-search-state проверяет mixed bulk pin/unpin/hide в чатах и задачах; native-preservation — отсутствие старого пункта. Release-integrity, Chrome package и context/diff check прошли.

Релизный CI выполняет точный search-focused 16, прежние семь наборов правил, transfer/storage и семь перечисленных наборов времени, затем собирает Windows EXE, macOS Universal DMG и Chrome ZIP. Дополнительная проверка карусели сверяет размеры, уникальность пяти файлов, хеши и попадание в publishing. Полный реестр не запускается.

## Доставка

CI 42669956079 attempt 1: Verify frozen release source успешно за 11m57s; search-focused 16/16 за 439631 ms, все дополнительные gates, Chrome package и пять изображений PASS. Затем GitHub завершил workflow внутренней ошибкой инфраструктуры до старта установщиков (correlation 74775202-8ce7-4b96-aa8b-2b5d60bf7cab). Повтор только failed jobs недоступен; attempt 2 остановлен такой же ошибкой до запуска машин (01faf02f-b497-4039-bdfd-227287dc1543). Новый workflow_dispatch на том же immutable tag: https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42672456319. Код/тег после успешной проверки не менялись.

Chrome Store: пять слайдов последовательно загружены вместо четырёх прежних, сохранение подтверждено. ZIP из успешного verify job побайтно совпал с frozen source; SHA-256 `23eb9aab4f23e1333fbef85376fea46a09b73514a12e84e8c4843fef2468e082`. Кабинет подтвердил draft 9.0.1 и успешную отправку на проверку с включённой автопубликацией. Статус — «Ожидает рассмотрения», опубликованной 9.0.1 в Store пока не заявляем. Локальные screenshots: tests/artifacts/release-9.0.1/chrome-carousel-saved.jpg и chrome-submitted.jpg.

Финальный source/Windows CI 42672456319: Verify source и Windows EXE success, точный search-focused 16/16 за 388471 ms; дополнительные gates времени/правил/переноса и Chrome verification PASS. Сам workflow завершён infrastructure failure до выделения macOS runner. Повторные полные прогоны больше не выполнялись.

Нативная macOS recovery: https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42674480041 — success на macos-15-intel. Изолированная workflow-ветка codex/recover-9.0.1-macos, workflow commit `85ac3206598db6c31e8f3dc644cdd77cd85d6f43`, явно checkout того же frozen source `fe202f0fedf3e168f813873df1f648f0b8dae38f`. Перед сборкой проверены завершённые source/Windows jobs, неизменность тега, профиль16 и все19 hashes из CI Chrome artifact. Использованы прежний builder и полные native проверки: hdiutil, plist, Intel+arm64 обоих launcher, LF и executable modes. Основная релизная ветка и frozen tag не менялись ради восстановления.

GitHub Release опубликован: https://github.com/dmikhailovspace-commits/bx24-extension/releases/tag/v9.0.1. Все8assets повторно скачаны, побайтно сверены с CI и GitHub digests/sidecars; все19публичных runtime-файлов совпали с frozen source. Chrome ZIP равен отправленному в Store. dist содержит только актуальные EXE/DMG и SHA; chrome-release синхронизирован с финальным CI. Локальная резервная Windows-сборка не опубликована.

Публичный desktop main/update.json подтверждён tools/publish-update-channel.mjs как9.0.1. Коммит `83f19739d4678b76052b76584d6726e85ddaf6a1` меняет только update.json.

| Артефакт | SHA-256 |
| --- | --- |
| Windows EXE | 5ae98522a2d2e9cf82ea1a84b3ec6d17d2a254fd5e8f1ea5afb410be5bda68b4 |
| macOS Universal DMG | 1e8c9dbcb29cf9efbe4273360f0a60d4cef96b471bb2a16ece5475edd89b5939 |
| Chrome ZIP | 23eb9aab4f23e1333fbef85376fea46a09b73514a12e84e8c4843fef2468e082 |
| Store Materials ZIP | 270a7a408b7a8827d7258ef328adac197d7a0fcd4734fe9be3488f5e4ba94ba1 |

Локальные доказательства: tests/artifacts/v901-verification.json, v901-public-verification.json, release-9.0.1/ci-final.log и macos-recovery.log.

Яндекс Диск: все шесть новых файлов загружены, интерфейс подтвердил «Все файлы загружены» и новые строки от 09.11.2026 21:32. После этого шесть старых файлов 9.0.0 отправлены в корзину. Существующая папка переименована в v9.0.1; в родителе осталась одна папка версии, внутри ровно шесть файлов. Общий доступ сохранён, папка не пересоздавалась. Путь: «Материалы PENA общие/L`Oreal/0_Внутренние материалы/Материалы для задач/Сортировщик чатов /v9.0.1/». Скриншот результата: tests/artifacts/release-9.0.1/yandex-release.jpg. Финальный статус Store — ожидает рассмотрения, screenshot chrome-status.jpg.

Живой портал, desktop CEF и физический Mac не проверялись. Нативная сборка/проверка DMG на macos-15 не означает GUI-проверку на реальном Mac.
