import { withLoading } from "./loading.js";
let csrf;
export function clearCsrf() { csrf = undefined; }
export class ApiError extends Error {
  constructor(message, status, errors = []) {
    super(message);
    this.status = status;
    this.errors = Array.isArray(errors) ? errors.slice(0, 200) : [];
  }
}
export function renewCsrf() {
  return withLoading(fetchCsrf);
}
async function fetchCsrf() {
  const response = await fetch("/api/auth/csrf", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error("Não foi possível abrir uma sessão segura.");
  csrf = (await response.json()).token;
}
export function api(path, method = "GET", body, { background = false, signal, responseType = "json" } = {}) {
  const task = () => request(path, method, body, signal, responseType);
  return background ? task() : withLoading(task);
}
async function request(path, method, body, signal, responseType) {
  if (method !== "GET" && !csrf) await renewCsrf();
  const multipart = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      "X-Eternnus": "1",
      ...(method === "GET" ? {} : { "X-CSRF-TOKEN": csrf }),
    },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (data.code === "csrf_expired") {
      clearCsrf();
      // A perda do cookie também invalida o CSRF. Só consultar a identidade;
      // uma escrita interrompida nunca deve ser repetida automaticamente.
      try { await request("/auth/me", "GET", undefined, signal, "json"); }
      catch (error) { if (error.status === 401) throw error; }
    }
    if (response.status === 401 && path !== "/auth/login" && !path.startsWith("/auth/two-factor/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      data.message ||
        (response.status === 401
          ? "Entre novamente para continuar."
          : response.status === 403
            ? "Confirme seu e-mail para liberar este recurso."
            : response.status === 429
              ? "Aguarde um momento antes de tentar novamente."
              : "Não foi possível concluir. Tente novamente."),
      response.status,
      data.errors,
    );
  }
  if (responseType === "bytes") return new Uint8Array(await response.arrayBuffer());
  return response.status === 204 ? null : response.json().catch(() => null);
}
