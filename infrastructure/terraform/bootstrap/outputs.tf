output "state_bucket" {
  description = "Put this into environments/<env>/backend.hcl as `bucket`."
  value       = aws_s3_bucket.state.bucket
}

output "region" {
  value = var.region
}
