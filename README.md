# After Hours

Ночная доска миссий по живому опенсорсу. Жги токены на issue и PR в репозиториях от 1000 звёзд: сначала топ репозиториев, потом их задачи. Веб на виду сразу; дальше направление (Stars, Go, Linux, …) и язык.

Ночь может выбрать цель сама, можно взять список, можно вставить свой GitHub URL. Журнал без входа живёт в браузере; после GitHub OAuth — на сервере, в SQLite. Если в аккаунте пусто, ночи с устройства заливаются один раз; если журнал на сервере уже есть, он не смешивается с локальным.

## Запуск

Нужен Node 22+.

```bash
cp .env.example .env
npm install
npm run dev
```

Открой [http://127.0.0.1:5173](http://127.0.0.1:5173).

| Команда | Что делает |
| --- | --- |
| `npm run dev` | dev-сервер на `:5173` |
| `npm run build` | production-сборка |
| `npm run preview` | собранное приложение на `:4173` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | тесты каталога, журнала, расхода токенов и парсера GitHub-ссылок |

## Переменные

Ни одна не обязательна, кроме GitHub OAuth если нужен вход.

- `GITHUB_TOKEN` — живой каталог с GitHub. Без токена приложение быстро упрётся в rate limit и покажет зашитый seed.
- «Взять эту ночь» и «Разобрать» открывают Codex на компьютере того, кто нажал. Сервер агента не запускает.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — вход через GitHub. OAuth App: Homepage `http://127.0.0.1:5173`, callback `http://127.0.0.1:5173/api/auth/callback`.
- `APP_ORIGIN` — публичный origin для redirect URI.
- `AUTH_SECRET` — подпись сессии, от 32 символов. Локально файл `data/.auth-secret` создаётся сам.

Бэкенд — это не отдельный сервис. Каталог, OAuth и журнал крутятся в том же Node-процессе TanStack Start. Данные аккаунта — SQLite в `data/after-hours.sqlite`.

## Расход токенов

After Hours не запускает агента и не проксирует вызовы модели. Локальный харнес после GitHub-входа пишет расход в SQLite (`usage_events`, ключ — id пользователя из сессии, не из тела запроса). GitHub-токены не храним.

Cookie `ah_session` копируется из браузера после OAuth.

```bash
curl -sS -X POST http://127.0.0.1:5173/api/usage \
  -H 'Content-Type: application/json' \
  -H "Cookie: ah_session=$AH_SESSION" \
  -d '{"harness":"codex","model":"grok-4","inputTokens":1200,"outputTokens":400,"missionId":"vitejs/vite#19909"}'
```

На `/log` у вошедших: токены за 7 дней, всего, имя последнего харнеса. Без входа блок прячется с просьбой войти.

## Что это не делает

Нет облачного агента. After Hours не вызывает модель за харнес и не принимает `userId` от клиента. Без OAuth журнал остаётся в `localStorage`, расход токенов не пишется.

Прототип собран в Grok App Builder и вычищен в обычный TanStack Start репозиторий.
