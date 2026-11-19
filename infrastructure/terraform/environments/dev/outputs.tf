output "app_url" {
  description = "Open this on the TV (/tv) and the host laptop (/admin)."
  value       = module.hosting.url
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "amplify_app_id" {
  value = module.hosting.app_id
}

output "amplify_branch" {
  value = module.hosting.branch_name
}

output "table_name" {
  value = module.database.table_name
}

output "lambda_log_group" {
  value = module.api.lambda_log_group
}

output "admin_password_parameter" {
  value = "/olu/${local.environment}/admin-password-hash"
}

output "region" {
  value = var.region
}

output "email_dkim_records" {
  description = "DKIM CNAME records of the sender domain (only when email_sender_domain is set). With email_dns_in_route53, Terraform has already added them."
  value       = module.email.dkim_records
}

output "secrets_table_name" {
  value = module.secret.secrets_table_name
}

output "email_identities" {
  description = "SES identities the code email depends on (checked by npm run aws:preflight)."
  value       = compact(concat([var.email_sender_domain != "" ? var.email_sender_domain : var.email_sender], var.email_recipients))
}

output "email_transport" {
  value = var.email_transport
}

output "alarm_topic_arn" {
  value = module.monitoring.alarm_topic_arn
}

output "reveal_mode" {
  value = "TEST"
}

output "event_id" {
  value = var.event_id
}
