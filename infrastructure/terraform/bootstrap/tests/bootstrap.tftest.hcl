mock_provider "aws" {
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::olu-tfstate-test" }
  }
}

variables {
  state_bucket_name = "olu-tfstate-test"
}

run "state_bucket_is_locked_down" {
  command = apply

  assert {
    condition     = one(aws_s3_bucket_versioning.state.versioning_configuration).status == "Enabled"
    error_message = "State versions must be kept for recovery."
  }

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.state.block_public_acls,
      aws_s3_bucket_public_access_block.state.block_public_policy,
      aws_s3_bucket_public_access_block.state.ignore_public_acls,
      aws_s3_bucket_public_access_block.state.restrict_public_buckets,
    ])
    error_message = "The state bucket must never be public."
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    error_message = "Unencrypted transport must be denied."
  }
}

run "rejects_invalid_bucket_name" {
  command = plan

  variables {
    state_bucket_name = "Not_A_Valid_Bucket"
  }

  expect_failures = [var.state_bucket_name]
}
