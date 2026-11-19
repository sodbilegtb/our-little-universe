# Production: the real party. A complete stack of its own (own state, table,
# key, Lambdas, web app and host password), so nothing from dev can reach it.
#
# Differences from dev, all on purpose:
# - reveal_mode has no default: LIVE (or TEST for a dress rehearsal) is written
#   down in terraform.tfvars, so test never turns into live by accident.
# - The tables refuse deletion and keep point-in-time recovery; the KMS key
#   waits 30 days before it can be deleted; logs are kept 30 days.
# - SES identities are reused from dev (same AWS account), not created again.

locals {
  environment = "prod"
  name        = "olu-${local.environment}"
  # Built with `npm run aws:build-api`: one folder per Lambda.
  lambda_dist = "${path.root}/../../../../services/api/dist/lambda"
}

module "database" {
  source = "../../modules/database"

  table_name             = "${local.name}-events"
  point_in_time_recovery = true
  deletion_protection    = true
}

module "hosting" {
  source = "../../modules/hosting"

  app_name    = local.name
  branch_name = "main"
  stage       = "PRODUCTION"
  # A pattern instead of the exact API URL avoids a dependency cycle
  # (the API also needs the app's URL for CORS).
  connect_src = ["https://*.execute-api.${var.region}.amazonaws.com"]
}

module "email" {
  source = "../../modules/email"

  sender_address      = var.email_transport == "ses" ? var.email_sender : ""
  sender_domain       = var.email_sender_domain
  recipient_addresses = var.email_recipients
  # Dev created (and verifies) these identities in this account; prod uses them.
  manage_identities  = var.email_manage_identities
  manage_dns_records = var.email_manage_identities && var.email_dns_in_route53
}

module "secret" {
  source = "../../modules/secret"

  name                     = local.name
  environment              = local.environment
  event_id                 = var.event_id
  event_name               = var.event_name
  reveal_mode              = var.reveal_mode
  events_table_name        = module.database.table_name
  events_table_arn         = module.database.table_arn
  mailer_source_dir        = "${local.lambda_dist}/mailer"
  reveal_source_dir        = "${local.lambda_dist}/reveal"
  public_app_url           = module.hosting.url
  email_sender             = var.email_sender
  email_recipients         = var.email_recipients
  email_transport          = var.email_transport
  ses_identity_arns        = module.email.identity_arns
  point_in_time_recovery   = true
  deletion_protection      = true
  kms_deletion_window_days = 30
  log_retention_days       = 30
  # Written by `npm run aws:set-gmail-password -- prod`, never by Terraform (it would land in the state).
  gmail_app_password_parameter_name = var.email_transport == "gmail" ? "/olu/${local.environment}/gmail-app-password" : ""
}

module "api" {
  source = "../../modules/api"

  name                          = local.name
  environment                   = local.environment
  event_id                      = var.event_id
  event_name                    = var.event_name
  table_name                    = module.database.table_name
  table_arn                     = module.database.table_arn
  lambda_source_dir             = "${local.lambda_dist}/api"
  public_app_url                = module.hosting.url
  allowed_origins               = [module.hosting.url]
  admin_password_parameter_name = "/olu/${local.environment}/admin-password-hash"
  reserved_concurrency          = var.reserved_concurrency
  throttle_rate_per_second      = var.api_rate_limit
  throttle_burst                = var.api_rate_limit * 2
  log_retention_days            = 30
  reveal_mode                   = var.reveal_mode
  doctor_link_hours             = var.doctor_link_hours
  secrets_table_name            = module.secret.secrets_table_name
  secrets_table_arn             = module.secret.secrets_table_arn
  kms_key_arn                   = module.secret.kms_key_arn
  mailer_function_name          = module.secret.mailer_function_name
  mailer_function_arn           = module.secret.mailer_function_arn
  reveal_function_name          = module.secret.reveal_function_name
  reveal_invoke_arn             = module.secret.reveal_invoke_arn
}

module "monitoring" {
  source = "../../modules/monitoring"

  name                  = local.name
  function_name         = module.api.function_name
  secret_function_names = [module.secret.mailer_function_name, module.secret.reveal_function_name]
  api_id                = module.api.api_id
  alarm_email           = var.alarm_email
  budget_email          = var.budget_email
  monthly_budget_usd    = var.monthly_budget_usd
}
