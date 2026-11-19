mock_provider "aws" {}

variables {
  table_name = "olu-test-events"
}

run "table_settings" {
  command = apply

  assert {
    condition     = aws_dynamodb_table.events.billing_mode == "PAY_PER_REQUEST"
    error_message = "On-demand billing keeps idle cost at zero."
  }

  assert {
    condition     = aws_dynamodb_table.events.hash_key == "pk" && aws_dynamodb_table.events.range_key == "sk"
    error_message = "Keys must match the repository (pk/sk)."
  }

  assert {
    condition     = one(aws_dynamodb_table.events.ttl).enabled && one(aws_dynamodb_table.events.ttl).attribute_name == "ttl"
    error_message = "TTL must expire host sessions and rate limits."
  }

  assert {
    condition     = one(aws_dynamodb_table.events.point_in_time_recovery).enabled
    error_message = "Point-in-time recovery protects the messages."
  }
}
