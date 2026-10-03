# Локальный Codex: решение по интеграции

Спайк для [#7](https://github.com/Leshabeats/after-hours/issues/7). Проверено 2026-10-03 на `codex-cli 0.159.0` (`~/.local/bin/codex`) и схеме `codex app-server generate-json-schema` без `--experimental`. Бандл Desktop — `codex-cli 0.159.2`. Команда `app-server` в `--help` помечена experimental. Транспорт WebSocket в документации experimental; этот спайк ходил только в `stdio://`.

## Решение

Автоматическая связь задачи и чата делается локальным коннектором. Он запускает `codex app-server --listen stdio://`, сам вызывает `thread/start` или `thread/resume` и сохраняет возвращённый `thread.id` рядом с `missionId` (`owner/repo#number`). Сайт по-прежнему не запускает агента и не хранит ключ модели.

Текущий `codex://threads/new?prompt=` остаётся ручным действием в браузере. В ссылке нет id чата, приложение его не возвращает, а в бинарнике рядом с `codex://threads/new?` нет других имён параметров. У треда нет поля внешнего id: `thread/metadata/update` меняет только git-метаданные, `thread/name/set` задаёт заголовок.

Отдельный процесс app-server видит уже записанные чаты Desktop через `thread/list`. У них `source: "vscode"`, `originator: "Codex Desktop"`, id — UUID, до `thread/resume` статус `notLoaded`. Совпадение такого чата с задачей по тексту промпта — эвристика, не ключ связи.

## Показатели

| Показатель        | Источник                                                            | Смысл                                                                                                                                                                                                                                            | Доступность                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Id чата           | `thread/start`, `thread/list`, `thread/resume` → `thread.id`        | UUID чата. Без него расход нельзя привязать к задаче                                                                                                                                                                                             | Есть у клиента app-server. Deep link его не даёт                                                                                             |
| Завершение хода   | `turn/completed.turn.status`                                        | `completed`, `interrupted`, `failed`. Старт хода — `inProgress`                                                                                                                                                                                  | Живой ход завершился `completed` за 6142 мс. Ответ — `agentMessage` «PONG»                                                                   |
| Ожидание человека | `thread/status/changed` при `status.type: "active"`                 | `activeFlags`: `waitingOnApproval`, `waitingOnUserInput`                                                                                                                                                                                         | В прогоне флаги были пустыми: `active`, затем `idle`. Запрос `echo hi` тоже завершился без approval. Живого ожидания не было                 |
| Прерывание        | `turn/interrupt`                                                    | Ход заканчивается `interrupted`                                                                                                                                                                                                                  | Сразу после `turn/start` прерывание дало `interrupted`, `durationMs: 4`, без items и без события расхода                                     |
| Расход хода       | `thread/tokenUsage/updated`                                         | Между ходами `total` совпал с суммой их `last`. Внутри одного хода это ещё не доказано                                                                                                                                                           | Второй ход: `last` output 6 и input 30175, `total` output 12 и input 53950. Два события одного хода (23803, затем 23871) по полям не сверены |
| Состав расхода    | `TokenUsageBreakdown`                                               | `totalTokens` совпал с `inputTokens + outputTokens`. `cachedInputTokens` не больше input и в сумму второй раз не входит                                                                                                                          | `reasoningOutputTokens` в прогоне был 0, поэтому его место в сумме не проверено. `cacheWriteInputTokens` пришёл как 0                        |
| Лимит подписки    | `account/rateLimits/read`, уведомление `account/rateLimits/updated` | `primary` / `secondary`: `usedPercent`, `windowDurationMins`, `resetsAt` (Unix seconds). `usedPercent` обязателен у окна. Отдельно `spendControlReached` и `individualLimit.remainingPercent`: отсутствие — `null`, не «можно тратить» и не ноль | Живой `read` вернул окно `primary` и `secondary: null`. `null` значит «нет данных», не ноль                                                  |
| Сводка аккаунта   | `account/usage/read`                                                | `lifetimeTokens`, всплески, streak                                                                                                                                                                                                               | Другой счётчик, не расход запуска                                                                                                            |
| Бюджет цели       | `thread/goal` `tokensUsed`                                          | Учёт цели; новая цель сбрасывает его                                                                                                                                                                                                             | Не телеметрия модели                                                                                                                         |

События приходят только в подключённый клиент. Исходящей доставки отчёта нет. История переживает перезапуск как записанный тред (`thread/read`, `thread/resume`). Что происходит с незавершённым ходом после смерти клиента, документация не говорит.

## Живой прогон

3 октября 2026, `codex-cli 0.159.0`, модель `gpt-6-astra`, провайдер `openai`. Каталог хода — пустой `/tmp/ah-empty-cwd`. Тред эфемерный, sandbox `read-only`, approval `on-request`. В `turn/start` передан `effort: "low"`. Поле `reasoningEffort` у треда осталось `max` из локального конфига. `reasoningOutputTokens` был 0.

Клиент запомнил связь сам. `thread/start` вернул `thread.id`, и оба события расхода пришли с этим id и с id своего хода. `missionId` сервер не хранит: строка `Leshabeats/after-hours#7` была только в тексте. `source` такого треда — `vscode`, как у Desktop. `originator` равен имени из `initialize.clientInfo` (`ah_wait_probe` на втором треде), у Desktop в списке было `Codex Desktop`.

Первый ход, просьба ответить `PONG`:

|              | input | cached | output | reasoning | total |
| ------------ | ----- | ------ | ------ | --------- | ----- |
| last = total | 23775 | 7168   | 6      | 0         | 23781 |

Второй ход, `QONG`, в том же треде:

|       | input | cached | output | reasoning | total |
| ----- | ----- | ------ | ------ | --------- | ----- |
| last  | 30175 | 23552  | 6      | 0         | 30181 |
| total | 53950 | 30720  | 12     | 0         | 53962 |

`total` второго события равен сумме `last` первого и `last` второго по input, cached, output и total. Короткий ответ стоит около 24–30 тысяч input: это размер служебного промпта, не длина «PONG». На ходу с просьбой выполнить `echo hi` пришли два события одного `turnId`: `last.totalTokens` вырос с 23803 до 23871. Рост на 68 похож на дописанный хвост снимка, но поля первого события с `total` не сравнивались. Рабочее правило, не доказанный контракт: в учёт кандидата берётся последний `last` хода, а уведомления подряд не складываются.

Прерывание сразу после `turn/start` не прислало `thread/tokenUsage/updated`. Расход этого хода неизвестен, это не ноль.

Окно `primary` до двух первых ходов и после всего прогона имело одну и ту же целую долю при длительности 10080 минут. За эти токены процент не сдвинулся. `secondary` остался `null`.

Эфемерные треды не попали на первую страницу `thread/list`: там по-прежнему недавние чаты Desktop.

## Прототип

```bash
node scripts/codex-app-server-probe.mjs
```

Скрипт делает `initialize`, `thread/list` и `account/rateLimits/read`. Список читает только state DB (`useStateDbOnly`) и все провайдеры (`modelProviders: []`). Обычные и архивные треды запрашиваются отдельно: без `archived: true` сервер архив не отдаёт. Счётчик помечен `scope: interactive`: источники только `cli`, `vscode`, `exec`, `appServer` и `unknown`, sub-agent треды в него не входят. Ошибка обычного списка не отменяет чтение лимита; ошибка архивного списка остаётся в `archivedError`, а уже прочитанные обычные треды не выбрасываются. `turn/start` и `thread/start` он отклоняет. В вывод не попадают id чатов, тексты, пути и id аккаунта. Метка originator с путём, почтой или id схлопывается в `[redacted]`, обычное имя клиента остаётся. то же вычищается из текста ошибок до обрезки хвоста stderr, включая UNC, апостроф в имени, папку без расширения и все слова пути до закрывающей кавычки или до компонента с точкой. Процент лимита печатается только локально. Сводка лимита хранит `spendControlReached`, остаток индивидуального лимита и флаги `credits.hasCredits` / `credits.unlimited` без баланса; если поля нет, это `null`.

Проверка без Codex: `node --test scripts/codex-app-server-probe.test.mjs`.

## Что это даёт [#8](https://github.com/Leshabeats/after-hours/issues/8)

Сервер может хранить запуск как пару `threadId` и `turnId`. Для двух разных ходов `total` равен сумме их `last`, поэтому накопительный `total` с последним `last` не складывают. Внутри одного хода рабочее правило — писать последний `last` (`inputTokens` и `outputTokens`), а не сумму уведомлений. Это гипотеза, пока два события одного `turnId` не сверены по полям. `cachedInputTokens` внутрь input уже входит, второй раз его не прибавлять. Повтор того же `turnId` не создаёт вторую строку. Если события расхода не было, значение неизвестно, не ноль. `reasoningOutputTokens` хранить отдельно, пока не появится ход с ненулевым reasoning.

Живой флаг ожидания человека этот прогон не поймал. Обработку `waitingOnApproval` и `waitingOnUserInput` нужно оставить в контракте, но текущие имена подтверждены схемой, не этим запуском. Один `completed` по-прежнему не означает готовый отчёт исследования: здесь завершением был односложный ответ.
