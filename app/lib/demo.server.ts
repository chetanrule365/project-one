const COOKIE = "po_demo";

export function isDemoRequest(request: Request) {
  if (process.env.DEMO_MODE === "1") return true;
  const header = request.headers.get("cookie") ?? "";
  return /(?:^|;\s*)po_demo=1(?:;|$)/.test(header);
}

function cookieBase(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; SameSite=Lax${secure}`;
}

export function demoSetCookie(request: Request) {
  return `${COOKIE}=1; ${cookieBase(request)}; Max-Age=${60 * 60 * 24 * 7}`;
}

export function demoClearCookie(request: Request) {
  return `${COOKIE}=; ${cookieBase(request)}; Max-Age=0`;
}
