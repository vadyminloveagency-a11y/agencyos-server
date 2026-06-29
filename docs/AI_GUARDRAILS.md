# AI Guardrails For This CRM

Этот файл задает правила для помощника при изменении проекта.

## Главные запреты

- Не править `data.json` вручную без прямого разрешения владельца CRM.
- Не менять чужой раздел ради текущей задачи.
- Не удалять существующий алгоритм, если задача была про другой экран.
- Не менять логины, пароли, сессии и `.credential-key` без отдельного разрешения.
- Не смешивать правки Admin Panel и Mail/Inbox/Media в одной задаче без явного согласия.

## Перед любой правкой

1. Определить раздел из `docs/data/README.md`.
2. Прочитать README этого раздела.
3. Проверить список "что нельзя трогать".
4. Менять только нужные файлы.

## Границы разделов

- Задача про Admin Panel: не трогать отправку писем, Inbox/Sent, Dream media.
- Задача про Inbox: не трогать Admin Panel, назначения анкет, зарплаты.
- Задача про письма/рассылку: не трогать Admin Panel, salary, assignment history.
- Задача про назначения анкет: не трогать Inbox/Sent/Media.
- Задача про логины/пароли: не трогать письма и таблицу.

## Если нужно изменить живые данные

Сначала показать владельцу:

- какие поля будут изменены;
- зачем это нужно;
- какой backup будет создан;
- как откатить.

Только после подтверждения выполнять изменение.

## Минимальная проверка после правки

- `node --check server.js`
- если трогался фронтенд: `node --check public/app.js` или `node --check public/workspace.js`
- `npm run check` (включая cloud guard)
- проверить экран/маршрут, которого касалась задача.

## Облако (Render) vs Desktop (ПК)

**Главное правило:** на Render **никогда** не запускать Chrome / Playwright. Dream Singles открывается **только** в AgencyOS Desktop на компьютере оператора.

### Render (облако) — только лёгкое

- CRM, база, логин, статистика, heartbeat, выдача cookies для Desktop (`/api/profiles/:id/launch`).
- Переменная окружения: `DISABLE_SERVER_PLAYWRIGHT=1` (уже в `render.yaml`).
- LetterBot на сервере **не запускает** браузер и не шлёт письма через Playwright.

### Desktop (ПК) — тяжёлое

- Окна Dream Singles (1 анкета = 1 профиль).
- Будущий LetterBot с кликами на ПК.
- При Connect клиент шлёт `X-Agency-Client: desktop` и `startBrowser: false`.

### Что нельзя ломать при правках

- Не убирать `DISABLE_SERVER_PLAYWRIGHT` с Render без апгрейда тарифа RAM.
- Не менять connect-flow только в `app.js` или только в `server.js` — **деploy обоих вместе**.
- Не добавлять вызовы `startDreamBrowser` без проверки `assertServerPlaywrightAllowed`.
- Операторы входят только через Desktop (`clientType: desktop`).

### Проверка версии

- `GET /api/health` → `serverPlaywright: false` на Render.
- `uiBuild` в health должен совпадать с `?v=` в `index.html` после деплоя.

