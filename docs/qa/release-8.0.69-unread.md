# Повторная 8.0.69: зависшее чтение

Пользователь явно потребовал тот же номер. Chrome Store: проверка прежней 8.0.69 отменена, опубликована 8.0.68, черновик 8.0.69.

## Проверенная поставка

- Новый frozen source/tag v8.0.69: `580e5571073f47d086cd0017e45eafa177845dfe`. Старый source сохранён как `archive/v8.0.69-20261109-original`; прежние восемь файлов и release metadata — в tests/artifacts/unread-repair/original-release.
- [CI 42617642531](https://github.com/dmikhailovspace-commits/bx24-extension/actions/runs/42617642531): Verify frozen release source, Windows EXE и Universal DMG — success. Точный search-focused 16/16 за 436,5 s; read-state 19 фаз, включая 22 сценария восстановления и Chromium-проверку скрытого iframe. Правила и перенос настроек PASS. Publish job пропущен для branch dispatch; после проверки assets размещены в существующем релизе вручную.
- Восемь опубликованных assets скачаны заново и совпали с CI, digest и SHA sidecar. Все 19 runtime-файлов по публичным URL тега совпали с frozen source. Chrome ZIP также побайтно равен локальной детерминированной сборке. Локальные dist и chrome-release обновлены проверенными файлами; Store materials и распакованный publishing взяты из CI. ProductVersion Windows — 8.0.69; release-integrity с EXE/DMG PASS.
- [GitHub Release](https://github.com/dmikhailovspace-commits/bx24-extension/releases/tag/v8.0.69) заменён. Автоматический дублирующий запуск 42619337184 после переноса тега отменён: тот же source уже проверен и собран в 42617642531.
- `tools/publish-update-channel.mjs` подтвердил публичный main/update.json. Коммит `1920556cd6579855cd80cb9b41ff21d9b9f660ce` меняет только update.json; новая заметка о восстановлении чтения присутствует в канале.
- Chrome Web Store принял новый ZIP 8.0.69. Подтверждение «Ваш продукт (расширение) отправлен на проверку»; статус «Ожидает рассмотрения», автоматическая публикация включена.
- Яндекс Диск: в той же папке v8.0.69 заменены EXE, DMG, Chrome ZIP и три sidecar. Получено «Все файлы загружены», затем в папке проверены ровно шесть файлов с новой датой 09.11.2026 15:44. Папка и её доступ не пересоздавались и не менялись.

| Артефакт | SHA-256 |
| --- | --- |
| Windows EXE | b3fd0a8697cc672f56cd07039aaf7cf5dd09ed217126dfd01c6f69581afb44c4 |
| macOS Universal DMG | 07b510fce7361983f16a6c1472c808a36711a8dba020c51810ac00aabbe18f84 |
| Chrome ZIP | dbcce7ad3d3e41edb46e8ad376041a7e2d60081c19b2f8606719952c2fc47276 |
| Store materials ZIP | 7982b7593485647518c4a6067f4c31747c72fc92e48bb803be00f2d6c3dee4d5 |

Машинные доказательства: tests/artifacts/unread-verification.json, unread-public-verification.json, unread-repair/final-ci.log, chrome-release/verification.json.

## Основание исправления

- [Bitrix REST im.dialog.read](https://apidocs.bitrix24.com/api-reference/chats/messages/im-dialog-read.html): MESSAGE_ID ограничивает чтение указанным сообщением включительно.
- [Нативный ChatDialog](https://bx24.id-pr.ru/bitrix/js/im/v2/component/dialog/chat/dist/chat-dialog.bundle.js): readVisibleMessages и onMessageIsVisible пропускают message.viewed; AnchorService читает якоря отдельным запросом imV2AnchorRead.
- [Нативная модель](https://bx24.id-pr.ru/bitrix/js/im/v2/model/dist/registry.bundle.js): messages/readMessages читает диапазон до max ID; anchors/removeAnchor удаляет конкретную отметку; ручное unread хранится отдельно.
- [Нативный ChatService](https://bx24.id-pr.ru/bitrix/js/im/v2/provider/service/chat/dist/chat.bundle.js): counter подтверждается сервером, клиентская граница — chats/update.fields.lastId.

Публичные JS прочитаны 09.11.2026, копии в игнорируемом tests/artifacts/unread-repair. Переписка пользователя не читалась. Проверка воспроизводит механизм на синтетических данных, а не доказывает причину в конкретном живом диалоге.

## Контракт

Используется граница нативного viewport активного ChatDialog. Отложенная сверка даёт штатному чтению 750 мс. Подтверждение сервера требуется до локального изменения. Новый counter, смена пользователя/диалога/store и размонтирование блокируют устаревший результат. Новые якоря и сообщения ниже границы сохраняются. Ручная отметка unread не снимается. Нет бесконечного polling, прокрутки и нового DOM observer.

## Проверки до выпуска

read-state: 19 фаз PASS, новая фаза включает 22 сценария viewport recovery. Локальный search-focused 16/16 прошёл за 361,9 s; после него добавлены защита от повторных запросов для новых сообщений ниже viewport, выбор видимого экземпляра и общий REST timeout для якорей. Финальный read-state повторён; точный search-focused 16 и обе сборки выполняются заново на frozen source в CI. Результаты публикации будут записаны после проверки.

Прежняя 8.0.69: source f46d9f55be124953a4d25566fca9c9ff779cc889, CI 42611581045. Её доказательства сохранены в release-8.0.69.md. Уже установленная здоровая 8.0.69 требует повторной установки: номер не увеличивается. Физический Mac и живой desktop/портал не проверены.

Дополнительно в Chromium воспроизведено сохранение document.hasFocus() у скрытого iframe. Проверка всей цепочки родительских frames блокирует display:none, прозрачное и расположенное вне экрана окно. CI 42617213141 отменён до сборки ради этой защиты; финальный source проходит новый CI.
