variable "region" {
  description = "AWS region for the state bucket."
  type        = string
  default     = "eu-central-1"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for Terraform state, e.g. olu-tfstate-<account-id>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "Use 3-63 lowercase letters, digits, dots or hyphens."
  }
}

variable "noncurrent_version_days" {
  description = "How long old state versions are kept, so a broken state can be restored."
  type        = number
  default     = 90
}
