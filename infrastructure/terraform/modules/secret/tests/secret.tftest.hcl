mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "eu-central-1", name = "eu-central-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/olu-test-role" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-central-1:123456789012:key/11111111-2222-3333-4444-555555555555" }
  }
  mock_resource "aws_dynamodb_table" {
    defaults = { arn = "arn:aws:dynamodb:eu-central-1:123456789012:table/olu-test-secrets" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-central-1:123456789012:log-group:/aws/lambda/olu-test" }
  }
}

mock_provider "archive" {}

variables {
  name              = "olu-test"
  environment       = "dev"
  event_id          = "rehearsal-1"
  reveal_mode       = "TEST"
  events_table_name = "olu-test-events"
  events_table_arn  = "arn:aws:dynamodb:eu-central-1:123456789012:table/olu-test-events"
  mailer_source_dir = "./unused-with-mocks"
  reveal_source_dir = "./unused-with-mocks"
  public_app_url    = "https://main.d1example.amplifyapp.com"
  email_sender      = "reveal@example.com"
  email_recipients  = ["parent@example.com"]
  ses_identity_arns = ["arn:aws:ses:eu-central-1:123456789012:identity/reveal@example.com"]
}

run "the_key_and_who_may_open_what" {
  command = apply

  assert {
    condition     = aws_kms_key.secret.enable_key_rotation
    error_message = "The key rotates yearly."
  }

  assert {
    condition = length([
      for s in jsondecode(aws_kms_key.secret.policy).Statement : s
      if s.Effect == "Deny" && s.Condition.StringEquals["kms:EncryptionContext:purpose"] == "doctor-selection"
    ]) == 1
    error_message = "The key policy denies opening the answer to everyone but the reveal role."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.mailer.policy).Statement :
      s.Condition.StringEquals["kms:EncryptionContext:purpose"] == "reveal-code" if s.Action == "kms:Decrypt"
    ])
    error_message = "The mailer may open codes only."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.reveal.policy).Statement :
      s.Condition.StringEquals["kms:EncryptionContext:purpose"] == "doctor-selection" if s.Action == "kms:Decrypt"
    ])
    error_message = "The reveal service may open the answer only."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.reveal.policy).Statement :
      s.Condition.StringEquals["kms:EncryptionContext:eventId"] == "rehearsal-1" && s.Condition.StringEquals["kms:EncryptionContext:environment"] == "dev"
      if s.Action == "kms:Decrypt"
    ])
    error_message = "Decryption is bound to this environment and event."
  }
}

run "attribute_level_table_access" {
  command = apply

  assert {
    condition = !contains(flatten([
      for s in jsondecode(aws_iam_role_policy.mailer.policy).Statement :
      try(s.Condition["ForAllValues:StringEquals"]["dynamodb:Attributes"], [])
    ]), "choiceCiphertext")
    error_message = "The mailer can't even read the sealed answer."
  }

  assert {
    condition = !contains(flatten([
      for s in jsondecode(aws_iam_role_policy.reveal.policy).Statement :
      try(s.Condition["ForAllValues:StringEquals"]["dynamodb:Attributes"], [])
    ]), "codeCiphertext")
    error_message = "The reveal service can't read the sealed code."
  }

  assert {
    condition = length(setintersection(
      toset(flatten([for s in concat(jsondecode(aws_iam_role_policy.mailer.policy).Statement, jsondecode(aws_iam_role_policy.reveal.policy).Statement) : s.Action])),
      toset(["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "kms:Encrypt", "kms:*", "dynamodb:*"]),
    )) == 0
    error_message = "Neither role can create, delete, list or scan items, nor encrypt."
  }

  assert {
    condition = length([
      for s in jsondecode(aws_iam_role_policy.reveal.policy).Statement : s if s.Action == "dynamodb:UpdateItem"
    ]) == 0
    error_message = "The reveal service is read-only."
  }
}

run "mailer_and_reveal_configuration" {
  command = apply

  assert {
    condition     = aws_lambda_function_event_invoke_config.mailer.maximum_retry_attempts == 2
    error_message = "A failed send is retried twice (with the same code)."
  }

  assert {
    condition     = one(aws_lambda_function.mailer.environment).variables["EMAIL_RECIPIENTS"] == "parent@example.com"
    error_message = "Recipients reach the mailer."
  }

  assert {
    condition     = one(aws_lambda_function.reveal.environment).variables["REVEAL_MODE"] == "TEST"
    error_message = "The mode comes from Terraform, never from a client."
  }

  assert {
    condition     = aws_dynamodb_table.secrets.name != var.events_table_name
    error_message = "Secrets live in their own table."
  }
}

run "no_email_configured" {
  command = apply

  variables {
    email_sender      = ""
    email_recipients  = []
    ses_identity_arns = []
  }

  assert {
    condition     = length([for s in jsondecode(aws_iam_role_policy.mailer.policy).Statement : s if s.Action == "ses:SendEmail"]) == 0
    error_message = "Without identities the mailer can't send anything."
  }
}
