import Cookies from 'js-cookie';

const SESSION_COOKIE_NAME = 'bms_session_id';
const SESSION_EXPIRY_DAYS = 7;

export function getSessionCookie(): string | undefined {
  return Cookies.get(SESSION_COOKIE_NAME);
}

export function setSessionCookie(sessionId: string): void {
  Cookies.set(SESSION_COOKIE_NAME, sessionId, {
    expires: SESSION_EXPIRY_DAYS,
    sameSite: 'Lax',
  });
}

export function removeSessionCookie(): void {
  Cookies.remove(SESSION_COOKIE_NAME);
}

export function getSessionFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('bms-session-id');
}

// อ่าน session จาก URL แล้วลบ param ออกให้ URL สะอาด
export function consumeSessionFromUrl(): string | null {
  const sessionId = getSessionFromUrl();
  if (sessionId) {
    const url = new URL(window.location.href);
    url.searchParams.delete('bms-session-id');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
  return sessionId;
}

// อ่าน ?admin=true จาก URL
export function getAdminFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('admin') === 'true';
}
