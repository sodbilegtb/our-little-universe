# Development environment: a complete, separate copy of the stack with its own
# table, so test data can never mix with the real event (prod, Milestone 8).

locals {
  environment = "dev"
  name        = "olu-${local.environment}"
  # Built with `npm run aws:build-api`: one folder per Lambda.
  lambda_dist = "${path.root}/../../../../services/api/dist/lambda"
}

module "database" {
  source = "../../modules/database"

  table_name             = "${local.name}-events"
  point_in_time_recovery = true
  deletion_protection    = false
}

module "hosting" {
  source = "../../modules/hosting"

  app_name    = local.name
  branch_name = "main"
  stage       = "DEVELOPMENT"
  # A pattern instead of the exact API URL avoids a dependency cycle
  # (the API also needs the app's URL for CORS).
  connect_src = ["https://*.execute-api.${var.region}.amazonaws.com"]
}

module "email" {
  source = "../../modules/email"

  sender_address      = var.email_sender
  sender_domain       = var.email_sender_domain
  manage_dns_records  = var.email_dns_in_route53
  recipient_addresses = var.email_recipients
}

module "secret" {
  source = "../../modules/secret"

  name                   = local.name
  environment            = local.environment
  event_id               = var.event_id
  event_name             = var.event_name
  reveal_mode            = "TEST" # dev can never run a live reveal
  events_table_name      = module.database.table_name
  events_table_arn       = module.database.table_arn
  mailer_source_dir      = "${local.lambda_dist}/mailer"
  reveal_source_dir      = "${local.lambda_dist}/reveal"
  public_app_url         = module.hosting.url
  email_sender           = var.email_sender
  email_recipients       = var.email_recipients
  ses_identity_arns      = module.email.identity_arns
  point_in_time_recovery = true
  deletion_protection    = false
  log_retention_days     = 14
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
  allowed_origins               = concat([module.hosting.url], var.extra_allowed_origins)
  admin_password_parameter_name = "/olu/${local.environment}/admin-password-hash"
  reserved_concurrency          = var.reserved_concurrency
  throttle_rate_per_second      = var.api_rate_limit
  throttle_burst                = var.api_rate_limit * 2
  log_retention_days            = 14
  reveal_mode                   = "TEST"
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
