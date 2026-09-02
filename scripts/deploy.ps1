# PowerShell Deployment Script for AWS CloudWatch RUM & React S3 Hosting

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "1. Provisioning Infrastructure with Terraform" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Push-Location "$PSScriptRoot\..\terraform"
try {
    terraform init
    terraform apply -auto-approve
    
    $REGION = (terraform output -raw aws_region)
    $BUCKET_NAME = (terraform output -raw s3_bucket_name)
    $WEBSITE_URL = (terraform output -raw s3_website_url)
    $RUM_APP_ID = (terraform output -raw rum_app_monitor_id)
    $LAMBDA_URL = (terraform output -raw lambda_proxy_function_url)
    $COGNITO_DOMAIN = (terraform output -raw cognito_hosted_ui_domain)
    $COGNITO_CLIENT_ID = (terraform output -raw cognito_user_pool_client_id)
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
