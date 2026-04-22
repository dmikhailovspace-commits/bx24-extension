# Сортировщик чатов BX24 — для PENA Agency

Расширение для Битрикс24 (настольное приложение): добавляет **панель фильтров** над списком чатов.

---

## Возможности

- Быстрые фильтры: непрочитанные, «посмотреть позже», с вложениями
- Поиск по названию чата и последнему сообщению
- Фильтрация по типу (категории): диалоги, группы, телефон и др.
- Управление категориями — скрыть/показать встроенные, добавить собственные
- Теги-метки — фильтрация по ключевым словам
- **Пресеты фильтров** — сохранение и мгновенное переключение наборов фильтров
- Прозрачность панели, ресайз по боковым граням, перетаскивание
- Горячая клавиша: `Ctrl + Alt + F` (macOS: `⌘ + ⌥ + F`)

---

## Установка

### Windows
Запустите `installers/windows/install.bat`.

Скрипт установит расширение, создаст ярлык «Bitrix24 + Chat Filter» на рабочем столе и в меню Пуск.

### macOS
Откройте терминал и запустите:
```
bash installers/macos/install.command
```
Или дважды кликните файл в Finder → **Открыть** (при первом запуске).

### Браузер (Chrome, Edge, Яндекс, Brave)
Откройте `dist/Install_Browser.html` и следуйте инструкции.

---

## Структура проекта

```
extension/          — файлы Chrome-расширения (manifest.json, injected.js и др.)
installers/
  windows/          — install.bat, install.ps1, updater.ps1
  macos/            — install.command, install_bundle.command
  build/            — setup.iss (Inno Setup), build.bat
dist/               — готовые файлы для передачи пользователям
guide.html          — документация
update.json         — манифест текущей версии
```

---

## Выпуск обновления

1. Обновите код в `extension/`
2. Поднимите версию в `extension/manifest.json` и `update.json`
3. Обновите версию в установщиках (`installers/build/setup.iss`, `install.ps1`, `install.command`)
4. Закоммитьте и запушьте:
   ```
   git add .
   git commit -m "feat: vX.Y.Z — описание"
   git push origin main
   ```
5. Создайте [GitHub Release](https://github.com/dmikhailovspace-commits/bx24-extension/releases) и прикрепите готовые файлы

---

## Приватность

Расширение работает локально. Никакие данные чатов не передаются.

---

> Сортировщик чатов BX24 для PENA Agency · [GitHub](https://github.com/dmikhailovspace-commits/bx24-extension)
