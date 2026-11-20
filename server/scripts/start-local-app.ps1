$ErrorActionPreference = "Stop"

$workspaceDirectory = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$serverDirectory = Join-Path $workspaceDirectory "server"
$clientDirectory = Join-Path $workspaceDirectory "client"
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source

try {
    Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/auth/me" -TimeoutSec 2 -UseBasicParsing |
        Out-Null
    $serverProcess = $null
}
catch {
    $serverProcess = Start-Process `
        -FilePath $npmCommand `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory $serverDirectory `
        -PassThru `
        -WindowStyle Hidden
}

$clientListeners = @(
    Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
)
if ($clientListeners.Count -gt 0) {
    if (-not ($clientListeners | Where-Object { $_.LocalAddress -in @("0.0.0.0", "::") })) {
        throw "Vite is already running on localhost only. Stop it and run this task again for phone access."
    }
    $clientProcess = $null
}
else {
    $clientProcess = Start-Process `
        -FilePath $npmCommand `
        -ArgumentList @("run", "dev", "--", "--host", "0.0.0.0") `
        -WorkingDirectory $clientDirectory `
        -PassThru `
        -WindowStyle Hidden
}

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $frontend = Invoke-WebRequest `
            -Uri "http://127.0.0.1:5173/" `
            -TimeoutSec 2 `
            -UseBasicParsing
        $api = Invoke-WebRequest `
            -Uri "http://127.0.0.1:3000/api/auth/me" `
            -TimeoutSec 2 `
            -UseBasicParsing

        Write-Output "Frontend: HTTP $([int]$frontend.StatusCode)"
        Write-Output "API: HTTP $([int]$api.StatusCode) (local only)"
        $localAddresses = Get-NetIPConfiguration |
            Where-Object { $_.NetAdapter.Status -eq "Up" } |
            ForEach-Object { $_.IPv4Address.IPAddress } |
            Where-Object {
                $_ -and $_ -notlike "127.*" -and $_ -notlike "169.254.*"
            } |
            Select-Object -Unique

        if ($localAddresses) {
            foreach ($address in $localAddresses) {
                Write-Output ("Phone on the same Wi-Fi: http://" + $address + ":5173/login")
            }
        }
        else {
            Write-Output "No LAN IPv4 address found. Connect this computer to Wi-Fi."
        }

        exit 0
    }
    catch {
        if (
            ($null -ne $serverProcess -and $serverProcess.HasExited) -or
            ($null -ne $clientProcess -and $clientProcess.HasExited)
        ) {
            throw "The server or client stopped during startup."
        }
        Start-Sleep -Seconds 1
    }
}

throw "The application or API did not start within 30 seconds."
