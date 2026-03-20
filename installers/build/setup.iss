; ================================================================
; PENA Agency Extension — Inno Setup 6 Script
;
; Что делает:
;   - Упаковывает расширение в полноценный .exe установщик
;   - Создаёт ярлык Bitrix24 (меню Пуск + опционально рабочий стол)
;   - Регистрирует ежедневное автообновление (Планировщик задач)
;   - Создаёт деинсталлятор (Панель управления → Приложения)
;
; Как скомпилировать:
;   Запустите build_setup.bat  (или дважды щёлкните по нему)
;
; Результат: ..\..\dist\PENA_Agency_Setup_v5.0.0.exe
; ================================================================

#define AppName      "BX24 Chat Sorter"
#define AppVersion   "5.0.0"
#define AppPublisher "PENA Agency"
#define AppURL       "https://github.com/dmikhailovspace-commits/bx24-extension"
#define TaskName     "PENAAgencyUpdater"

[Setup]
; ВАЖНО: не менять AppId между версиями — иначе сломается обновление
AppId={{3F8E2A1C-B5D4-4E7F-A9C2-1D6B8F3E5A20}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} v{#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
; Устанавливаем в %LOCALAPPDATA% — права администратора НЕ требуются
DefaultDirName={localappdata}\PENA Agency\Extension
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
WizardStyle=modern
WizardSizePercent=100
ShowLanguageDialog=no
OutputDir=..\..\dist
OutputBaseFilename=PENA_Agency_Setup_v{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
UninstallDisplayName={#AppName} v{#AppVersion}
UninstallDisplayIcon={app}\icons\icon128.png
CreateUninstallRegKey=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
russian.WelcomeLabel1=Добро пожаловать в мастер установки
russian.WelcomeLabel2=Фильтр и сортировщик чатов Bitrix24 для PENA Agency.%n%nБудут созданы:%n  • Ярлык «Bitrix24 (PENA Agency)» в меню Пуск%n  • Задача автообновления (ежедневная проверка новых версий)%n%nНажмите «Далее» для продолжения.
english.WelcomeLabel1=Welcome to {#AppName} Setup
english.WelcomeLabel2=This extension adds keyword filtering and chat sorting for Bitrix24.%n%nThe installer will create:%n  • "Bitrix24 (PENA Agency)" shortcut in Start Menu%n  • Auto-update task (daily version check)%n%nClick Next to continue.
russian.FinishedHeadingLabel=Установка {#AppName} завершена
russian.FinishedLabel=Расширение установлено. Запускайте Bitrix24 через ярлык «Bitrix24 (PENA Agency)».
english.FinishedHeadingLabel={#AppName} installation complete
english.FinishedLabel=Extension installed. Launch Bitrix24 via the "Bitrix24 (PENA Agency)" shortcut.

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; Flags: unchecked

[Files]
; Файлы расширения Chrome
Source: "..\..\extension\background.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\extension\content.js";    DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\extension\injected.js";   DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\extension\manifest.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\extension\popup.html";    DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\extension\popup.js";      DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\extension\icons\*";       DestDir: "{app}\icons"; Flags: ignoreversion
; Скрипт автообновления
Source: "..\windows\updater.ps1";                   DestDir: "{app}"; Flags: ignoreversion

[Run]
; Шаг 1: Ищет Bitrix24, создаёт ярлыки, регистрирует Task Scheduler
; {code:GetDesktopFlag} добавляет -Desktop если пользователь отметил чекбокс
Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\updater.ps1"" -Setup{code:GetDesktopFlag}"; WorkingDir: "{app}"; StatusMsg: "Настройка ярлыков и автообновления..."; Flags: waituntilterminated runhidden
; Шаг 2 (опционально): Предложить запустить Bitrix24 сразу
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\updater.ps1"" -Launch"; Description: "Запустить Bitrix24 с расширением"; Flags: postinstall skipifsilent unchecked runhidden

[UninstallRun]
; Снимаем задачу Планировщика при удалении
Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command ""Unregister-ScheduledTask -TaskName '{#TaskName}' -Confirm:$false -ErrorAction SilentlyContinue"""; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
Type: dirifempty;     Name: "{userappdata}\Microsoft\Windows\Start Menu\Programs\BX24 Chat Sorter"

[Code]
// Возвращает " -Desktop" если пользователь отметил чекбокс "создать ярлык"
function GetDesktopFlag(Param: String): String;
begin
  if WizardIsTaskSelected('desktopicon') then
    Result := ' -Desktop'
  else
    Result := '';
end;

// Удаляем ярлыки при деинсталляции
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Desktop, StartMenu: String;
begin
  if CurUninstallStep = usPostUninstall then begin
    Desktop   := ExpandConstant('{userdesktop}\Bitrix24 (PENA Agency).lnk');
    StartMenu := ExpandConstant('{userappdata}\Microsoft\Windows\Start Menu\Programs\BX24 Chat Sorter\Bitrix24 (PENA Agency).lnk');
    if FileExists(Desktop)   then DeleteFile(Desktop);
    if FileExists(StartMenu) then DeleteFile(StartMenu);
  end;
end;
