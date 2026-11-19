# Least privilege, per role and down to the attributes each may touch.
# Attribute lists must match the ProjectionExpression/UpdateExpression names in
# services/api/src/secret/DynamoSecretStore.ts.

locals {
  assume_lambda = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })

  mailer_read_attributes   = ["pk", "sk", "codeCiphertext", "status"]
  mailer_update_attributes = ["pk", "sk", "emailStatus", "emailLastAttemptAt", "emailAttempts", "emailSentAt", "emailMessageId", "emailLastError"]
  reveal_read_attributes   = ["pk", "sk", "choiceCiphertext", "status"]
  reveal_state_attributes  = ["pk", "sk", "data"]
}

/* ---------- mailer ---------- */

resource "aws_iam_role" "mailer" {
  name               = "${var.name}-mailer"
  assume_role_policy = local.assume_lambda
}

resource "aws_iam_role_policy" "mailer" {
  name = "${var.name}-mailer"
  role = aws_iam_role.mailer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid      = "ReadSealedCode"
          Effect   = "Allow"
          Action   = "dynamodb:GetItem"
          Resource = aws_dynamodb_table.secrets.arn
          Condition = {
            "ForAllValues:StringEquals" = { "dynamodb:Attributes" = local.mailer_read_attributes }
            StringEquals                = { "dynamodb:Select" = "SPECIFIC_ATTRIBUTES" }
          }
        },
        {
          Sid      = "RecordDelivery"
          Effect   = "Allow"
          Action   = "dynamodb:UpdateItem"
          Resource = aws_dynamodb_table.secrets.arn
          Condition = {
            "ForAllValues:StringEquals" = { "dynamodb:Attributes" = local.mailer_update_attributes }
            StringEqualsIfExists        = { "dynamodb:ReturnValues" = "NONE" }
          }
        },
        {
          Sid      = "OpenCodesOnly"
          Effect   = "Allow"
          Action   = "kms:Decrypt"
          Resource = aws_kms_key.secret.arn
          Condition = {
            StringEquals = merge(local.context_conditions, { "kms:EncryptionContext:purpose" = "reveal-code" })
          }
        },
        {
          Sid      = "OwnLogs"
          Effect   = "Allow"
          Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "${aws_cloudwatch_log_group.mailer.arn}:*"
        },
      ],
      var.email_transport != "ses" || length(var.ses_identity_arns) == 0 ? [] : [
        {
          Sid      = "SendAsVerifiedIdentities"
          Effect   = "Allow"
          Action   = "ses:SendEmail"
          Resource = var.ses_identity_arns
        },
      ],
      var.email_transport != "gmail" ? [] : [
        {
          # SecureString with the AWS-managed key (alias/aws/ssm): the key policy
          # already allows decryption through SSM for this account.
          Sid      = "ReadGmailAppPassword"
          Effect   = "Allow"
          Action   = "ssm:GetParameter"
          Resource = "arn:aws:ssm:${data.aws_region.current.region}:${local.account_id}:parameter${var.gmail_app_password_parameter_name}"
        },
      ],
    )
  })
}

/* ---------- reveal ---------- */

resource "aws_iam_role" "reveal" {
  name               = "${var.name}-reveal"
  assume_role_policy = local.assume_lambda
}

resource "aws_iam_role_policy" "reveal" {
  name = "${var.name}-reveal"
  role = aws_iam_role.reveal.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadEventState"
        Effect   = "Allow"
        Action   = "dynamodb:GetItem"
        Resource = var.events_table_arn
        Condition = {
          "ForAllValues:StringEquals" = { "dynamodb:Attributes" = local.reveal_state_attributes }
          StringEquals                = { "dynamodb:Select" = "SPECIFIC_ATTRIBUTES" }
        }
      },
      {
        Sid      = "ReadSealedAnswer"
        Effect   = "Allow"
        Action   = "dynamodb:GetItem"
        Resource = aws_dynamodb_table.secrets.arn
        Condition = {
          "ForAllValues:StringEquals" = { "dynamodb:Attributes" = local.reveal_read_attributes }
          StringEquals                = { "dynamodb:Select" = "SPECIFIC_ATTRIBUTES" }
        }
      },
      {
        Sid      = "OpenTheAnswerOnly"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.secret.arn
        Condition = {
          StringEquals = merge(local.context_conditions, { "kms:EncryptionContext:purpose" = "doctor-selection" })
        }
      },
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.reveal.arn}:*"
      },
    ]
  })
}
