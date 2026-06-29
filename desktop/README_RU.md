# AgencyOS Desktop v0.3.0

Программа для операторов. Сервер: `https://agencyos-server-096a.onrender.com` (только **agencyos-server**, не dream-team-crm).

## Архитектура

| Часть | Где работает |
|-------|----------------|
| CRM, Inbox, настройки | Главное окно AgencyOS |
| Dream (логин, LetterBot) | **Скрытое** окно на ПК (не видно) |
| Google Drive, материалы | **Видимое** окно AgencyOS |
| Chromium / Playwright | **Только на ПК**, не на Render |

## Установка для операторов

1. Скачайте `release/desktop-030/AgencyOS-Setup-0.3.0.exe`
2. Установите (можно поверх старой версии)
3. Запустите AgencyOS
4. Войдите в CRM
5. В сайдбаре **Authorization** → **On** у нужной анкеты
6. Inbox / LetterBot / Google Drive — в главном окне

## Чеклист «всё работает»

- [ ] Нет окна «запустился без связи с программой»
- [ ] Видны анкеты (Authorization)
- [ ] On → статус Online
- [ ] Inbox открывается
- [ ] LetterBot Start не серый
- [ ] Google Drive → окно AgencyOS (не Chrome)
- [ ] Закрыл программу → открыл → анкеты On сохранились

## Сборка .exe (разработка)

```powershell
cd desktop
npm install
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run dist
```

Установщик: `release/desktop-030/AgencyOS-Setup-0.3.0.exe`

## LetterBot

1. Анкета **On**
2. Сохраните письмо (Save)
3. **Start mailing** — отправка идёт через скрытое окно Dream на ПК
