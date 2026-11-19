# Least privilege: the API can read and write items in its own table, write its
# own logs, and read one SSM parameter. Nothing else: no Scan, no table
# management, no access to other tables or parameters.

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
