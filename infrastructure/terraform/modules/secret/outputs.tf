output "kms_key_arn" {
  value = aws_kms_key.secret.arn
}

output "secrets_table_name" {
  value = aws_dynamodb_table.secrets.name
}

output "secrets_table_arn" {
  value = aws_dynamodb_table.secrets.arn
}

output "mailer_function_name" {
  value = aws_lambda_function.mailer.function_name
}

output "mailer_function_arn" {
  value = aws_lambda_function.mailer.arn
}

output "reveal_function_name" {
  value = aws_lambda_function.reveal.function_name
}

output "reveal_invoke_arn" {
  value = aws_lambda_function.reveal.invoke_arn
}
