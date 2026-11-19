# The secret: a customer managed KMS key, a separate table for sealed answers,
# codes and doctor links, and two narrowly privileged Lambdas:
#   - mailer: opens sealed codes (never the answer) and emails them via SES;
#   - reveal: opens the answer, read-only, and only serves it from the reveal
#             moment on (GET /v1/reveal/result, routed in the api module).
# The API itself may only *encrypt* with the key (see the api module).
#
# What this does not do: an AWS account administrator can change any policy
# here, including the key policy, and then decrypt. It prevents accidental and
# unauthorized application access, not a determined account owner.

terraform {
  required_providers {
    aws     = { source = "hashicorp/aws" }
    archive = { source = "hashicorp/archive" }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # Every ciphertext is bound to these; IAM and the key policy check them.
  context_conditions = {
    "kms:EncryptionContext:environment" = var.environment
    "kms:EncryptionContext:eventId"     = var.event_id
  }
}

resource "aws_kms_key" "secret" {
  description             = "Our Little Universe (${var.environment}): seals the doctor's answer and the reveal code"
  enable_key_rotation     = true
  deletion_window_in_days = var.kms_deletion_window_days

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Required, or nobody could manage the key; also lets IAM policies grant use.
        Sid       = "AccountAdministration"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        # Even an account administrator's everyday permissions can't open the
        # answer: only the reveal Lambda may. Changing this is a deliberate act.
        Sid       = "OnlyTheRevealServiceOpensTheAnswer"
        Effect    = "Deny"
        Principal = { AWS = "*" }
        Action    = ["kms:Decrypt", "kms:ReEncryptFrom"]
        Resource  = "*"
        Condition = {
          StringEquals = { "kms:EncryptionContext:purpose" = "doctor-selection" }
          ArnNotEquals = { "aws:PrincipalArn" = aws_iam_role.reveal.arn }
        }
      },
      {
        Sid       = "OnlyTheMailerOpensTheCode"
        Effect    = "Deny"
        Principal = { AWS = "*" }
        Action    = ["kms:Decrypt", "kms:ReEncryptFrom"]
        Resource  = "*"
        Condition = {
          StringEquals = { "kms:EncryptionContext:purpose" = "reveal-code" }
          ArnNotEquals = { "aws:PrincipalArn" = aws_iam_role.mailer.arn }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "secret" {
  name          = "alias/${var.name}-secret"
  target_key_id = aws_kms_key.secret.key_id
}

resource "aws_dynamodb_table" "secrets" {
  name         = "${var.name}-secrets"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Doctor links expire on their own.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  deletion_protection_enabled = var.deletion_protection
}
