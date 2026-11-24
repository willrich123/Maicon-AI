import { readFileSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as pausa } from "node:timers/promises";
import {ambienteHeadcargo} from '../ambienteHeadcargo.js';

// Executar uma instância dentro de cada sessão Windows dedicada ao portal.
if (process.platform !== "win32") throw new Error("O agente HeadCargo exige Windows.");
const id = process.env.HC_PONTE_AGENTE_ID;
const token = process.env.HC_PONTE_AGENTE_TOKEN;
const destino = new URL(process.env.HC_PONTE_GATEWAY || "https://localhost:5173");
if (destino.protocol !== "https:" || destino.username || destino.password || destino.pathname !== "/" || destino.search || destino.hash) throw new Error("Configure um gateway HTTPS válido.");
if (!/^[\w-]{1,64}$/.test(id || "") || !token || token.length < 32 || !process.env.HC_PONTE_PERFIL) throw new Error("Configure ID, token e arquivo de perfil do agente.");
const perfil = JSON.parse(readFileSync(process.env.HC_PONTE_PERFIL, "utf8").replace(/^\uFEFF/, ""));
if (!perfil.executavel || !perfil.identidade?.modelo?.includes("{usuario}")) throw new Error("Perfil sem executável ou confirmação de identidade.");
if(process.env.HC_AMBIENTE==='homologacao'&&perfil.executavel.replaceAll('/','\\').toLowerCase()!==ambienteHeadcargo().executavel.toLowerCase())throw new Error('O perfil do agente não corresponde ao executável de homologação configurado.');
const sessionId = execFileSync("powershell.exe", ["-NoProfile", "-Command", "[System.Diagnostics.Process]::GetCurrentProcess().SessionId"], { windowsHide: true, encoding: "utf8", timeout: 10000 }).trim();
const desktop = `${hostname()}:${sessionId}`;
const script = fileURLToPath(new URL("./tela.ps1", import.meta.url));
console.log(`Agente ${id}: desktop ${desktop}. Aguardando tarefas.`);

async function api(caminho, body) {
  const r = await fetch(new URL(`/api/ponte/agentes/${id}/${caminho}`, destino), {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-desktop": desktop },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("Gateway recusou a comunicação do agente.");
  return r.json();
}
function executar(tarefa) {
  return new Promise(resolve => {
    // Credenciais somente em stdin; nunca em argumentos, ambiente do filho ou logs.
    const filho = execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      windowsHide: true, timeout: 21000, maxBuffer: 4 * 1024 * 1024,
    }, (erro, stdout) => {
      if (erro) return resolve({ ok: false });
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, "").trim())); } catch { resolve({ ok: false }); }
    });
    filho.stdin.on("error", () => {});
    filho.stdin.end(JSON.stringify({ tarefa, perfil }));
  });
}
// Arquivo de trava mantido por handle exclusivo no próprio script PowerShell:
// duas cópias do agente não podem operar o mesmo desktop ao mesmo tempo.
for (;;) {
  try {
    const { tarefa } = await api("proximo", {});
    if (tarefa) {
      const resultado = await executar(tarefa);
      delete tarefa.senha;
      // Falha de entrega não repete a ação nativa. O gateway isola o resultado incerto.
      await api("resultado", { id: tarefa.id, resultado });
    }
  } catch { console.error("Comunicação indisponível. Nenhuma operação será repetida."); }
  await pausa(600);
}
