variable "name" {
  type = string
}

variable "function_name" {
  type = string
}

variable "api_id" {
  type = string
}

variable "alarm_email" {
  description = "Where alarm emails go. Empty: alarms are recorded but nobody is emailed."
  type        = string
  default     = ""
}

variable "budget_email" {
  description = "Where budget alerts go. Empty: no budget is created."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 10
}

variable "api_5xx_threshold" {
  description = "Server errors per 5 minutes before alarming."
  type        = number
  default     = 5
}

variable "secret_function_names" {
  description = "The mailer and reveal Lambdas, alarmed on any error."
  type        = list(string)
  default     = []
}
