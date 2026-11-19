# Wiring test for the whole dev stack with mocked AWS: nothing is created.

mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "eu-central-1", name = "eu-central-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_resource "aws_amplify_app" {
    defaults = { default_domain = "d1example.amplifyapp.com" }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      api_endpoint  = "https://abc123.execute-api.eu-central-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:eu-central-1:123456789012:abc123"
    }
  }
  mock_resource "aws_dynamodb_table" {
    defaults = { arn = "arn:aws:dynamodb:eu-central-1:123456789012:table/olu-dev-events" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-central-1:123456789012:log-group:/aws/lambda/olu-dev-api" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/olu-dev-api" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-central-1:123456789012:key/11111111-2222-3333-4444-555555555555" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:eu-central-1:123456789012:function:olu-dev-fn"
      invoke_arn = "arn:aws:apigateway:eu-central-1:lambda:path/2015-03-31/functions/arn:aws:lambda:eu-central-1:123456789012:function:olu-dev-fn/invocations"
    }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-central-1:123456789012:olu-dev-alarms" }
  }
}

mock_provider "archive" {}

variables {
  budget_email = "budget@example.com"
}

run "dev_stack" {
  command = apply

  assert {
    condition     = output.app_url == "https://main.d1example.amplifyapp.com"
    error_message = "The web app URL."
  }

  assert {
    condition     = output.table_name == "olu-dev-events"
    error_message = "The dev table is separate from prod by name."
  }

  assert {
    condition     = output.admin_password_parameter == "/olu/dev/admin-password-hash"
    error_message = "The password parameter path is per environment."
  }

  assert {
    condition     = module.api.throttling.rate == 300 && module.api.throttling.burst == 600
    error_message = "The dev API allows about 150 phones."
  }

  assert {
    condition     = output.secrets_table_name == "olu-dev-secrets" && output.table_name != output.secrets_table_name
    error_message = "Secrets have their own table."
  }

  assert {
    condition     = output.api_endpoint == "https://abc123.execute-api.eu-central-1.amazonaws.com"
    error_message = "The API endpoint is exported for the web build."
  }
}
