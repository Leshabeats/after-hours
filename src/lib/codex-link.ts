export function codexAppChatUrl(prompt: string) {
  const url = new URL("codex://threads/new");
  url.searchParams.set("prompt", prompt);
  return url.toString();
}

export function openCodexApp(prompt: string) {
  window.location.href = codexAppChatUrl(prompt);
}
