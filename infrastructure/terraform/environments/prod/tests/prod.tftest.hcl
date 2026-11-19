# Wiring test for the production stack with mocked AWS: nothing is created.

mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "eu-central-1", name = "eu-central-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_sesv2_email_identity" {
    defaults = {
      arn                         = "arn:aws:ses:eu-central-1:123456789012:identity/example.com"
      verified_for_sending_status = true
      dkim_signing_attributes     = [{ tokens = ["a", "b", "c"] }]
    }
  }
  mock_resource "aws_amplify_app" {
    defaults = { default_domain = "d2example.amplifyapp.com" }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      api_endpoint  = "https://prod123.execute-api.eu-central-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:eu-central-1:123456789012:prod123"
    }
  }
  mock_resource "aws_dynamodb_table" {
    defaults = { arn = "arn:aws:dynamodb:eu-central-1:123456789012:table/olu-prod-events" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-central-1:123456789012:log-group:/aws/lambda/olu-prod-api" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/olu-prod-api" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-central-1:123456789012:key/11111111-2222-3333-4444-555555555555" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:eu-central-1:123456789012:function:olu-prod-fn"
      invoke_arn = "arn:aws:apigateway:eu-central-1:lambda:path/2015-03-31/functions/arn:aws:lambda:eu-central-1:123456789012:function:olu-prod-fn/invocations"
    }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-central-1:123456789012:olu-prod-alarms" }
  }
}

mock_provider "archive" {}

variables {
  reveal_mode         = "LIVE"
  event_id            = "baby-reveal"
  alarm_email         = "host@example.com"
  budget_email        = "host@example.com"
  email_sender        = "reveal@example.com"
  email_sender_domain = "example.com"
  email_recipients    = ["parent@example.com"]
}

run "live_stack" {
  command = apply

  assert {
    condition     = output.table_name == "olu-prod-events" && output.secrets_table_name == "olu-prod-secrets"
    error_message = "Production has its own tables."
  }

  assert {
    condition     = output.admin_password_parameter == "/olu/prod/admin-password-hash"
    error_message = "Production has its own host password."
  }

  assert {
    condition = (
      module.api.lambda_environment["REVEAL_MODE"] == "LIVE" &&
      module.secret.mailer_environment["REVEAL_MODE"] == "LIVE" &&
      module.secret.mailer_environment["ENVIRONMENT"] == "prod"
    )
    error_message = "The mode written in tfvars reaches every Lambda."
  }

  assert {
    condition     = module.database.deletion_protection && module.secret.deletion_protection
    error_message = "Production tables refuse deletion."
  }

  assert {
    condition     = length(module.email.identity_arns) == 2 && !module.email.dns_records_managed
    error_message = "Prod reuses dev's SES identities and writes no DNS records of its own."
  }

  assert {
    condition     = toset(module.api.allowed_origins) == toset(["https://main.d2example.amplifyapp.com"])
    error_message = "Only the production web app may call the production API (no localhost)."
  }
}

run "rejects_a_lowercase_or_unknown_mode" {
  command = plan

  variables {
    reveal_mode = "live"
  }

  expect_failures = [var.reveal_mode]
}

run "needs_someone_to_hear_the_alarms" {
  command = plan

  variables {
    alarm_email = ""
  }

  expect_failures = [var.alarm_email]
}

run "needs_a_recipient_for_the_official_code" {
  command = plan

  variables {
    email_recipients = []
  }

  expect_failures = [var.email_recipients]
}

run "deletion_protection_comes_off_only_on_purpose" {
  command = apply

  variables {
    allow_destroy = true
  }

  assert {
    condition     = !module.database.deletion_protection && !module.secret.deletion_protection
    error_message = "allow_destroy turns the protection off, for the teardown after the party."
  }
}
