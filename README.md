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
| `npm start` | собранный Node-сервер, по умолчанию `:3000` |
| `npm run preview` | собранное приложение на `:4173` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | тесты каталога, журнала, расхода токенов и парсера GitHub-ссылок |
| `npm run test:production` | после сборки: HTTP, SQLite, перезапуск и доставка очереди в изолированной среде |

## Переменные

Ни одна не обязательна, кроме GitHub OAuth если нужен вход.

- `GITHUB_TOKEN` — живой каталог с GitHub. Без токена приложение быстро упрётся в rate limit и покажет зашитый seed.
- «Взять эту ночь» и «Разобрать» открывают Codex на компьютере того, кто нажал. Сервер агента не запускает.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — вход через GitHub. OAuth App: Homepage `http://127.0.0.1:5173`, callback `http://127.0.0.1:5173/api/auth/callback`.
- `APP_ORIGIN` — публичный origin для redirect URI.
- `AUTH_SECRET` — подпись сессии, от 32 символов. Локально файл `data/.auth-secret` создаётся сам.
- `DATA_DIR` — каталог SQLite и локального ключа подписи, по умолчанию `./data`. Для постоянных данных между релизами укажи абсолютный путь вне каталога кода.

Бэкенд — это не отдельный сервис. Каталог, OAuth и журнал крутятся в том же Node-процессе TanStack Start. Данные аккаунта — SQLite в `DATA_DIR/after-hours.sqlite`.

## Production и проверка выпуска

Сборка по умолчанию создаёт `.output/server/index.mjs` для обычного Node-сервера. Ему нужен постоянный локальный диск для SQLite; файловая система serverless-функции Vercel для этого не подходит. `NITRO_PRESET` можно переопределить для другой инфраструктуры, но это само по себе не переносит базу данных.

Перед `npm start` передай через окружение процесса `AUTH_SECRET`, `APP_ORIGIN`, абсолютный `DATA_DIR`, а для входа — `GITHUB_CLIENT_ID` и `GITHUB_CLIENT_SECRET`. Запуск собранного сервера не читает корневой `.env` автоматически. Адрес и порт слушателя задаются `NITRO_HOST` и `NITRO_PORT`. За HTTPS-прокси `APP_ORIGIN` должен быть публичным HTTPS-адресом сайта.

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run test:production
```

Production-smoke создаёт временную базу и собственные тестовые сессии, не обращается к GitHub и не запускает модель. Он не подтверждает реальный OAuth или работу локального Codex. Полный сценарий, настройка OAuth, резервное копирование и откат: [проверка выпуска](docs/release-checklist.md). Подключение локального Codex: [коннектор исследования](docs/research-connector.md).

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
