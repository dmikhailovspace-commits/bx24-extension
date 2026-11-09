# Повторная 8.0.69: зависшее чтение

Пользователь явно потребовал тот же номер. Chrome Store: проверка прежней 8.0.69 отменена, опубликована 8.0.68, черновик 8.0.69.

## Основание исправления

- [Bitrix REST im.dialog.read](https://apidocs.bitrix24.com/api-reference/chats/messages/im-dialog-read.html): MESSAGE_ID ограничивает чтение указанным сообщением включительно.
- [Нативный ChatDialog](https://bx24.id-pr.ru/bitrix/js/im/v2/component/dialog/chat/dist/chat-dialog.bundle.js): readVisibleMessages и onMessageIsVisible пропускают message.viewed; AnchorService читает якоря отдельным запросом imV2AnchorRead.
- [Нативная модель](https://bx24.id-pr.ru/bitrix/js/im/v2/model/dist/registry.bundle.js): messages/readMessages читает диапазон до max ID; anchors/removeAnchor удаляет конкретную отметку; ручное unread хранится отдельно.
- [Нативный ChatService](https://bx24.id-pr.ru/bitrix/js/im/v2/provider/service/chat/dist/chat.bundle.js): counter подтверждается сервером, клиентская граница — chats/update.fields.lastId.

Публичные JS прочитаны 09.11.2026, копии в игнорируемом tests/artifacts/unread-repair. Переписка пользователя не читалась. Проверка воспроизводит механизм на синтетических данных, а не доказывает причину в конкретном живом диалоге.

## Контракт

Используется граница нативного viewport активного ChatDialog. Отложенная сверка даёт штатному чтению 750 мс. Подтверждение сервера требуется до локального изменения. Новый counter, смена пользователя/диалога/store и размонтирование блокируют устаревший результат. Новые якоря и сообщения ниже границы сохраняются. Ручная отметка unread не снимается. Нет бесконечного polling, прокрутки и нового DOM observer.

## Проверки до выпуска

read-state: 18 фаз PASS, новая фаза включает 21 сценарий viewport recovery. Локальный search-focused 16/16 прошёл за 361,9 s; после него добавлены защита от повторных запросов для новых сообщений ниже viewport, выбор видимого экземпляра и общий REST timeout для якорей. Финальный read-state повторён; точный search-focused 16 и обе сборки выполняются заново на frozen source в CI. Результаты публикации будут записаны после проверки.

Прежняя 8.0.69: source f46d9f55be124953a4d25566fca9c9ff779cc889, CI 42611581045. Её доказательства сохранены в release-8.0.69.md. Уже установленная здоровая 8.0.69 требует повторной установки: номер не увеличивается. Физический Mac и живой desktop/портал не проверены.
