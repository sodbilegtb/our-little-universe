variable "name" {
  description = "Resource name prefix, e.g. olu-dev."
  type        = string
}

variable "environment" {
  description = "dev or prod. Passed to the API, which refuses development features outside local runs."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "event_id" {
  description = "Server-side event identifier. Clients can never choose it."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{2,39}$", var.event_id))
    error_message = "3-40 lowercase letters, digits or dashes."
  }
}

variable "event_name" {
  type    = string
  default = "Our Little Universe"
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "lambda_source_dir" {
  description = "Directory with the bundled handler (index.mjs)."
  type        = string
}

variable "public_app_url" {
  description = "Public URL of the web app (for the TV's QR code)."
  type        = string
}

variable "allowed_origins" {
  description = "Origins allowed by CORS. Normally just the web app's URL."
  type        = list(string)

  validation {
    condition     = length(var.allowed_origins) > 0 && alltrue([for o in var.allowed_origins : o != "*"])
    error_message = "List explicit origins; a wildcard is not allowed."
  }
}

variable "admin_password_parameter_name" {
  description = "SSM SecureString parameter holding the host password hash (created by scripts/aws/set-admin-password)."
  type        = string

  validation {
    condition     = can(regex("^/[A-Za-z0-9_./-]+$", var.admin_password_parameter_name))
    error_message = "Use an absolute parameter path such as /olu/dev/admin-password-hash."
  }
}

variable "admin_session_hours" {
  type    = number
  default = 12
}

variable "memory_mb" {
  description = "Lambda memory. CPU scales with it; 512 MB keeps password hashing and cold starts quick."
  type        = number
  default     = 512
}

variable "reserved_concurrency" {
  description = "Maximum concurrent Lambda executions, or -1 for no reservation."
  type        = number
  default     = -1
}

variable "throttle_rate_per_second" {
  description = "Steady-state request limit for the whole API. Measured by `npm run rehearse`: each phone needs about 1.75 requests per second at the busiest moments (40 phones peaked at 74, 100 at 175)."
  type        = number
  default     = 300

  validation {
    condition     = var.throttle_rate_per_second >= 50 && var.throttle_rate_per_second <= 2000
    error_message = "Keep the rate limit between 50 and 2000 requests per second."
  }
}

variable "throttle_burst" {
  description = "Short bursts above the rate limit, such as every phone reacting to the same phase change."
  type        = number
  default     = 600
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "log_level" {
  type    = string
  default = "info"
}
