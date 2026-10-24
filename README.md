# After Hours

Ночная доска миссий по живому опенсорсу. Жги токены на issue и PR в репозиториях от 1000 звёзд: сначала топ репозиториев, потом их задачи. Веб на виду сразу; дальше направление (Stars, Go, Linux, …) и язык.

Ночь может выбрать цель сама, можно взять список, можно вставить свой GitHub URL. Журнал без входа живёт в браузере; после GitHub OAuth — в Neon PostgreSQL. Если в аккаунте пусто, ночи с устройства заливаются один раз; если серверный журнал уже есть, он не смешивается с локальным.

## Запуск

Нужен Node 22 и npm 11. Bundled npm 10 из Node 22 не устанавливает текущий lockfile; сначала обнови npm до 11.

```bash
npm install -g npm@11
npm ci
cp .env.example .env.local
```

Создай отдельную ветку **development** в Neon. В `.env.local` укажи её pooled URL в `DATABASE_URL`, direct URL в `DATABASE_URL_UNPOOLED`, затем:

```bash
npm run db:migrate
npm run dev
```

Открой [http://127.0.0.1:5173](http://127.0.0.1:5173). Для разработки приложения локальный Docker/PostgreSQL не нужен. Dev, start и миграции явно читают `.env.local`; переменные процесса имеют приоритет.

| Команда                   | Что делает                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`             | dev-сервер на `:5173` с Neon development                                           |
| `npm run db:migrate`      | версионные SQL-миграции через direct URL                                           |
| `npm run build`           | Nitro node-server для локальной проверки                                           |
| `npm run build:vercel`    | frontend и backend в `.vercel/output`                                              |
| `npm start`               | собранный Node-сервер, по умолчанию `:3000`                                        |
| `npm run preview`         | собранное приложение на `:4173`                                                    |
| `npm run typecheck`       | `tsc --noEmit`                                                                     |
| `npm test`                | доменные тесты; с `TEST_DATABASE_URL` также PostgreSQL-контракты, гонки и rollback |
| `npm run test:production` | после Node-сборки: HTTP, PostgreSQL, перезапуск и доставка очереди                 |

## Переменные

- `DATABASE_URL` — pooled URL ветки Neon для runtime. Доступен только серверу.
- `DATABASE_URL_UNPOOLED` — direct URL той же ветки для `npm run db:migrate`.
- `GITHUB_TOKEN` — необязательный токен каталога и истории GitHub. Без токена rate limit быстрее приводит к seed-каталогу.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — вход через GitHub. Существующий локальный OAuth App сохраняет Homepage `http://127.0.0.1:5173` и callback `http://127.0.0.1:5173/api/auth/callback`.
- `APP_ORIGIN` — origin сайта для OAuth redirect. В production — реальный HTTPS-адрес.
- `AUTH_SECRET` — постоянная случайная подпись сессии, от 32 байт; обязательна в production, включая Vercel Preview. Локально при отсутствии создаётся `data/.auth-secret`.
- `DATA_DIR` — только каталог локального ключа подписи в development, по умолчанию `./data`.

Бэкенд — TanStack Start server functions и HTTP routes в том же Vercel deployment, что и frontend. Runtime использует ограниченный `pg` pool и `attachDatabasePool` на Vercel. Схема изменяется отдельной командой, а не при HTTP-запросе. База начинается пустой; переноса старой SQLite нет.

## Vercel и проверка выпуска

Создавай отдельный проект на **Neon Free** во Frankfurt (`eu-central-1`), Vercel Functions — Frankfurt (`fra1`, задан в `vercel.json`). Если Free недоступен, повышение тарифа требует отдельного решения. Существующие ресурсы Velora не изменяются. Эти шаги описывают настройку, а не уже созданную инфраструктуру.

Используй отдельные ветки Neon: **production** для Production и **development** для локальной разработки/Preview. В Vercel настрой Node 22, npm 11 и Build Command `npm run build:vercel` (также задан в `vercel.json`). Для Production установи URLs production-ветки, `AUTH_SECRET`, `APP_ORIGIN` и credentials отдельного production GitHub OAuth App с callback `https://<реальный-домен>/api/auth/callback`.

Для Preview установи URLs development-ветки и отдельный `AUTH_SECRET`, оставь OAuth credentials пустыми. Код дополнительно отключает OAuth при `VERCEL_ENV=preview`. Перед первым deployment примени миграции к целевой ветке через её direct URL. Не запускай production-миграции из Preview build.

```bash
npm test
npm run typecheck
npm run lint
npm run build
# Требует отдельную локальную ephemeral PostgreSQL 17 и экспортированный TEST_DATABASE_URL.
npm run test:production
npm run build:vercel
```

CI поднимает PostgreSQL 17 без live Neon secrets. Тесты БД и smoke принимают только отдельный `TEST_DATABASE_URL` на localhost с именем базы `*_test`, создают случайные схемы и удаляют их. Они никогда не читают `.env.local` и не используют `DATABASE_URL`. Без `TEST_DATABASE_URL` PostgreSQL-тесты пропускаются, а smoke завершается с ошибкой.

Production-smoke использует синтетические сессии и отключённую внешнюю сеть сервера; он не подтверждает реальный OAuth или запуск модели. Полный сценарий, миграции, backup и откат: [проверка выпуска](docs/release-checklist.md). Подключение локального Codex: [коннектор исследования](docs/research-connector.md).

## Расход токенов

«Взять эту ночь» и «Разобрать» открывают Codex на компьютере посетителя. After Hours не запускает агента и не проксирует модель. Локальный харнес после GitHub-входа пишет расход в PostgreSQL (`usage_events`, ключ — id пользователя из сессии). GitHub-токены не храним.

Cookie `ah_session` копируется из браузера после OAuth.

```bash
curl -sS -X POST http://127.0.0.1:5173/api/usage \
  -H 'Content-Type: application/json' \
  -H "Cookie: ah_session=$AH_SESSION" \
  -d '{"harness":"codex","model":"gpt-6.1-sol","inputTokens":1200,"outputTokens":400,"missionId":"vitejs/vite#19909"}'
```

На `/log` у вошедших: токены за 7 дней, всего, имя последнего харнеса. Без входа блок прячется с просьбой войти. Публичные отчёты не раскрывают частные лимиты или thread id. Коннектор сохраняет очередь на компьютере исследователя и повторяет доставку без двойного расхода.

Прототип собран в Grok App Builder и вычищен в обычный TanStack Start репозиторий.
