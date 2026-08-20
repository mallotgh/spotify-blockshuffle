# Spotify Blockshuffle

Selbst gehostete Weboberfläche, die Playlists aus dem eigenen Spotify-Account lädt und darin **Blöcke** definiert: geordnete Gruppen von Tracks (z. B. Original → Sample A → Sample B), die beim Shuffle als Einheit behandelt werden. Die Reihenfolge der Blöcke ist zufällig, die Reihenfolge **innerhalb** eines Blocks bleibt fest.

Da die Spotify-API keinen Einfluss auf den internen Shuffle-Algorithmus erlaubt, berechnet die App die Reihenfolge selbst (seedbarer Fisher-Yates über „Einheiten") und übergibt Spotify eine fertig sortierte Abspielreihenfolge — bei deaktiviertem Spotify-Shuffle.

**Hinweis:** Die App nutzt den API-Stand nach dem Umbau vom Februar 2026 (`/playlists/{id}/items`, Feld `item` statt `track`, `POST /me/playlists`). Ältere Tutorials und Codebeispiele sind nicht mehr gültig.

## Funktionsweise

- **Blöcke** werden pro Playlist definiert und in SQLite gespeichert. Ein Track gehört pro Playlist zu höchstens einem Block; Blöcke unter 2 Tracks werden automatisch aufgelöst.
- **Shuffle:** Jeder Block ist eine Einheit, jeder blockfreie Track eine Einheit der Länge 1. Die Einheitenliste wird mit einem seedbaren RNG gemischt. Der Seed wird angezeigt und kann erneut eingegeben werden, um eine Reihenfolge exakt zu reproduzieren.
- **Wiedergabe:**
  - **Weg A (Shadow-Playlist, Standard ab 91 Tracks):** Die App pflegt eine private Playlist `🔀 <Name> (Blockshuffle)` pro Original-Playlist und ersetzt deren Inhalt mit der berechneten Reihenfolge. Keine Längenbegrenzung, freies Vor-/Zurückspringen in der Spotify-App.
  - **Weg B (direkte URI-Liste, bis 90 Tracks):** Wiedergabe direkt über `PUT /me/player/play` mit `uris`.
  - In beiden Fällen wird Spotifys eigener Shuffle vorher deaktiviert. Die Statusleiste warnt, falls er extern wieder eingeschaltet wird.
- **Drift:** Verschwindet ein Track aus der Spotify-Playlist, bleibt sein Blockeintrag erhalten und wird als *verwaist* markiert (ausgegraut). Beim Shuffle werden verwaiste Einträge übersprungen — gelöscht wird nichts ohne dein Zutun.

## Voraussetzungen

- Spotify-**Premium**-Abo (die Player-Endpunkte antworten sonst mit `403`; der Premium-Status ist über die API seit Februar 2026 nicht mehr abfragbar, die App meldet den Fehler verständlich).
- Eine eigene Spotify-App im [Developer Dashboard](https://developer.spotify.com/dashboard). Apps im Development Mode erfordern ein aktives Premium-Abo des App-Inhabers und sind auf 5 autorisierte Nutzer begrenzt — für den Einzelnutzer-Betrieb unproblematisch.
- Docker (z. B. auf einem Unraid-Server) oder Node ≥ 22.

## Spotify-App anlegen

1. Im [Developer Dashboard](https://developer.spotify.com/dashboard) **Create app**.
2. **Redirect URI** eintragen — Spotify akzeptiert nur noch:
   - ✅ `https://…/callback` (eigene Domain hinter Reverse Proxy), oder
   - ✅ ein Loopback-IP-Literal wie `http://127.0.0.1:8973/callback`
   - ❌ `http://localhost:…` (generell verboten)
   - ❌ LAN-IPs über HTTP wie `http://192.168.1.50:8973/callback`
3. **Client ID** und **Client Secret** notieren.

## Einrichtung

### Variante 1 (empfohlen): HTTPS über Reverse Proxy

Nginx Proxy Manager, Traefik o. Ä. mit eigener Domain vor den Container schalten. Redirect-URI in Dashboard **und** `.env` ist dann z. B. `https://blockshuffle.meine-domain.de/callback`. Login direkt im Browser über die Domain.

### Variante 2 (ohne Reverse Proxy): SSH-Tunnel für den einmaligen Login

Redirect-URI `http://127.0.0.1:8973/callback` registrieren und in `.env` setzen. Der einmalige Login läuft über einen SSH-Tunnel vom eigenen Rechner:

```bash
ssh -L 8973:localhost:8973 root@<unraid-ip>
```

Danach `http://127.0.0.1:8973` im **lokalen** Browser öffnen und autorisieren. Der Refresh-Token wird in SQLite persistiert — der Tunnel wird danach nicht mehr benötigt, die App ist im LAN normal über die Server-IP bedienbar.

### Deployment mit Docker (Unraid)

```bash
cp .env.example .env   # SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI eintragen
docker compose up -d --build
```

Oder als Unraid-Container von Hand:

| Einstellung | Wert |
|---|---|
| Port | `8973` (Host) → `8973` (Container), per `PORT` überschreibbar |
| Volume | `/mnt/user/appdata/blockshuffle` → `/config` (SQLite-Datenbank) |
| Env | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` |

Healthcheck: `GET /api/health`.

### Lokale Entwicklung

```bash
npm install && npm --prefix web install
cp .env.example .env        # Zugangsdaten eintragen
npm run dev                 # Backend auf :8973
npm --prefix web run dev    # Vite-Dev-Server auf :5173 (proxied /api und /callback)
npm test                    # Unit-Tests (Shuffle-Engine, Block-Invarianten)
npm run build && npm run build:web && npm start   # Produktionsmodus
```

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | – | Client ID aus dem Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | – | Client Secret (nur serverseitig, landet nie im Frontend) |
| `SPOTIFY_REDIRECT_URI` | – | Muss exakt einer im Dashboard registrierten URI entsprechen |
| `PORT` | `8973` | Port des Webservers |
| `DATA_DIR` | `./data` (Container: `/config`) | Ablage der SQLite-Datenbank |

## Bedienung

1. **Anmelden** — einmalig, danach überlebt die Session auch Container-Neustarts.
2. Links eine **Playlist** wählen; rechts erscheint die Trackliste.
3. Tracks per **Klick / Shift-Klick** markieren → **Block erstellen**. Blöcke werden farbig gruppiert dargestellt; der erste Track ist als *Original* markiert. Reihenfolge im Block per Drag & Drop, umbenennen per Klick auf den Namen.
4. Oben Gerät wählen und **Blockshuffle starten** — oder erst **Vorschau**: zeigt die berechnete Reihenfolge samt Seed, mit *Neu würfeln* und *Abspielen*.
5. Die Statusleiste zeigt den laufenden Track und die Position („Block 7 von 23 · Track 2 von 3").

## Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| Login-Fehler `INVALID_CLIENT: Invalid redirect URI` | `SPOTIFY_REDIRECT_URI` stimmt nicht **exakt** mit der im Dashboard registrierten URI überein (Schema, Host, Port, Pfad). |
| Redirect-URI wird im Dashboard nicht akzeptiert | `localhost` und LAN-IPs über HTTP sind verboten — `http://127.0.0.1:<port>/callback` oder HTTPS verwenden. |
| „…dafür ist ein Premium-Abo nötig" (403) | Wiedergabesteuerung erfordert Premium. Der Premium-Status ist nicht mehr per API abfragbar, der Fehler zeigt sich erst beim Abspielen. |
| „Kein aktives Spotify-Gerät gefunden" (404) | Spotify auf einem Gerät öffnen und kurz etwas abspielen, dann Geräteliste neu laden. |
| Playlist zeigt „nur Metadaten" | Fremde (nur gefolgte) Playlists liefern seit Februar 2026 keine Tracklisten mehr. Blockshuffle geht nur mit eigenen oder kollaborativen Playlists. |
| Reihenfolge stimmt nicht mit der Vorschau überein | Spotifys eigener Shuffle wurde wieder aktiviert (Warnung in der Statusleiste) — in der Spotify-App ausschalten. |
| Nach Neustart erneut Login nötig | `/config`-Volume nicht persistent gemountet — die SQLite-Datenbank liegt dort. |
| `buildx ist nicht installiert` beim Bauen | Ohne BuildKit/buildx mit dem Legacy-Builder bauen: `DOCKER_BUILDKIT=0 docker compose up -d --build` — oder `DOCKER_BUILDKIT=0 docker build -t spotify-blockshuffle .` und danach `docker compose up -d --no-build`. Das Dockerfile braucht kein BuildKit. |
| HTTP 429 im Log | Rate-Limit; die App wartet gemäß `Retry-After` automatisch und wiederholt den Request. |

## Bewusst nicht enthalten

Automatische Blockerkennung (WhoSampled etc.), Web Playback SDK (Wiedergabe im Browser), gewichtete Blockwahrscheinlichkeiten, Genre-Regeln, Mehrbenutzerbetrieb.
