variable "name" {
  description = "Prefix for resource names, e.g. olu-dev."
  type        = string
}

variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "event_id" {
  type = string
}

variable "event_name" {
  type    = string
  default = "Our Little Universe"
}

variable "reveal_mode" {
  description = "TEST everywhere but prod. Prod is LIVE unless explicitly set to TEST for a rehearsal."
  type        = string

  validation {
    condition     = contains(["TEST", "LIVE"], var.reveal_mode)
    error_message = "reveal_mode must be TEST or LIVE."
  }
}

variable "events_table_name" {
  type = string
}

variable "events_table_arn" {
  type = string
}

variable "mailer_source_dir" {
  type = string
}

variable "reveal_source_dir" {
  type = string
}

variable "public_app_url" {
  type = string
}

variable "email_sender" {
  description = "From address of the reveal code email. Empty: the mailer records the email as skipped."
  type        = string
  default     = ""
}

variable "email_recipients" {
  type    = list(string)
  default = []
}

variable "ses_identity_arns" {
  description = "Verified SES identities (sender and, in the sandbox, recipients)."
  type        = list(string)
  default     = []
}

variable "point_in_time_recovery" {
  type    = bool
  default = true
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "kms_deletion_window_days" {
  description = "A destroyed key waits this long before it's gone (7-30 days); it can be restored meanwhile."
  type        = number
  default     = 7

  validation {
    condition     = var.kms_deletion_window_days >= 7 && var.kms_deletion_window_days <= 30
    error_message = "KMS allows 7 to 30 days."
  }
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "log_level" {
  type    = string
  default = "info"
}
