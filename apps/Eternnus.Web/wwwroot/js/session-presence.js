import { api } from "./api.js";
import { navigate, toast } from "./ui.js";

// O mestre pode preparar recursos/editar fichas sem abandonar uma one-shot aberta.
// A tela que inicia este recurso entrega sua limpeza ao roteador.
export function keepMasterPresence(campaign) {
  if (!campaign?.isOneShot || !campaign.isMaster || !campaign.activeSession) return () => {};
  let disposed = false, pending = false;
  const controller = new AbortController();
  const beat = async () => {
    if (disposed || pending) return;
    pending = true;
    try { await api(`/sessions/${campaign.activeSession.id}/heartbeat`, "POST", undefined, { background: true, signal: controller.signal }); }
    catch (error) {
      if (!disposed && [404, 410].includes(error.status)) { cleanup(); toast("A one-shot foi encerrada."); navigate("one-shot"); }
    } finally { pending = false; }
  };
  const timer = setInterval(beat, 20000);
  function cleanup() { disposed = true; clearInterval(timer); controller.abort(); }
  beat();
  return cleanup;
}
