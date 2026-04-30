/**
 * 공통 API 클라이언트.
 * 모든 mutating fetch는 이 헬퍼를 거쳐 응답 검증/에러 메시지 추출/유저 헤더 자동 첨부를 일관되게 처리한다.
 *
 * 사용 예:
 *   try {
 *     await api.post("/api/materials", body);
 *     onSaved();
 *   } catch (e) {
 *     alert(getErrorMessage(e));
 *   }
 */

const STORAGE_KEY = "ds_auth_user";

function getAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const u = JSON.parse(raw);
    if (u && typeof u.id === "number") return { "X-User-Id": String(u.id) };
  } catch {}
  return {};
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let msg = `${res.status} ${res.statusText}`;
  let code: string | undefined;
  try {
    const data = await res.json();
    if (data?.error) {
      // 두 가지 응답 형식 모두 지원: { error: "msg" } 또는 { error: { code, message } }
      if (typeof data.error === "string") {
        msg = data.error;
      } else if (typeof data.error === "object") {
        msg = data.error.message ?? msg;
        code = data.error.code;
      }
    }
  } catch {}
  return new ApiError(msg, res.status, code);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...getAuthHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get:    <T>(url: string)              => request<T>("GET",    url),
  post:   <T>(url: string, body: unknown) => request<T>("POST",   url, body),
  patch:  <T>(url: string, body: unknown) => request<T>("PATCH",  url, body),
  put:    <T>(url: string, body: unknown) => request<T>("PUT",    url, body),
  delete: <T>(url: string)              => request<T>("DELETE", url),
};

export function getErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "요청 처리 중 오류가 발생했습니다.";
}
