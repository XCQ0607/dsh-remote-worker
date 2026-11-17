$ErrorActionPreference='Stop'
$candidates = @(
  @{ h='stun.miwifi.com';        p=3478 },
  @{ h='stun.chat.bilibili.com'; p=3478 },
  @{ h='stun.hitv.com';          p=3478 },
  @{ h='stun.douyucdn.cn';       p=18000 },
  @{ h='stun.qq.com';            p=3478 },
  @{ h='stun.cloudflare.com';    p=443 }
)
function T { param([string]$H,[int]$P)
  $u=$null; try { $u=New-Object System.Net.Sockets.UdpClient; $u.Client.ReceiveTimeout=1500; $u.Connect($H,$P)
    $tx=[guid]::NewGuid().ToByteArray()[0..11]; $q=[byte[]]@(0,1,0,0,0x21,0x12,0xA4,0x42)+$tx; [void]$u.Send($q,$q.Length)
    $ep=New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any,0); $r=$u.Receive([ref]$ep)
    if ($r.Length -ge 20 -and $r[0] -eq 1 -and $r[1] -eq 1) { return 'OK' } return 'BAD' }
  catch { return 'FAIL' } finally { if($u){$u.Dispose()} } }
foreach ($c in $candidates) { $ok=0; for($i=0;$i -lt 3;$i++){ if((T -H $c.h -P $c.p) -eq 'OK'){$ok++} }; '{0}:{1} ok={2}/3' -f $c.h,$c.p,$ok }