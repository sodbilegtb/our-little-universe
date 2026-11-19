# Development environment: a complete, separate copy of the stack with its own
# table, so test data can never mix with the real event (prod, Milestone 8).

locals {
  environment = "dev"
  name        = "olu-${local.environment}"
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

module "api" {
  source = "../../modules/api"

  name                          = local.name
  environment                   = local.environment
  event_id                      = var.event_id
  event_name                    = var.event_name
  table_name                    = module.database.table_name
  table_arn                     = module.database.table_arn
  lambda_source_dir             = "${path.root}/../../../../services/api/dist/lambda"
  public_app_url                = module.hosting.url
  allowed_origins               = concat([module.hosting.url], var.extra_allowed_origins)
  admin_password_parameter_name = "/olu/${local.environment}/admin-password-hash"
  reserved_concurrency          = var.reserved_concurrency
  throttle_rate_per_second      = var.api_rate_limit
  throttle_burst                = var.api_rate_limit * 2
  log_retention_days            = 14
}

module "monitoring" {
  source = "../../modules/monitoring"

  name               = local.name
  function_name      = module.api.function_name
  api_id             = module.api.api_id
  alarm_email        = var.alarm_email
  budget_email       = var.budget_email
  monthly_budget_usd = var.monthly_budget_usd
}
