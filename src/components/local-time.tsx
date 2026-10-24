import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Keep SSR/hydration identical, then display the visitor's local time. */
export function LocalTime({ at }: { at: number }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return <span>нет данных</span>;
  const iso = date.toISOString();
  const text = hydrated
    ? date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
    : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  return <time dateTime={iso}>{text}</time>;
}
