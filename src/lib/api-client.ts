import { mockRouter, MockApiError } from "./mock-router";

export { MockApiError as ApiError };

export const api = {
  get:    <T>(url: string)                     => mockRouter.get<T>(url),
  post:   <T>(url: string, body: unknown)      => mockRouter.post<T>(url, body),
  patch:  <T>(url: string, body: unknown)      => mockRouter.patch<T>(url, body),
  put:    <T>(url: string, body: unknown)      => mockRouter.put<T>(url, body),
  delete: <T>(url: string, body?: unknown)     => mockRouter.delete<T>(url, body),
};

export function getErrorMessage(e: unknown): string {
  if (e instanceof MockApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "요청 처리 중 오류가 발생했습니다.";
}
