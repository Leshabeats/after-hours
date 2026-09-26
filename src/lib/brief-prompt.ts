export function briefPrompt(input: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  isPr: boolean;
}) {
  const role = input.isPr ? "pull request" : "issue";
  return `Разбери этот open source ${role} по-русски, в чате. Файлы не меняй.

Репозиторий: ${input.owner}/${input.repo}
URL: ${input.url}
Заголовок: ${input.title}

Тело:
${input.body.slice(0, 6000) || "(пусто)"}

Ответ:
- Суть: 2–4 предложения, почему это не шум.
- Зачем: кому станет лучше.
- Сложность: одна ночь / нужна голова / глубокий долг.
- Где смотреть: вероятные файлы.
- Первые шаги: 3–5 конкретных.
- Как проверить.
- Риски.
- В конце английский промпт для coding-агента: smallest correct change, follow contributing, no drive-by refactors.`;
}
