// 后端 API 客户端：统一处理 token、错误码、JSON。
const API_BASE = localStorage.getItem("apiBase") || "http://localhost:3000/api";

export function token() {
  return localStorage.getItem("adminToken") || "";
}
export function setToken(t) {
  if (t) localStorage.setItem("adminToken", t);
  else localStorage.removeItem("adminToken");
}
export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem("adminUser") || "null");
  } catch {
    return null;
  }
}
export function setUser(u) {
  if (u) localStorage.setItem("adminUser", JSON.stringify(u));
  else localStorage.removeItem("adminUser");
}
export function isLoggedIn() {
  return !!token();
}

export async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `请求失败 (${res.status})`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

export const get = (p) => api("GET", p);
export const post = (p, b) => api("POST", p, b);
