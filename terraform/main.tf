terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Unique suffix for S3 bucket & domain naming
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

locals {
  bucket_name = "${var.project_name}-${var.environment}-${random_string.suffix.result}"
}

# ==============================================================================
# S3 Static Website Hosting
# ==============================================================================

resource "aws_s3_bucket" "website" {
  bucket        = local.bucket_name
  force_destroy = true

  tags = {
    Name        = "${var.project_name}-bucket"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_website_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html" # SPA fallback
  }
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket = aws_s3_bucket.website.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "public_read" {
  bucket     = aws_s3_bucket.website.id
  depends_on = [aws_s3_bucket_public_access_block.website]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.website.arn}/*"
      }
    ]
  })
}

# ==============================================================================
# AWS CloudWatch RUM AppMonitor (No Cookies Mode)
# ==============================================================================

resource "aws_rum_app_monitor" "rum_monitor" {
  name   = "${var.project_name}-${var.environment}"
  domain = aws_s3_bucket_website_configuration.website.website_endpoint

  app_monitor_configuration {
    allow_cookies       = false # Cookies disabled per requirements
    enable_xray         = true
    session_sample_rate = 1.0
    telemetries         = ["errors", "performance", "http"]
  }

  custom_events {
    status = "ENABLED"
  }

  cw_log_enabled = true

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# ==============================================================================
# AWS Lambda Telemetry Backend Proxy (Direct Function URL - No ALB / API Gateway)
# ==============================================================================

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/index.mjs"
  output_path = "${path.module}/lambda_dist.zip"
}

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-${var.environment}-lambda-role-${random_string.suffix.result}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_rum_policy" {
  name = "${var.project_name}-${var.environment}-lambda-rum-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "rum:PutRumEvents"
        ]
        Resource = [
          aws_rum_app_monitor.rum_monitor.arn,
          "arn:aws:rum:${var.aws_region}:*:appmonitor/${aws_rum_app_monitor.rum_monitor.name}"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_lambda_function" "rum_proxy" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "${var.project_name}-${var.environment}-rum-proxy"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      RUM_APP_MONITOR_ID   = aws_rum_app_monitor.rum_monitor.app_monitor_id
      RUM_APP_MONITOR_NAME = aws_rum_app_monitor.rum_monitor.name
      AWS_REGION_NAME      = var.aws_region
    }
  }

  tags = {
    Environment = var.environment
  }
}

# Direct HTTP Function URL (Auth: NONE, with CORS)
resource "aws_lambda_function_url" "rum_proxy_url" {
  function_name      = aws_lambda_function.rum_proxy.function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["*"]
    allow_headers     = ["*"]
    max_age           = 300
  }
}

resource "aws_lambda_permission" "url_permission" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.rum_proxy.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# ==============================================================================
# Amazon Cognito User Pool & Hosted UI (Managed Authentication)
# ==============================================================================

resource "aws_cognito_user_pool" "pool" {
  name = "${var.project_name}-${var.environment}-userpool"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = {
    Environment = var.environment
  }
}

# Domain name cannot contain reserved word 'aws'
resource "aws_cognito_user_pool_domain" "hosted_ui_domain" {
  domain       = "rum-app-auth-${random_string.suffix.result}"
  user_pool_id = aws_cognito_user_pool.pool.id
}

resource "aws_cognito_user_pool_client" "client" {
  name         = "${var.project_name}-${var.environment}-web-client"
  user_pool_id = aws_cognito_user_pool.pool.id

  generate_secret = false # Public client for SPA in browser

  allowed_oauth_flows                  = ["implicit", "code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [
    "https://${aws_s3_bucket_website_configuration.website.website_endpoint}",
    "http://localhost:5173",
    "http://localhost:3000"
  ]

  logout_urls = [
    "https://${aws_s3_bucket_website_configuration.website.website_endpoint}",
    "http://localhost:5173",
    "http://localhost:3000"
  ]
}

# Seeded Demo Test User for instant evaluation
resource "aws_cognito_user" "demo_user" {
  user_pool_id   = aws_cognito_user_pool.pool.id
  username       = "testuser@example.com"
  password       = "P@ssword123!"
  message_action = "SUPPRESS"

  attributes = {
    email          = "testuser@example.com"
    email_verified = "true"
    name           = "Test User"
  }
}
