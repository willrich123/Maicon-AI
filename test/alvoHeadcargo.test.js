import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('seleção do bot verifica caminho, sessão e acesso ao executável', {skip:process.platform!=='win32'},()=>{
 const script=`. ./server/alvoHeadcargo.ps1
 $esperado='C:\\homolog\\Homologação.exe'
 $candidatos=@([pscustomobject]@{Id=1;SessionId=1;Path=$esperado},[pscustomobject]@{Id=2;SessionId=1;Path='C:\\producao\\Desktop.exe'},[pscustomobject]@{Id=3;SessionId=2;Path=$esperado})
 $r=@(Selecionar-ProcessosHeadCargo $candidatos $esperado 1)
 if($r.Count -ne 1 -or $r[0].Id -ne 1){throw 'Seleção incorreta'}
 try { Selecionar-ProcessosHeadCargo @([pscustomobject]@{SessionId=1;Path=$null}) $esperado 1; throw 'Falha: aceitou caminho desconhecido' } catch { if($_.Exception.Message -notmatch 'detectado.*Windows'){throw} }
 'OK'
 `;
 const r=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true});
 assert.match(r,/OK/);
});
