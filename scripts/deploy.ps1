# PowerShell Deployment Script for AWS CloudWatch RUM & React S3 Hosting

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "1. Provisioning Infrastructure with Terraform" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Push-Location "$PSScriptRoot\..\terraform"
try {
    terraform init
    terraform apply -auto-approve
    
    $outputs = (terraform output -json | Out-String | ConvertFrom-Json)
    $REGION = $outputs.aws_region.value
    $BUCKET_NAME = $outputs.s3_bucket_name.value
    $WEBSITE_URL = $outputs.s3_website_url.value
    $RUM_APP_ID = $outputs.rum_app_monitor_id.value
    $LAMBDA_URL = $outputs.lambda_proxy_function_url.value
    $COGNITO_DOMAIN = $outputs.cognito_hosted_ui_domain.value
    $COGNITO_CLIENT_ID = $outputs.cognito_user_pool_client_id.value
}
finally {
    Pop-Location
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "2. Generating Frontend Environment Variables" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$envContent = @"
VITE_AWS_REGION=$REGION
VITE_AWS_RUM_APPLICATION_ID=$RUM_APP_ID
VITE_LAMBDA_PROXY_URL=$LAMBDA_URL
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
"@

$envFile = "$PSScriptRoot\..\frontend\.env.production"
Set-Content -Path $envFile -Value $envContent
Write-Host "Generated $envFile successfully." -ForegroundColor Green

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "3. Building React Application" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Push-Location "$PSScriptRoot\..\frontend"
try {
    npm run build
}
finally {
    Pop-Location
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "4. Deploying build to S3 Static Website" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

aws s3 sync "$PSScriptRoot\..\frontend\dist" "s3://$BUCKET_NAME" --delete --region "$REGION"

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "Website URL: $WEBSITE_URL" -ForegroundColor Yellow
Write-Host "RUM AppMonitor: $RUM_APP_ID" -ForegroundColor Cyan
Write-Host "CloudWatch Log Group: /aws/rum/$RUM_APP_ID" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Green
