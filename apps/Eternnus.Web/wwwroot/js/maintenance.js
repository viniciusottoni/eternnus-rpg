import { setMaintenance } from "./loading.js";
import { toast } from "./ui.js";

// A currently open tab must never auto-reload during deployment:
// doing so would discard text or selections the user has not yet saved.
let inMaintenance = false;
let checking = false;

export function installMaintenanceWatcher() {
  async function check() {
    if (checking || document.visibilityState === "hidden" || !navigator.onLine) return;
    checking = true;
    try {
      // /health is excluded from the service worker's static cache.
      const response = await fetch("/health?maintenance-check=" + Date.now(), {
        credentials: "same-origin",
        cache: "no-store",
      });
      // IIS/ANCM may return the standalone app_offline.htm for /health.
      // Detect its marker even if the hosting proxy uses HTTP 200 instead of 503.
      const type = response.headers.get("content-type") || "";
      const isOfflineHtml = response.ok &&
        type.includes("text/html") &&
        (await response.text()).includes("ETERNNUS_DEPLOYMENT_OFFLINE");
      if (response.status === 503 || isOfflineHtml) {
        inMaintenance = true;
        setMaintenance(true);
      } else if (inMaintenance && response.ok) {
        const health = await response.json().catch(() => null);
        if (health?.status === "ok") {
          inMaintenance = false;
          setMaintenance(false);
          toast("Atualização concluída. Sua aba foi preservada. Salve qualquer alteração pendente antes de recarregar o site.");
        }
      }
    } catch {
      // A transient network outage is not proof of server maintenance.
      // If maintenance was already detected, retain the overlay until health returns.
    } finally {
      checking = false;
    }
  }
  window.setInterval(check, 8000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.addEventListener("online", () => void check());
  void check();
}
