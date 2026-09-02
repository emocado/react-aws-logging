output "aws_region" {
  description = "AWS Region deployed to"
  value       = var.aws_region
}

output "s3_bucket_name" {
  description = "Name of the S3 static hosting bucket"
  value       = aws_s3_bucket.website.id
}

output "s3_website_endpoint" {
  description = "Direct HTTP S3 website endpoint"
  value       = aws_s3_bucket_website_configuration.website.website_endpoint
}

output "s3_website_url" {
  description = "Formatted URL of the website"
  value       = "http://${aws_s3_bucket_website_configuration.website.website_endpoint}"
}

output "rum_app_monitor_id" {
  description = "CloudWatch RUM AppMonitor ID"
  value       = aws_rum_app_monitor.rum_monitor.app_monitor_id
}

output "rum_app_monitor_arn" {
  description = "CloudWatch RUM AppMonitor ARN"
  value       = aws_rum_app_monitor.rum_monitor.arn
}

output "rum_cw_log_group" {
  description = "CloudWatch Log Group name for RUM telemetry"
  value       = "/aws/rum/${aws_rum_app_monitor.rum_monitor.name}"
}

output "lambda_proxy_function_url" {
  description = "Direct HTTP Lambda Function URL for RUM telemetry proxy"
  value       = aws_lambda_function_url.rum_proxy_url.function_url
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.pool.id
}

output "cognito_user_pool_client_id" {
  description = "Cognito User Pool Web Client ID"
  value       = aws_cognito_user_pool_client.client.id
}

output "cognito_hosted_ui_domain" {
  description = "Cognito Hosted UI Domain prefix"
  value       = "https://${aws_cognito_user_pool_domain.hosted_ui_domain.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_login_url" {
  description = "Direct URL to open Cognito Hosted UI Login"
  value       = "https://${aws_cognito_user_pool_domain.hosted_ui_domain.domain}.auth.${var.aws_region}.amazoncognito.com/login?client_id=${aws_cognito_user_pool_client.client.id}&response_type=token&scope=email+openid+profile&redirect_uri=http://${aws_s3_bucket_website_configuration.website.website_endpoint}"
}

output "demo_test_user_email" {
  description = "Pre-seeded test user email"
  value       = "testuser@example.com"
}

output "demo_test_user_password" {
  description = "Pre-seeded test user password"
  value       = "P@ssword123!"
}
