export default function LoginScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="text-5xl">🔀</div>
      <h1 className="text-3xl font-bold">Spotify Blockshuffle</h1>
      <p className="max-w-md text-neutral-400">
        Definiere Blöcke aus Original und Samples in deinen Playlists — beim Shuffle bleibt die
        Reihenfolge innerhalb eines Blocks erhalten.
      </p>
      <a
        href="/api/auth/login"
        className="rounded-full bg-green-600 px-8 py-3 font-semibold text-white transition hover:bg-green-500"
      >
        Mit Spotify anmelden
      </a>
      <p className="max-w-md text-xs text-neutral-500">
        Benötigt ein Spotify-Premium-Abo für die Wiedergabesteuerung. Zugangsdaten werden nur lokal
        gespeichert.
      </p>
    </div>
  );
}
