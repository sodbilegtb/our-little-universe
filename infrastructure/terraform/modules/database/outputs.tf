output "table_name" {
  value = aws_dynamodb_table.events.name
}

output "table_arn" {
  value = aws_dynamodb_table.events.arn
}

output "deletion_protection" {
  value = aws_dynamodb_table.events.deletion_protection_enabled
}
