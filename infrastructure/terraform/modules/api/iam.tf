# Least privilege: the API can read and write items in its own table, write its
# own logs, and read one SSM parameter. For the secret it may store new sealed
# items, read their status (never a ciphertext), retire them, encrypt with the
# key, and ask the mailer to send. It can never decrypt. Nothing else: no Scan,
# no table management, no access to other tables or parameters.

locals {
  # Must match the ProjectionExpression names in DynamoSecretStore (API role).
  secrets_read_attributes = [
    "pk", "sk", "eventId", "linkId", "expiresAt", "selectionId", "submissionId", "status",
    "emailStatus", "emailAttempts", "emailSentAt", "emailLastError",
  ]
}

resource "aws_iam_role" "lambda" {
  name = "${var.name}-api"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
    ]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${var.name}-api"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EventItems"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = var.table_arn
      },
      {
        Sid      = "StoreSealedItems"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:ConditionCheckItem"]
        Resource = var.secrets_table_arn
        Condition = {
          StringEqualsIfExists = { "dynamodb:ReturnValues" = "NONE" }
        }
      },
      {
        Sid      = "ReadSecretStatusNeverCiphertexts"
        Effect   = "Allow"
        Action   = "dynamodb:GetItem"
        Resource = var.secrets_table_arn
        Condition = {
          "ForAllValues:StringEquals" = { "dynamodb:Attributes" = local.secrets_read_attributes }
          StringEquals                = { "dynamodb:Select" = "SPECIFIC_ATTRIBUTES" }
        }
      },
      {
        Sid      = "RetireSealedAnswers"
        Effect   = "Allow"
        Action   = "dynamodb:UpdateItem"
        Resource = var.secrets_table_arn
        Condition = {
          "ForAllValues:StringEquals" = { "dynamodb:Attributes" = ["pk", "sk", "status"] }
          StringEqualsIfExists        = { "dynamodb:ReturnValues" = "NONE" }
        }
      },
      {
        Sid      = "SealButNeverOpen"
        Effect   = "Allow"
        Action   = "kms:Encrypt"
        Resource = var.kms_key_arn
        Condition = {
          StringEquals = {
            "kms:EncryptionContext:environment" = var.environment
            "kms:EncryptionContext:eventId"     = var.event_id
            "kms:EncryptionContext:purpose"     = ["doctor-selection", "reveal-code"]
          }
        }
      },
      {
        Sid      = "AskTheMailer"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.mailer_function_arn
      },
      {
        Sid      = "OwnLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      },
      {
        # SecureString with the AWS-managed key (alias/aws/ssm): the key policy
        # already allows decryption through SSM for this account.
        Sid      = "HostPasswordHash"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = local.admin_password_parameter_arn
      },
    ]
  })
}
