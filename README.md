# After Hours

Ночная доска миссий по живому опенсорсу. Жги токены на issue и PR в репозиториях от 1000 звёзд: сначала топ репозиториев, потом их задачи. Веб на виду сразу; дальше направление (Stars, Go, Linux, …) и язык.

Ночь может выбрать цель сама, можно взять список, можно вставить свой GitHub URL. Журнал без входа живёт в браузере; после GitHub OAuth — на сервере, в SQLite.

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
| `npm test` | тесты каталога, журнала и парсера GitHub-ссылок |

## Переменные

Ни одна не обязательна, кроме GitHub OAuth если нужен вход.

- `GITHUB_TOKEN` — живой каталог с GitHub. Без токена приложение быстро упрётся в rate limit и покажет зашитый seed.
- `XAI_API_KEY` — кнопка «Разбор ночи» на карточке миссии. Без ключа разбор недоступен, остальное работает.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — вход через GitHub. OAuth App: Homepage `http://127.0.0.1:5173`, callback `http://127.0.0.1:5173/api/auth/callback`.
- `APP_ORIGIN` — публичный origin для redirect URI.
- `AUTH_SECRET` — подпись сессии, от 32 символов. Локально файл `data/.auth-secret` создаётся сам.

Бэкенд — это не отдельный сервис. Каталог, OAuth и журнал крутятся в том же Node-процессе TanStack Start. Данные аккаунта — SQLite в `data/after-hours.sqlite`.

## Что это не делает

Нет облачного агента и счётчика токенов. Без OAuth журнал остаётся в `localStorage`.

Прототип собран в Grok App Builder и вычищен в обычный TanStack Start репозиторий.
