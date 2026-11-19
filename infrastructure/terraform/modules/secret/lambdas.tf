# Built with `npm run build -w @olu/api` (services/api/dist/lambda/<name>).
data "archive_file" "mailer" {
  type        = "zip"
  source_dir  = var.mailer_source_dir
  output_path = "${path.root}/.terraform-build/${var.name}-mailer.zip"
}

data "archive_file" "reveal" {
  type        = "zip"
  source_dir  = var.reveal_source_dir
  output_path = "${path.root}/.terraform-build/${var.name}-reveal.zip"
}

resource "aws_cloudwatch_log_group" "mailer" {
  name              = "/aws/lambda/${var.name}-mailer"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "reveal" {
  name              = "/aws/lambda/${var.name}-reveal"
  retention_in_days = var.log_retention_days
}

locals {
  common_environment = {
    ENVIRONMENT        = var.environment
    EVENT_ID           = var.event_id
    EVENT_NAME         = var.event_name
    REPOSITORY         = "dynamodb"
    TABLE_NAME         = var.events_table_name
    SECRETS_TABLE_NAME = aws_dynamodb_table.secrets.name
    KMS_KEY_ARN        = aws_kms_key.secret.arn
    REVEAL_MODE        = var.reveal_mode
    LOG_LEVEL          = var.log_level
    NODE_OPTIONS       = "--enable-source-maps"
  }
}

resource "aws_lambda_function" "mailer" {
  function_name    = "${var.name}-mailer"
  description      = "Our Little Universe: emails the reveal code (${var.environment})"
  role             = aws_iam_role.mailer.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.mailer.output_path
  source_code_hash = data.archive_file.mailer.output_base64sha256
  memory_size      = 256
  timeout          = 20

  environment {
    variables = merge(local.common_environment, {
      # Config validation needs a mailer name everywhere outside local; the mailer never calls itself.
      MAILER_FUNCTION_NAME = "${var.name}-mailer"
      PUBLIC_APP_URL       = var.public_app_url
      EMAIL_SENDER         = var.email_sender
      EMAIL_RECIPIENTS     = join(",", var.email_recipients)
      EMAIL_TRANSPORT      = var.email_transport
      }, var.email_transport == "gmail" ? {
      GMAIL_APP_PASSWORD_PARAMETER = var.gmail_app_password_parameter_name
    } : {})
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.mailer.name
  }

  lifecycle {
    precondition {
      condition     = var.email_transport != "gmail" || can(regex("^/[A-Za-z0-9_./-]+$", var.gmail_app_password_parameter_name))
      error_message = "Sending through Gmail needs gmail_app_password_parameter_name (an SSM parameter name like /olu/dev/gmail-app-password)."
    }
  }

  depends_on = [aws_iam_role_policy.mailer, aws_cloudwatch_log_group.mailer]
}

# The API invokes the mailer asynchronously. A failed send is retried twice,
# and every retry sends the same code.
resource "aws_lambda_function_event_invoke_config" "mailer" {
  function_name                = aws_lambda_function.mailer.function_name
  maximum_retry_attempts       = 2
  maximum_event_age_in_seconds = 3600
}

resource "aws_lambda_function" "reveal" {
  function_name    = "${var.name}-reveal"
  description      = "Our Little Universe: releases the result at the reveal moment (${var.environment})"
  role             = aws_iam_role.reveal.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.reveal.output_path
  source_code_hash = data.archive_file.reveal.output_base64sha256
  memory_size      = 256
  timeout          = 6

  environment {
    variables = merge(local.common_environment, {
      MAILER_FUNCTION_NAME = "${var.name}-mailer"
    })
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.reveal.name
  }

  depends_on = [aws_iam_role_policy.reveal, aws_cloudwatch_log_group.reveal]
}
