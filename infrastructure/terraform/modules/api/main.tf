# The REST API: one Lambda behind an API Gateway HTTP API ($default route;
# the Lambda's own router handles paths). Code: services/api.

terraform {
  required_providers {
    aws     = { source = "hashicorp/aws" }
    archive = { source = "hashicorp/archive" }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  admin_password_parameter_arn = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.admin_password_parameter_name}"
}

# Built beforehand with `npm run build -w @olu/api` (services/api/dist/lambda).
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = var.lambda_source_dir
  output_path = "${path.root}/.terraform-build/${var.name}-api.zip"
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.name}-api"
  description      = "Our Little Universe REST API (${var.environment})"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"] # cheaper per GB-second than x86
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = var.memory_mb
  timeout          = 10

  # -1 means "no reservation". A small number caps cost and blast radius,
  # but new AWS accounts may not have enough concurrency to reserve.
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      ENVIRONMENT                   = var.environment
      EVENT_ID                      = var.event_id
      EVENT_NAME                    = var.event_name
      REPOSITORY                    = "dynamodb"
      TABLE_NAME                    = var.table_name
      PUBLIC_APP_URL                = var.public_app_url
      ADMIN_PASSWORD_HASH_PARAMETER = var.admin_password_parameter_name
      ADMIN_SESSION_HOURS           = tostring(var.admin_session_hours)
      LOG_LEVEL                     = var.log_level
      NODE_OPTIONS                  = "--enable-source-maps"
    }
  }

  logging_config {
    log_format = "Text" # the app already writes one JSON object per line
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.lambda]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name}-api"
  protocol_type = "HTTP"
  description   = "Our Little Universe REST API (${var.environment})"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 600
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

# Explicit GET and POST routes rather than a catch-all $default route: with
# $default, the browser's CORS preflight (OPTIONS) is sent to the Lambda
# instead of being answered by API Gateway, and every cross-origin POST fails.
# With no route for OPTIONS, API Gateway answers preflights from the CORS
# configuration above.
resource "aws_apigatewayv2_route" "proxy" {
  for_each = toset(["GET /{proxy+}", "POST /{proxy+}"])

  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.throttle_rate_per_second
    throttling_burst_limit = var.throttle_burst
  }

  # Deliberately without client IP addresses or user agents (privacy).
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId = "$context.requestId"
      time      = "$context.requestTimeEpoch"
      method    = "$context.httpMethod"
      path      = "$context.path"
      status    = "$context.status"
      latencyMs = "$context.responseLatency"
      error     = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
