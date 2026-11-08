# Перенос: убрать дубли и добавить плавное раскрытие

Прямой запрос пользователя: только buttonCopyfeedback, удалить intro и border междусекциями, код появляется плавно. Версия67, previewбезпубликации.

1. Убрать дублирующие successсообщения и абзац; сохранить header/footer и стандартные отступы.
2. Анимировать фактическую height панели200ms +fadecode180ms, respectreducedmotion, отменять наresize/close и переиспользовать текущуюheight приповторе.
3. QAбезfooterдублей/preservedimportstatus, intermediateRAFheight, autoheightпослеанимации, reducedmotion, rapidclose/reopen, smallviewport; perf и точныйsearch-focused16.
4. Пакеты изодногоsource, hashes, preview5; публичныеканалы неизменны.
