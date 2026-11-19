variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "eu-central-1"
}

variable "event_id" {
  description = "Server-side event id for this environment."
  type        = string
  default     = "dev-rehearsal"
}

variable "event_name" {
  type    = string
  default = "Our Little Universe"
}

variable "extra_allowed_origins" {
  description = "Additional CORS origins, e.g. http://localhost:5173 to run the local web app against the dev API."
  type        = list(string)
  default     = []
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

variable "alarm_email" {
  description = "Email for alarms (confirm the subscription email AWS sends)."
  type        = string
  default     = ""
}

variable "budget_email" {
  description = "Email for budget alerts. Strongly recommended."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 10
}

variable "email_sender" {
  description = "From address of the reveal code email. Empty: no email (the host desk shows it as skipped)."
  type        = string
  default     = ""
}

variable "email_sender_domain" {
  description = "Verify this whole domain for sending (recommended; add the DKIM records from the output to DNS)."
  type        = string
  default     = ""
}

variable "email_recipients" {
  description = "Who receives the (test) reveal code."
  type        = list(string)
  default     = []
}
