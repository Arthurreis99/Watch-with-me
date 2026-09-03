export function extractYouTubeId(value: string) {
  const raw = value.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (host.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

export function youtubeErrorMessage(code: number) {
  if (code === 2) return "O link ou identificador do vídeo é inválido.";
  if (code === 5) return "O YouTube não conseguiu reproduzir este vídeo em HTML5.";
  if (code === 100) return "O vídeo foi removido ou está privado.";
  if (code === 101 || code === 150) {
    return "O proprietário não permite que este vídeo seja reproduzido fora do YouTube.";
  }
  return "O YouTube não conseguiu carregar este vídeo.";
}
