// 网页默认沿用构建配置；桌宠显式传入主进程确定的 API 地址。
export function resolveStageAssetUrl(url, apiBaseUrl) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base = (apiBaseUrl || "http://127.0.0.1:8000").replace(/\/+$/, "");
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}
