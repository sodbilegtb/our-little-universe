variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "eu-central-1"
}

variable "reveal_mode" {
  description = "LIVE for the party; TEST for a dress rehearsal on the production stack. No default on purpose: write it down."
  type        = string

  validation {
    condition     = contains(["TEST", "LIVE"], var.reveal_mode)
    error_message = "reveal_mode must be \"LIVE\" (the party) or \"TEST\" (a dress rehearsal)."
  }
}

variable "event_id" {
  description = "Server-side event id. Use a new one when switching from a TEST dress rehearsal to LIVE, so nothing from the rehearsal belongs to the party."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{2,62}$", var.event_id))
    error_message = "event_id: 3 to 63 lowercase letters, digits and dashes."
  }
}

variable "event_name" {
  type    = string
  default = "Our Little Universe"
}

variable "api_rate_limit" {
  description = "Requests per second the API accepts (bursts up to twice that). 300 covers about 150 phones."
  type        = number
  default     = 300
}

variable "reserved_concurrency" {
  description = "Cap on concurrent Lambda executions (-1 = none). New AWS accounts often can't reserve any."
  type        = number
  default     = -1
}

variable "doctor_link_hours" {
  description = "How long the doctor link stays valid. Create it shortly before the appointment."
  type        = number
  default     = 48

  validation {
    condition     = var.doctor_link_hours >= 1 && var.doctor_link_hours <= 168
    error_message = "doctor_link_hours: 1 to 168 (one week)."
  }
}

variable "alarm_email" {
  description = "Who hears about errors during the party (confirm the subscription email AWS sends)."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alarm_email))
    error_message = "Production needs an alarm_email: errors on the evening must reach someone."
  }
}

variable "budget_email" {
  description = "Who hears about costs."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_email))
    error_message = "Production needs a budget_email."
  }
}

variable "monthly_budget_usd" {
  type    = number
  default = 20
}

variable "email_sender" {
  description = "From address of the reveal code email."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.email_sender))
    error_message = "Production needs an email_sender: the official code has to reach the parents."
  }
}

variable "email_sender_domain" {
  description = "The verified sender domain (from dev)."
  type        = string
  default     = ""
}

variable "email_recipients" {
  description = "Who receives the official reveal code (the parents)."
  type        = list(string)

  validation {
    condition     = length(var.email_recipients) > 0
    error_message = "Production needs at least one recipient for the official code."
  }
}

variable "email_transport" {
  description = "\"ses\" (Amazon SES) or \"gmail\" (email_sender is a Gmail account; store its app password with `npm run aws:set-gmail-password -- prod`)."
  type        = string
  default     = "ses"
}

variable "email_manage_identities" {
  description = "Create the SES identities here. Leave false while dev (same AWS account) manages them."
  type        = bool
  default     = false
}

variable "email_dns_in_route53" {
  description = "Only with email_manage_identities: write the DKIM records into Route 53."
  type        = bool
  default     = false
}

variable "allow_destroy" {
  description = "After the party, once `npm run aws:teardown-check -- prod` passes: turns off the tables' deletion protection so terraform destroy can remove them."
  type        = bool
  default     = false
}
