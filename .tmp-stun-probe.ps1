$ErrorActionPreference = 'Stop'
$candidates = @(
  @{ h='stun.miwifi.com';          p=3478 },
  @{ h='stun.chat.bilibili.com';   p=3478 },
  @{ h='stun.hitv.com';            p=3478 },
  @{ h='stun.douyucdn.cn';         p=18000 },
  @{ h='stun.qq.com';              p=3478 },
  @{ h='stun.cloudflare.com';      p=3478 },
  @{ h='stun.cloudflare.com';      p=443 },
  @{ h='stun.l.google.com';        p=19302 }
)
function Test-Stun {
  param([string]$HostName, [int]$Port, [int]$TimeoutMs = 1800)
  $udp = $null
  try {
    $udp = New-Object System.Net.Sockets.UdpClient
    $udp.Client.ReceiveTimeout = $TimeoutMs
    $udp.Connect($HostName, $Port)
    $txid = [guid]::NewGuid().ToByteArray()[0..11]
    $req = [byte[]]@(0x00,0x01,0x00,0x00,0x21,0x12,0xA4,0x42) + $txid
    [void]$udp.Send($req, $req.Length)
    $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $resp = $udp.Receive([ref]$ep)
    if ($resp.Length -lt 20) { return 'BAD(len=' + $resp.Length + ')' }
    $type = [int]$resp[0] * 256 + [int]$resp[1]
    if ($type -ne 0x0101) { return ('BAD(type=0x{0:X4})' -f $type) }
    $out = 'OK'
    $i = 20
    while ($i + 4 -le $resp.Length) {
      $at = [int]$resp[$i] * 256 + [int]$resp[$i+1]
      $al = [int]$resp[$i+2] * 256 + [int]$resp[$i+3]
      if ($at -eq 0x0020 -and $al -ge 8) {
        $portX = ([int]$resp[$i+6] * 256 + [int]$resp[$i+7]) -bxor 0x2112
        $o1 = ([int]$resp[$i+8]) -bxor 0x21
        $o2 = ([int]$resp[$i+9]) -bxor 0x12
        $o3 = ([int]$resp[$i+10]) -bxor 0xA4
        $o4 = ([int]$resp[$i+11]) -bxor 0x42
        $out = $out + ' mapped=' + $o1 + '.' + $o2 + '.' + $o3 + '.' + $o4 + ':' + $portX
      }
      $i += 4 + $al
    }
    return $out
  } catch {
    $m = $_.Exception.Message
    if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
    return 'FAIL: ' + $m
  } finally {
    if ($udp) { $udp.Dispose() }
  }
}
foreach ($c in $candidates) {
  $dns = 'dns-fail'
  try { $dns = ([System.Net.Dns]::GetHostAddresses($c.h) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1).IPAddressToString } catch { }
  $r = Test-Stun -HostName $c.h -Port $c.p
  '{0}:{1}  dns={2}  =>  {3}' -f $c.h, $c.p, $dns, $r
}