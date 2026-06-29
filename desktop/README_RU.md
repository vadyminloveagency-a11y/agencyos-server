# AgencyOS Desktop

Программа для операторов: CRM + отдельное окно Dream Singles на каждую анкету.

## Что делает

- Открывает AgencyOS с вашего сервера (Render или локально).
- Операторы входят только из программы (`clientType: desktop`).
- При Connect анкеты сервер держит **лёгкую сессию** (Online), **без Chromium на Render** (`DISABLE_SERVER_PLAYWRIGHT=1`).
- Программа открывает **своё окно Dream** с отдельным профилем на анкету (как профиль Chrome).

## Установка (разработка)

1. В корне сервера:

```powershell
npm install
npm start
```

2. В папке `desktop/`:

```powershell
cd desktop
npm install
npm start
```

По умолчанию программа подключается к `https://agencyos-server-096a.onrender.com`.

### Другой сервер

```powershell
$env:AGENCYOS_SERVER_URL="http://localhost:3000"
npm start
```

или

```powershell
npm start -- --server=http://localhost:3000
```

## Сборка .exe

```powershell
cd desktop
npm install
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run dist
```

Готовый установщик: `release/desktop/AgencyOS-Setup-0.2.0.exe`

Портативная версия без установки: `release/desktop/win-unpacked/AgencyOS.exe`

## Автообновление

В `package.json` → `build.publish.url` укажите URL, где будут лежать релизы (generic provider).
Пока URL примерный — обновления в prod настроим после первого релиза.

## LetterBot (v0.2)

LetterBot отправляет письма **локально** через окно Dream на вашем ПК:

1. В CRM: сохраните текст письма (Save), нажмите **Start mailing**.
2. Desktop открывает страницы Dream `bot/` и `bot/send`, сохраняет шаблон и жмёт Send.
3. Каждые ~10 сек — повторная отправка; по интервалу — обновление шаблона.

**Нужно:** профиль **On**, окно Dream открыто (после Connect).

## Что дальше
- Автоопределение анкеты по Dream-сессии.
- Launcher / подпись Windows.
