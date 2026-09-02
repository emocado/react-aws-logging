# PowerShell Teardown / Destroy Script

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Red
Write-Host "Tearing Down AWS CloudWatch RUM & S3 Prototype" -ForegroundColor Red
Write-Host "==========================================" -ForegroundColor Red

Push-Location "$PSScriptRoot\..\terraform"
try {
    terraform destroy -auto-approve
}
finally {
    Pop-Location
}

Write-Host "`nAll AWS resources have been destroyed cleanly." -ForegroundColor Green
