variable "sender_address" {
  description = "From address of the reveal code email, e.g. reveal@example.com. Empty: no email is sent."
  type        = string
  default     = ""

  validation {
    condition     = var.sender_address == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.sender_address))
    error_message = "sender_address must be an email address."
  }
}

variable "sender_domain" {
  description = "Verify this whole domain instead of the single sender address (needs DNS records)."
  type        = string
  default     = ""
}

variable "manage_identities" {
  description = "Create the SES identities here (true), or reuse the verified ones another environment in this account created (false)."
  type        = bool
  default     = true
}

variable "manage_dns_records" {
  description = "Write the DKIM records into the sender domain's public Route 53 hosted zone (it must be in this AWS account)."
  type        = bool
  default     = false
}

variable "recipient_addresses" {
  description = "Who receives the reveal code (the parents)."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for r in var.recipient_addresses : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", r))])
    error_message = "Every recipient must be an email address."
  }
}

variable "verify_recipients" {
  description = "Needed while the account is in the SES sandbox."
  type        = bool
  default     = true
}
