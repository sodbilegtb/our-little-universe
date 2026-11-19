mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "eu-central-1", name = "eu-central-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-central-1:123456789012:log-group:/aws/lambda/olu-test-api" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/olu-test-api" }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      api_endpoint  = "https://abc123.execute-api.eu-central-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:eu-central-1:123456789012:abc123"
    }
  }
}

mock_provider "archive" {}

variables {
  name                          = "olu-test"
  environment                   = "dev"
  event_id                      = "test-event"
  table_name                    = "olu-test-events"
  table_arn                     = "arn:aws:dynamodb:eu-central-1:123456789012:table/olu-test-events"
  lambda_source_dir             = "./does-not-matter-with-mocks"
  public_app_url                = "https://main.d1example.amplifyapp.com"
  allowed_origins               = ["https://main.d1example.amplifyapp.com"]
  admin_password_parameter_name = "/olu/test/admin-password-hash"
}

run "lambda_configuration" {
  command = apply

  assert {
    condition     = aws_lambda_function.api.runtime == "nodejs22.x" && aws_lambda_function.api.architectures == tolist(["arm64"])
    error_message = "Node.js 22 on ARM (Graviton)."
  }

  assert {
    condition     = !contains(keys(one(aws_lambda_function.api.environment).variables), "ADMIN_PASSWORD_HASH")
    error_message = "The password hash must not be in the Lambda configuration."
  }

  assert {
    condition     = one(aws_lambda_function.api.environment).variables["ADMIN_PASSWORD_HASH_PARAMETER"] == "/olu/test/admin-password-hash"
    error_message = "The hash is read from SSM."
  }

  assert {
    condition     = !contains(keys(one(aws_lambda_function.api.environment).variables), "DEV_ROUTES")
    error_message = "Development routes must never be enabled in AWS."
  }

  assert {
    condition     = one(aws_lambda_function.api.environment).variables["REPOSITORY"] == "dynamodb" && one(aws_lambda_function.api.environment).variables["ENVIRONMENT"] == "dev"
    error_message = "Deployed environments use DynamoDB."
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda.retention_in_days == 14 && aws_cloudwatch_log_group.access.retention_in_days == 14
    error_message = "Logs must not be kept forever."
  }
}

run "least_privilege_iam" {
  command = apply

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.lambda.policy).Statement : s.Resource != "*"
    ])
    error_message = "Every statement must be scoped to specific resources."
  }

  assert {
    condition = length(setintersection(
      toset(flatten([for s in jsondecode(aws_iam_role_policy.lambda.policy).Statement : s.Action])),
      toset(["dynamodb:*", "dynamodb:Scan", "dynamodb:DeleteTable", "dynamodb:CreateTable", "dynamodb:UpdateTable", "ssm:*", "ssm:PutParameter"]),
    )) == 0
    error_message = "No wildcards, scans, table management or parameter writes."
  }

  assert {
    condition = contains(
      [for s in jsondecode(aws_iam_role_policy.lambda.policy).Statement : s.Resource if s.Sid == "HostPasswordHash"],
      "arn:aws:ssm:eu-central-1:123456789012:parameter/olu/test/admin-password-hash",
    )
    error_message = "SSM access is limited to the one parameter."
  }
}

run "api_gateway" {
  command = apply

  assert {
    condition     = one(aws_apigatewayv2_api.http.cors_configuration).allow_origins == toset(["https://main.d1example.amplifyapp.com"])
    error_message = "CORS only for the web app."
  }

  assert {
    condition     = one(aws_apigatewayv2_stage.default.default_route_settings).throttling_rate_limit == 300 && one(aws_apigatewayv2_stage.default.default_route_settings).throttling_burst_limit == 600
    error_message = "The API must be throttled."
  }

  assert {
    condition     = !strcontains(one(aws_apigatewayv2_stage.default.access_log_settings).format, "sourceIp")
    error_message = "Access logs must not record client IP addresses."
  }

  assert {
    condition     = keys(aws_apigatewayv2_route.proxy) == ["GET /{proxy+}", "POST /{proxy+}"]
    error_message = "Only GET and POST reach the Lambda; API Gateway must answer CORS preflights (OPTIONS) itself. A $default route would swallow them."
  }

  assert {
    condition     = aws_apigatewayv2_integration.lambda.payload_format_version == "2.0"
    error_message = "The handler expects payload format 2.0."
  }
}

run "rejects_wildcard_cors" {
  command = plan

  variables {
    allowed_origins = ["*"]
  }

  expect_failures = [var.allowed_origins]
}

run "rejects_unknown_environment" {
  command = plan

  variables {
    environment = "staging"
  }

  expect_failures = [var.environment]
}
