import { useSyncExternalStore } from "react";
import english from "./messages.en.json";

export type Language = "en" | "ru";
const preferenceKey = "agrona-language";
const messages: Record<string, string> = english;
const listeners = new Set<() => void>();
let language: Language = "en";
try {
  if (globalThis.localStorage?.getItem(preferenceKey) === "ru") language = "ru";
} catch {
  // A restricted browser may disable storage.
}

export function getLanguage() {
  return language;
}

export function setLanguage(next: Language) {
  if (next === language) return;
  language = next;
  try {
    globalThis.localStorage?.setItem(preferenceKey, next);
  } catch {
    // Still apply the change for the current session.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

export function t(message: string, ...values: unknown[]): string {
  const pattern =
    language === "en" && Object.hasOwn(messages, message)
      ? messages[message]
      : message;
  return values.length
    ? pattern.replace(/\{(\d+)\}/g, (match, index) =>
        Number(index) < values.length ? String(values[index]) : match,
      )
    : pattern;
}

let storedPatterns:
  { pattern: RegExp; message: string; order: number[] }[] | undefined;

/** Translate previously stored AGRONA copy and server warnings without changing their stored values. */
export function localize(value: string): string {
  if (language === "ru" || !/[А-Яа-яЁё]/.test(value)) return value;
  if (Object.hasOwn(messages, value)) return messages[value];
  storedPatterns ??= Object.keys(messages).flatMap((message) => {
    if (!message.includes("{0}") || message.length < 18) return [];
    const parts = message.split(/\{(\d+)\}/);
    const order = parts.filter((_, index) => index % 2 === 1).map(Number);
    const expression = parts
      .map((part, index) =>
        index % 2 ? "(.+?)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    return [{ pattern: new RegExp("^" + expression + "$"), message, order }];
  });
  for (const entry of storedPatterns) {
    const match = entry.pattern.exec(value);
    if (!match) continue;
    const values: string[] = [];
    entry.order.forEach((position, index) => {
      values[position] = t(match[index + 1]);
    });
    return t(entry.message, ...values);
  }
  return value;
}
