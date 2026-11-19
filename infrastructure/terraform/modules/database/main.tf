# Single-table event storage. Layout and access patterns: docs/data-model.md.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_dynamodb_table" "events" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST" # no fixed capacity cost; pay per request
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

  # Host sessions and rate-limit counters expire on their own.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Continuous backups of the last 35 days: protects the baby messages.
  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  deletion_protection_enabled = var.deletion_protection

  # Encryption at rest uses the AWS-owned key (DynamoDB default, no extra cost).
  # The doctor's selection will get its own KMS key in Milestone 6.
}
