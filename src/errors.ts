export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notAuthenticated = () =>
  new ApiError(401, 'not_authenticated', 'Nicht mit Spotify verbunden. Bitte zuerst anmelden.');

export const noPremium = () =>
  new ApiError(403, 'no_premium', 'Spotify hat die Wiedergabesteuerung abgelehnt (403). Dafür ist ein Premium-Abo nötig.');

export const noActiveDevice = () =>
  new ApiError(
    404,
    'no_active_device',
    'Kein aktives Spotify-Gerät gefunden. Öffne Spotify auf dem Zielgerät (Handy: App in den Vordergrund holen), tippe kurz auf Play/Pause und versuche es erneut — oder wähle das Gerät oben explizit aus.',
  );
