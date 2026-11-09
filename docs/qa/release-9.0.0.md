# Выпуск 9.0.0 — 09.11.2026

Пользователь явно выбрал 9.0.0 и публикацию везде. Источник: `3b445115bb9a5a9462ccdffe15656435d669f68f`, тег v9.0.0, ветка codex/release-9.0.0.
CI: https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42638874623

## Состав

Все исправления последней 8.0.69: чтение до видимого сообщения и снятие старых якорей; отсутствие пересортировки при первом назначении папки и переносов в текущую папку; иконка создания группы; popup автоматических переносов; выбор всех/похожих/отдельных предложений, массовые подтверждения и исключения; центральная ось стрелки.

Изменены только номер runtime/manifest/setup/update metadata и имя release-specific worker-v9_0_0.js. Схема пользовательских данных и разрешения не меняются. Номер больше 8.0.69 и допускает обычное автообновление и загрузку нового пакета Chrome Store.

## Проверки и доставка

Локально PASS: release-integrity (метаданные, worker, Windows upgrade/cleanup/rollback), context check, diff check. CI выполняет точный search-focused 16, семь наборов правил и transfer/storage gate до Windows/macOS/Chrome builds. Полный реестр не запускался.

CI завершён успешно: все четыре job, точный search-focused 16/16 за 465,0 s, семь наборов правил, transfer/storage gate. В rules-settings-ui прошли 28 проверок массовых действий в обоих режимах и три фазы настроек. Полный реестр не запускался.

GitHub Release опубликован: https://github.com/dmikhailovspace-commits/bx24-extension/releases/tag/v9.0.0. Восемь assets повторно скачаны и побайтно сверены с проверенными CI artifacts, GitHub digest и sidecar; все 19 публичных runtime-файлов совпали с frozen source. Локальный Chrome ZIP совпал с CI; dist содержит только EXE/DMG 9.0.0 и их SHA-256. Chrome publishing/verification синхронизированы с CI.

Публичный desktop main/update.json подтверждён tools/publish-update-channel.mjs: 9.0.0. Коммит канала `526fe7e9bd69938bd6cc8fe428b8ffbddf7109c8` меняет только update.json. Обычное автообновление с 8.0.69 теперь доступно.

Chrome Web Store: загружен проверенный ZIP 9.0.0; кабинет подтвердил версию 9.0.0 в таблице пакета и успешную отправку на проверку. Статус — «Ожидает рассмотрения»; checkbox автоматической публикации после проверки включён. Это отправленный на модерацию пакет, а не уже опубликованная в Store версия.

Яндекс Диск: в прежнюю папку загружены EXE, DMG, Chrome ZIP и три sidecar; интерфейс подтвердил «Все файлы загружены», все шесть строк имеют дату 09.11.2026 18:11. Только после этого шесть файлов 8.0.69 отправлены в корзину. Сама существующая папка переименована в v9.0.0, доступ не менялся. Итоговая папка содержит ровно шесть файлов 9.0.0. Путь: «Материалы PENA общие/L`Oreal/0_Внутренние материалы/Материалы для задач/Сортировщик чатов /v9.0.0/».

| Артефакт | SHA-256 |
| --- | --- |
| Windows EXE | b0d61800664cab794a4c65567268afdc6a5a0acc0c6870ade8db270806490b1a |
| macOS Universal DMG | daa751ca8384db984f4c160872398c4ba230e13b67a57d058676549277e815df |
| Chrome ZIP | 34df643f220afed32feb8a214920e642bdce1c49c7a2b61a31faf053cce9b14c |
| Chrome Web Store Materials ZIP | e6bb35024929a90154f6bb8e0b347a7a4aef9425e94ea1da9ae26aab1068ed41 |

Локальные доказательства: tests/artifacts/v9-verification.json, v9-public-verification.json, release-9.0.0/ci.log. Frozen tag не меняется после публикации; документация доставки фиксируется отдельным коммитом.

Живой портал, desktop CEF и физический Mac не проверялись. macOS образ собирается и проверяется нативно на macos-15; GUI-проверка на реальном Mac не заявляется.
