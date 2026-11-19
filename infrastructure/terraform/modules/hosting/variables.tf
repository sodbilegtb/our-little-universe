variable "app_name" {
  type = string
}

variable "branch_name" {
  type    = string
  default = "main"
}

variable "stage" {
  description = "Amplify branch stage."
  type        = string
  default     = "DEVELOPMENT"

  validation {
    condition     = contains(["DEVELOPMENT", "PRODUCTION"], var.stage)
    error_message = "DEVELOPMENT or PRODUCTION."
  }
}

variable "connect_src" {
  description = "Extra origins the app may call (the API). Goes into the Content-Security-Policy."
  type        = list(string)
}
