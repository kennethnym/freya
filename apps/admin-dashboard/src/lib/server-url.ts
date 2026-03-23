const STORAGE_KEY = "aelis-server-url"
const DEFAULT_URL = "https://3000--019cf276-6ed6-7529-a425-210182693908.eu-runner.flex.doptig.cloud"

export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL
}

export function setServerUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ""))
}
