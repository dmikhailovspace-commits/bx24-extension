# 8.0.69 — массовая пересортировка, 09.11.2026

Источник: `11a8356e6a63e8903524f2fcd8abca4836401532`, ветка `codex/bulk-review-8.0.69`.
CI: https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42623638821

## Изменения

- Popup перед включением автоматических переносов текущих и будущих предложений. Отмена/Escape оставляют настройку выключенной; внешний конфиг повторно сверяется после подтверждения.
- Checkbox каждого предложения, общий частичный/полный выбор, массовое подтверждение и добавление в исключения без движения.
- «Выбрать похожие» добавляет предложения с тем же режимом и ID целевой папки, независимо от совпадающих названий разных папок.
- Выделение связано с подписью текущего предложения. Проверки фактов, правил, текущей папки, locks, доступности и аккаунта повторяются перед действием. Каждые восемь операций очередь отдаёт управление интерфейсу и обновляет прогресс.
- Журнал сохраняется до движения; отказ записи размещения возвращает старое состояние. Стрелка исключений использует фиксированный SVG с центральной осью.

## Проверки

Локально PASS: rules-settings-ui (3 фазы и 28 новых browser checks в обоих режимах), rules-preview-races (11 фаз), rules-resorting (22 сценария), release-integrity, context check, syntax/diff check.
Дополнительно проверены карточки и массовая панель при ширине 360px, сделаны снимки обоих режимов. Нет горизонтального переполнения. Реальный центр SVG стабилен при анимации и быстром обратном переключении.

CI 42623638821: Verify frozen release source, Windows EXE и Universal DMG — success; Publish пропущен для branch dispatch. Точный search-focused **16/16 за 441,0 s**, семь наборов правил (включая 28 bulk UI checks) и проверки transfer/storage — PASS. Полный реестр не запускался.

macOS собран на macos-15: hdiutil verify, mounted payload, plutil, executable modes, обе архитектуры Mach-O и LF проверены workflow. Windows ProductVersion — 8.0.69. Локальные release-integrity и context check PASS после установки проверенных артефактов в dist.

## Поставка

Тег v8.0.69 перенесён на проверенный source с force-with-lease прежнего SHA; восемь GitHub assets заменены. Дублирующий tag CI 42625680676 отменён, чтобы не перезаписать уже проверенные файлы. Все восемь assets повторно скачаны с GitHub и сверены с CI/digest/sidecar. Все 19 публичных runtime-файлов по URL тега совпали с frozen source. Локальный Chrome ZIP побайтово совпал с CI; пакеты/материалы/verification синхронизированы с CI.

| Файл | SHA-256 |
| --- | --- |
| Windows EXE | `ed651e30fa2e2b5dd5917039b0cc9e1bd7cb0204dd75ecf490425abd75612ff2` |
| macOS Universal DMG | `84183e7d125be9b236dc590e0db15a30820e9921b4f1e3791f6ab14592dfd6dc` |
| Chrome ZIP | `f3b699baaeef3598068123bee427e5987a2cac99a63d5ec255fd0c9191b98c3a` |
| Store materials | `7982b7593485647518c4a6067f4c31747c72fc92e48bb803be00f2d6c3dee4d5` |

Шесть проверенных файлов EXE/DMG/Chrome ZIP + sidecar заменены в той же папке Яндекс Диска v8.0.69. Подтверждены «Все файлы загружены» и шесть строк с датами 09.11.2026 16:28–16:29. Папка и права не менялись.

main/update.json обновлён коммитом `82cb268cb1d6e7dbf3880383ee306c8142712a0e`; API подтвердил, что изменён только update.json. Первые два public readback показали прежнее содержимое из CDN (Cache-Control max-age=300; Source-Age 266). Повторный запуск штатного tools/publish-update-channel.mjs завершился **Public desktop update channel verified: 8.0.69**: проверен именно обычный публичный URL main/update.json без cache-busting параметров.

Доказательства: `tests/artifacts/bulk-verification.json`, `bulk-public-verification.json`, `bulk-review-ui.json`, `bulk-review/ci.log`; скачанные пакеты — `tests/artifacts/bulk-ci/`, `bulk-release/`, `bulk-published/`.

## История и ограничения

Прежняя поставка `580e5571073f47d086cd0017e45eafa177845dfe` сохранена тегом `archive/v8.0.69-20261109-unread`; восемь assets и release metadata скачаны в `tests/artifacts/bulk-review/previous-release/`.

Chrome Web Store уже показывает 8.0.69 в разделе «Опубликовано». Пользователь повторно требует тот же номер; новая версия Store требует отдельного решения о большем номере. Обновлённый ZIP не означает обновление Store.

Живой Bitrix24, desktop CEF и физический Mac не проверялись. Повторная сборка 8.0.69 не повышает установленный номер; уже установленной 8.0.69 нужна переустановка.
