# Сортировщик чатов BX24 — для PENA Agency

Расширение для Битрикс24 (настольное приложение): добавляет **панель фильтров** над списком чатов.

---

## Возможности

- Быстрые фильтры: непрочитанные, «посмотреть позже»
- Поиск по названию чата и последнему сообщению
- Фильтрация по типу: диалоги, группы, телефон и др.
- Теги-метки — фильтрация по ключевым словам
- Прозрачность панели и ресайз по боковым граням
- Горячая клавиша: `Ctrl + Alt + F` (macOS: `⌘ + ⌥ + F`)
- Автообновление — ежедневная фоновая проверка новых версий

---

## Установка

### Windows
Запустите `dist/PENA_Agency_Setup_v5.0.0.exe` — мастер установки сделает всё сам.

Альтернатива (без .exe): запустите `installers/windows/install.bat`.

### macOS
Дважды кликните `dist/Install_macOS.command` в Finder.
Скрипт скачает последнюю версию с GitHub и установит её.

### Браузер (Chrome, Edge, Яндекс, Brave)
Откройте `dist/Install_Browser.html` и следуйте инструкции.

---

## Передача пользователям

Папку `dist/` можно передавать отдельно — она содержит все файлы для установки:
- `PENA_Agency_Setup_v5.0.0.exe` — установщик Windows
- `Install_macOS.command` — установщик macOS (скачивает с GitHub)
- `Install_Browser.html` — инструкция для браузера

---

## Структура проекта

```
extension/          — файлы Chrome-расширения (manifest.json, injected.js и др.)
installers/
  windows/          — исходники Windows-установщика (для разработчиков)
  macos/            — исходники macOS-установщика (для разработчиков)
  build/            — сборка .exe (Inno Setup)
    setup.iss       — скрипт Inno Setup
    build.bat       — компиляция в .exe
dist/               — готовые файлы для передачи пользователям
guide.html          — полная документация
update.json         — манифест версий для автообновления
```

---

## Выпуск обновления

1. Обновите код в `extension/`
2. Поднимите версию в `extension/manifest.json` и `update.json`
3. Пересоберите `.exe`: `installers/build/build.bat`
4. Закоммитьте и запушьте:
   ```
   git add .
   git commit -m "feat: vX.Y.Z — описание"
   git push origin main
   ```
5. Создайте [GitHub Release](https://github.com/dmikhailovspace-commits/bx24-extension/releases) и прикрепите `.exe`

Пользователи Windows получат уведомление автоматически (Task Scheduler + OTA).

---

## Приватность

Расширение работает локально. Никакие данные чатов не передаются.

---

> Сортировщик чатов BX24 для PENA Agency · [GitHub](https://github.com/dmikhailovspace-commits/bx24-extension)
