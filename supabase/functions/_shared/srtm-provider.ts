const maxBytes = 512 * 1024;

export async function fetchSrtmGrid(
  bounds: { north: number; south: number; east: number; west: number },
  apiKey: string,
  request: typeof fetch = fetch,
) {
  const url = new URL("https://portal.opentopography.org/API/globaldem");
  for (const [key, value] of Object.entries(bounds))
    url.searchParams.set(key, String(value));
  url.searchParams.set("demtype", "SRTMGL1");
  url.searchParams.set("outputFormat", "AAIGrid");
  url.searchParams.set("API_Key", apiKey);
  try {
    const response = await request(url, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        return {
          error: "Лимит запросов OpenTopography исчерпан. Повторите позже.",
        } as const;
      if (response.status === 401 || response.status === 403)
        return {
          error: "OpenTopography отклонил доступ. Проверьте серверный ключ.",
        } as const;
      return {
        error: "OpenTopography не смог вернуть растр SRTM. Повторите позже.",
      } as const;
    }
    if (!response.body)
      return { error: "Поставщик вернул пустой ответ." } as const;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0,
      text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { error: "Ответ поставщика превышает лимит AGRONA." } as const;
      }
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode() } as const;
  } catch {
    return {
      error:
        "Не удалось загрузить растр SRTM: соединение прервано или истекло время ожидания.",
    } as const;
  }
}
